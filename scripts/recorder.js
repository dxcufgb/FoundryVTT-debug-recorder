import { MODULE_ID, MAX_EVENTS, MAX_SNAPSHOT_BYTES, MAX_BREADCRUMB_BYTES, SNAPSHOT_TIMEOUT_MS, jsonSize, clientLabel, roleKey, t } from "./util.js";
import { Redactor } from "./privacy.js";
import { environmentHeader, moduleState } from "./environment.js";
import { installCapture, uninstallCapture } from "./capture.js";

/*
 * The recording: one session at a time, on the GM client that started it (player clients follow in v0.2).
 *
 * Everything is redacted the moment it is stored (session.redactor), never only at export. The session keeps:
 * the environment header taken at Start, each selected module's state at Start and at the end, the registered
 * snapshots (start / stop / export), and the events (at most MAX_EVENTS; identical repeated errors and warnings are
 * one event with a count; anything past the cap is only counted as dropped).
 *
 * The public API (register / breadcrumb / isRecording) is in this file; main.js puts it on the module.
 */

/** moduleId → {snapshot} from API.register, kept for the whole page life (load order doesn't matter). */
const registrants = new Map();
const listeners = new Set();
/** The current or last recording, or null. */
let session = null;

/** Document types whose names are learnt again when one is created or renamed during a recording. */
const NAME_TYPES = ["User", "Actor", "Item", "Scene", "Token", "Combatant", "Combat", "JournalEntry", "JournalEntryPage",
  "ChatMessage", "Folder", "Macro", "Playlist", "PlaylistSound", "RollTable", "Cards", "ActiveEffect", "Note", "Drawing"];

function emit() {
  for (const fn of listeners) {
    try {
      fn(getState());
    } catch (err) {
      console.error(`${MODULE_ID} | listener`, err);
    }
  }
}

/** Calls fn(state) whenever recording starts, stops or is cleared. Returns an unsubscribe function. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* -------------------------------------------- */
/*  Public API                                  */
/* -------------------------------------------- */

export function isRecording() {
  return !!session?.recording;
}

/**
 * API: a module hands the recorder a snapshot() of its runtime state. Called at Start, Stop and Export while the
 * module is selected; wrapped in try/catch and redacted. Registering again replaces the earlier registration.
 */
export function register(moduleId, { snapshot } = {}) {
  try {
    if (typeof moduleId !== "string" || !moduleId) return false;
    registrants.set(moduleId, { snapshot: typeof snapshot === "function" ? snapshot : null, at: Date.now() });
    // A late registrant during a recording still gets its start snapshot.
    if (session?.recording && session.selected.has(moduleId) && !session.modules[moduleId]?.snapshots.start) {
      takeSnapshot(moduleId, "start", { late: true }).catch(() => {});
    }
    return true;
  } catch {
    return false;
  }
}

/** API: a breadcrumb ("area.action", small flat data). Stored only while recording and only for selected modules. */
export function breadcrumb(moduleId, key, data) {
  try {
    if (!session?.recording || !session.selected.has(moduleId)) return;
    const fields = { key: String(key ?? "").slice(0, 100) };
    if (data !== undefined) fields.data = data !== null && typeof data === "object" ? data : { value: data };
    const ev = record("breadcrumb", fields, { module: moduleId, level: "info", collapse: false });
    if (ev?.data !== undefined) {
      const size = jsonSize(ev.data);
      if (size > MAX_BREADCRUMB_BYTES) ev.data = { truncated: true, bytes: size };
    }
  } catch {
    // a recorder problem must never reach the calling module
  }
}

export function isRegistered(moduleId) {
  return registrants.has(moduleId);
}

export function registeredIds() {
  return [...registrants.keys()];
}

/* -------------------------------------------- */
/*  Events                                      */
/* -------------------------------------------- */

/**
 * Stores one event (redacted). level: "error" | "warn" | "info". Identical errors / warnings collapse into one event
 * with `count`. Returns the stored event (or null when not recording or dropped).
 */
export function record(type, fields = {}, { module = null, level = "info", collapse = true } = {}) {
  const s = session;
  if (!s?.recording) return null;
  const now = Date.now() - s.startedAt;
  const clean = s.redactor.redact(fields) ?? {};
  s.counts.total++;
  s.counts.byType[type] = (s.counts.byType[type] ?? 0) + 1;
  if (level === "error") s.counts.errors++;
  if (level === "warn") s.counts.warnings++;
  const ev = { t: now, type, level, ...(module ? { module } : {}), ...clean };
  const collapsible = collapse && (level === "error" || level === "warn");
  const sig = collapsible ? `${type}|${module}|${ev.message ?? ""}|${ev.stack ?? ""}` : null;
  if (sig) {
    const prev = s.collapseIndex.get(sig);
    if (prev) {
      prev.count = (prev.count ?? 1) + 1;
      prev.lastT = now;
      s.counts.collapsed++;
      return prev;
    }
  }
  if (s.events.length >= MAX_EVENTS) {
    s.counts.dropped++;
    s.counts.droppedByType[type] = (s.counts.droppedByType[type] ?? 0) + 1;
    return null;
  }
  s.events.push(ev);
  if (sig) s.collapseIndex.set(sig, ev);
  return ev;
}

const sink = {
  record,
  isSelected: id => !!session?.selected.has(id),
  redactFields: fields => session?.redactor.redact(fields) ?? {}
};

/* -------------------------------------------- */
/*  Snapshots and module state                  */
/* -------------------------------------------- */

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("snapshot timed out")), ms); })
  ]).finally(() => clearTimeout(timer));
}

function moduleEntry(s, id) {
  return (s.modules[id] ??= { stateStart: null, stateEnd: null, snapshots: {} });
}

async function takeSnapshot(id, phase, { late = false, s = session } = {}) {
  if (!s) return;
  const entry = moduleEntry(s, id);
  const reg = registrants.get(id);
  if (!reg?.snapshot) return;
  try {
    let value = reg.snapshot();
    if (value && typeof value.then === "function") value = await withTimeout(value, SNAPSHOT_TIMEOUT_MS);
    let clean = s.redactor.redact(value === undefined ? null : value);
    const size = jsonSize(clean);
    if (size > MAX_SNAPSHOT_BYTES) clean = { truncated: true, bytes: size };
    entry.snapshots[phase] = late ? { late: true, data: clean } : clean;
  } catch (err) {
    entry.snapshots[phase] = { failed: true };
    if (s.recording) record("snapshotError", { phase, error: err }, { module: id, level: "error" });
  }
}

async function takeSnapshots(phase, s = session) {
  await Promise.all([...s.selected].map(id => takeSnapshot(id, phase, { s })));
}

function takeStates(key, s = session) {
  for (const id of s.selected) {
    try {
      moduleEntry(s, id)[key] = s.redactor.redact(moduleState(id), { maxDepth: 8 });
    } catch {
      moduleEntry(s, id)[key] = { failed: true };
    }
  }
}

/* -------------------------------------------- */
/*  Start / stop                                */
/* -------------------------------------------- */

function newSession(selected) {
  const redactor = Redactor.fromWorld(game, globalThis.location);
  const user = game.user;
  return {
    redactor,
    selected: new Set(selected),
    recording: false,
    startedAt: Date.now(),
    stoppedAt: null,
    autoStopped: false,
    autoStopMinutes: null,
    client: { label: clientLabel(user), role: roleKey(user?.role) },
    environment: null,
    modules: {},
    events: [],
    collapseIndex: new Map(),
    counts: { total: 0, errors: 0, warnings: 0, collapsed: 0, dropped: 0, byType: {}, droppedByType: {} },
    hookIds: [],
    timer: null
  };
}

/** Learns new names while recording (documents created or renamed after Start). */
function watchNames(s) {
  for (const type of NAME_TYPES) {
    const onCreate = doc => s.redactor.absorbDocument(doc, type);
    const onUpdate = doc => s.redactor.absorbDocument(doc, type, { deep: false });
    s.hookIds.push([`create${type}`, Hooks.on(`create${type}`, onCreate)], [`update${type}`, Hooks.on(`update${type}`, onUpdate)]);
  }
}

function unwatchNames(s) {
  for (const [hook, id] of s.hookIds) Hooks.off(hook, id);
  s.hookIds = [];
}

async function setStatus(value) {
  try {
    await game.settings.set(MODULE_ID, "status", value);
  } catch (err) {
    console.warn(`${MODULE_ID} | could not save the recording status`, err);
  }
}

/** GM: starts a recording of the selected modules. Replaces any earlier (stopped) recording. */
export async function start(selectedIds, { autoStopMinutes = 30 } = {}) {
  if (!game.user?.isGM || isRecording()) return false;
  const s = newSession(selectedIds ?? []);
  session = s;
  s.recording = true;
  s.startedAt = Date.now();
  s.autoStopMinutes = autoStopMinutes > 0 ? autoStopMinutes : null;
  try {
    installCapture(sink);
    watchNames(s);
    s.environment = s.redactor.redact(environmentHeader([...s.selected]), { maxDepth: 8 });
    takeStates("stateStart", s);
    await takeSnapshots("start", s);
  } catch (err) {
    console.error(`${MODULE_ID} | start`, err);
  }
  if (s.autoStopMinutes) s.timer = setTimeout(() => stop({ auto: true }), s.autoStopMinutes * 60000);
  await setStatus({ recording: true, startedAt: s.startedAt, by: game.user.id });
  emit();
  return true;
}

/** GM: stops the recording (the data stays for export until Clear or the next Start). */
export async function stop({ auto = false } = {}) {
  const s = session;
  if (!s?.recording) return false;
  clearTimeout(s.timer);
  s.timer = null;
  try {
    await takeSnapshots("stop", s);
    takeStates("stateEnd", s);
  } catch (err) {
    console.error(`${MODULE_ID} | stop`, err);
  }
  uninstallCapture();
  unwatchNames(s);
  s.recording = false;
  s.stoppedAt = Date.now();
  s.autoStopped = auto;
  await setStatus({ recording: false });
  if (auto) ui.notifications?.info(t("Notify.AutoStopped", { minutes: s.autoStopMinutes }));
  emit();
  return true;
}

/** Forgets the stopped recording (and its pseudonym mapping). */
export function clear() {
  if (isRecording()) return false;
  session = null;
  emit();
  return true;
}

/**
 * The session to export, with fresh "export" snapshots and the end state. Without any recording, a one-off session
 * with only the environment header and the selected modules' state and snapshots.
 */
export async function prepareExport(selectedIds = []) {
  let s = session;
  if (!s) {
    s = newSession(selectedIds);
    s.environment = s.redactor.redact(environmentHeader([...s.selected]), { maxDepth: 8 });
    s.stoppedAt = s.startedAt;
    s.adHoc = true;
  }
  await takeSnapshots("export", s);
  if (s.recording || s.adHoc) takeStates("stateEnd", s);
  return s;
}

/** A small summary for the UI. */
export function getState() {
  const s = session;
  return {
    recording: !!s?.recording,
    hasData: !!s,
    startedAt: s?.startedAt ?? null,
    elapsedMs: s ? (s.recording ? Date.now() : s.stoppedAt) - s.startedAt : 0,
    events: s?.events.length ?? 0,
    total: s?.counts.total ?? 0,
    errors: s?.counts.errors ?? 0,
    warnings: s?.counts.warnings ?? 0,
    dropped: s?.counts.dropped ?? 0,
    selected: s ? [...s.selected] : [],
    autoStopMinutes: s?.autoStopMinutes ?? null
  };
}
