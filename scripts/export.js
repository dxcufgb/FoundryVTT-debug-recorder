import { MODULE_ID, FORMAT, SCHEMA_VERSION, MAX_EXPORT_BYTES, AUTO_ZIP_BYTES, recorderVersion, fileStamp, formatBytes, formatDuration, t } from "./util.js";
import { Redactor } from "./privacy.js";
import { browserInfo } from "./environment.js";
import { codeVersions, modulesInEvents, frameString } from "./versions.js";
import { zipOneFile } from "./zip.js";
import * as recorder from "./recorder.js";

/*
 * The exported file (one self-describing JSON file for a GitHub issue, optionally zipped) and the "Copy issue
 * summary" text. Every part was redacted when it was stored; the whole file goes through the session's Redactor once
 * more here. Added after that pass, from already redacted data or validated public package metadata only: `digest`
 * (right after the header), `versions`, the commits in stack frames, `summary`, and the redaction report (last).
 */

const REPORT_FIELDS = ["steps", "expected", "actual"];
/** Breadcrumbs / notifications / setting changes referenced per digest group (the last ones before it). */
const DIGEST_CONTEXT = 20;
const DIGEST_GROUPS = 100;
const short = sha => (sha ? sha.slice(0, 7) : null);

/** Version info of the module of a frame copied onto it ({version, tag, commit}). */
function withVersion(frame, versions) {
  if (!frame) return null;
  const v = frame.module ? versions?.modules?.[frame.module] : null;
  return v ? { ...frame, version: v.version, tag: v.tag, commit: v.commit } : { ...frame };
}

/**
 * The error digest: one entry per distinct error / warning group (identical repeats are already collapsed into one
 * event with `count`), sorted by count, then first seen. Each names its module and exact code, the top stack frame,
 * and the `seq` numbers of the breadcrumbs, notifications and setting changes that came before its first occurrence.
 */
export function buildDigest(events = [], versions = null) {
  const recent = { breadcrumbs: [], notifications: [], settingChanges: [] };
  const push = (list, seq) => {
    list.push(seq);
    if (list.length > DIGEST_CONTEXT) list.shift();
  };
  const groups = [];
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    if (e.level === "error" || e.level === "warn") {
      const frames = e.frames ?? [];
      const top = (e.module && frames.find(f => f.module === e.module)) ?? frames.find(f => f.module) ?? frames[0] ?? null;
      const v = e.module ? versions?.modules?.[e.module] : null;
      groups.push({
        seq: e.seq,
        type: e.type,
        level: e.level,
        module: e.module ?? null,
        version: v?.version ?? null,
        tag: v?.tag ?? null,
        commit: v?.commit ?? null,
        count: e.count ?? 1,
        firstT: e.t,
        lastT: e.lastT ?? e.t,
        ...(e.hook ? { hook: e.hook } : {}),
        message: String(e.message ?? "").slice(0, 300),
        top: frameString(top),
        topFrame: withVersion(top, versions),
        before: { breadcrumbs: [...recent.breadcrumbs], notifications: [...recent.notifications], settingChanges: [...recent.settingChanges] }
      });
    }
    if (e.type === "breadcrumb") push(recent.breadcrumbs, e.seq);
    else if (e.type === "notification") push(recent.notifications, e.seq);
    else if (e.type === "settingChange") push(recent.settingChanges, e.seq);
  }
  groups.sort((a, b) => b.count - a.count || a.firstT - b.firstT);
  return groups.slice(0, DIGEST_GROUPS);
}

/** Version strings and branch names come from module.json / .git: they go through the Redactor like any text. */
function scrubVersions(versions, r) {
  for (const v of Object.values(versions?.modules ?? {})) {
    if (typeof v.version === "string") v.version = r.scrubString(v.version, { version: true, maxLength: 60 });
    if (typeof v.branch === "string") v.branch = r.scrubString(v.branch, { maxLength: 100 });
  }
  if (typeof versions?.system?.version === "string") versions.system.version = r.scrubString(versions.system.version, { version: true, maxLength: 60 });
  return versions;
}

/** One Markdown line per digest group. */
function digestLines(digest, max = 10) {
  return digest.slice(0, max).map((g, i) => {
    const code = [g.version, g.tag && g.tag !== `v${g.version}` ? g.tag : null, short(g.commit)].filter(Boolean).join(" ");
    const who = g.module ? `\`${g.module}\`${code ? ` ${code}` : ""}` : "no module";
    const msg = String(g.message ?? "").replace(/\s+/g, " ").replaceAll("`", "'").slice(0, 160);
    const where = g.top ? ` at \`${g.top}\`` : "";
    const ctx = g.before?.breadcrumbs?.length ? `; ${g.before.breadcrumbs.length} breadcrumbs before (#${g.before.breadcrumbs.join(", #")})` : "";
    return `${i + 1}. ×${g.count} ${g.type}${g.hook ? ` (${g.hook})` : ""}, ${who}${where}: \`${msg}\` (first at ${formatDuration(g.firstT)}, event #${g.seq}${ctx})`;
  });
}

/** Markdown summary of a file (stored in the file as `summary`). */
export function summaryMarkdown(file) {
  const env = file.environment ?? {};
  const lines = [];
  const b = env.browser ?? {};
  lines.push("## Debug recording", "");
  lines.push(`- Recorder: ${file.recorderVersion}`);
  if (file.recording?.startedAt) lines.push(`- Started: ${file.recording.startedAt} (UTC), duration ${formatDuration(file.recording.durationMs)}${file.recording.autoStopped ? " (stopped automatically)" : ""}`);
  lines.push(`- Foundry VTT: ${env.foundry?.version ?? "?"} (generation ${env.foundry?.generation ?? "?"}, build ${env.foundry?.build ?? "?"})`);
  lines.push(`- System: ${env.system?.id ?? "?"} ${env.system?.version ?? ""}`.trimEnd());
  lines.push(`- Browser: ${b.family ?? "?"} ${b.version ?? ""} on ${b.os ?? "?"} (${b.desktopApp ? "desktop app" : "browser"})`);
  if (env.display?.screen) lines.push(`- Screen: ${env.display.screen.width}×${env.display.screen.height} @${env.display.devicePixelRatio}, window ${env.display.window?.width}×${env.display.window?.height}`);
  if (env.webgl?.available) lines.push(`- GPU: ${env.webgl.renderer} (WebGL ${env.webgl.webgl}, max texture ${env.webgl.maxTextureSize}, PIXI ${env.webgl.pixi})`);
  lines.push(`- Client: ${env.client?.label ?? "?"}; users connected: ${env.users?.connected ?? "?"} (${env.users?.gmsConnected ?? "?"} GM)`);
  lines.push(`- Active modules: ${env.modules?.activeCount ?? "?"} (${env.modules?.disabledCount ?? "?"} disabled)`);
  const c = file.counts ?? {};
  lines.push("", "### Error digest", "");
  lines.push(`${c.total ?? 0} events (${c.errors ?? 0} errors, ${c.warnings ?? 0} warnings), ${c.collapsed ?? 0} repeats collapsed, ${c.dropped ?? 0} dropped.`);
  if (file.digest?.length) lines.push("", ...digestLines(file.digest));
  lines.push("", "### Selected modules", "");
  if (!file.selectedModules?.length) lines.push("None.");
  else {
    lines.push("| Module | Version | Tag | Commit | Registered | Events | Errors |", "| --- | --- | --- | --- | --- | --- | --- |");
    for (const id of file.selectedModules) {
      const m = file.modules?.[id] ?? {};
      const v = file.versions?.modules?.[id] ?? {};
      const evs = (file.events ?? []).filter(e => e.module === id);
      const errors = evs.filter(e => e.level === "error").reduce((n, e) => n + (e.count ?? 1), 0);
      lines.push(`| \`${id}\` | ${v.version ?? m.stateEnd?.version ?? m.stateStart?.version ?? "?"} | ${v.tag ?? "–"} | ${short(v.commit) ?? "–"} | ${m.registered ? "yes" : "no"} | ${evs.length} | ${errors} |`);
    }
  }
  for (const key of REPORT_FIELDS) {
    const text = file.report?.[key];
    if (!text) continue;
    lines.push("", `### ${{ steps: "Steps to reproduce", expected: "Expected behaviour", actual: "Actual behaviour" }[key]}`, "", text);
  }
  return lines.join("\n");
}

/** Builds the export file (an object). `report` = {steps, expected, actual}; `selected` is used without a recording. */
export async function buildFile(report = {}, selected = []) {
  const s = await recorder.prepareExport(selected);
  const r = s.redactor;
  const end = s.recording ? Date.now() : (s.stoppedAt ?? Date.now());
  const file = {
    format: FORMAT,
    schemaVersion: SCHEMA_VERSION,
    recorderVersion: recorderVersion(),
    createdAt: new Date().toISOString(),
    recording: {
      recorded: !s.adHoc,
      startedAt: s.adHoc ? null : new Date(s.startedAt).toISOString(),
      durationMs: s.adHoc ? 0 : end - s.startedAt,
      stillRecording: !!s.recording,
      autoStopped: !!s.autoStopped,
      autoStopMinutes: s.autoStopMinutes
    },
    selectedModules: [...s.selected],
    clients: {
      recorded: [s.client.label],
      note: "Version 0.1 records the GM client that started the recording only."
    },
    report: Object.fromEntries(REPORT_FIELDS.map(k => [k, r.scrubString(String(report[k] ?? "").trim(), { maxLength: 10000 })])),
    environment: s.environment,
    modules: Object.fromEntries([...s.selected].map(id => {
      const m = s.modules[id] ?? {};
      return [id, { registered: recorder.isRegistered(id), stateStart: m.stateStart ?? null, stateEnd: m.stateEnd ?? null, snapshots: m.snapshots ?? {} }];
    })),
    counts: { ...s.counts, stored: s.events.length },
    events: s.events,
    summary: ""
  };
  const clean = r.redact(file, { maxDepth: 24 });
  // Versions: validated public package metadata (repo slug, tag, commit), not scrubbed (a GitHub owner can share a
  // user's name); only the version strings go through the Redactor. Never a URL.
  const versions = s.versions ?? { core: null, system: null, modules: {} };
  scrubVersions(versions, r);
  for (const e of clean.events ?? []) {
    for (const f of e.frames ?? []) {
      const v = f.module ? versions.modules?.[f.module] : null;
      if (v) Object.assign(f, { version: v.version, tag: v.tag, commit: v.commit });
    }
  }
  const { format, schemaVersion, recorderVersion: rv, createdAt, recording, selectedModules, ...rest } = clean;
  const out = { format, schemaVersion, recorderVersion: rv, createdAt, recording, selectedModules };
  // Built from the redacted events, so it holds nothing the file doesn't.
  out.digest = buildDigest(clean.events, versions);
  out.versions = versions;
  Object.assign(out, rest);
  // Built from the redacted file; not scrubbed again, so its own words ("window", "Screen") stay readable even when a
  // world document has that name.
  out.summary = summaryMarkdown(out);
  out.redaction = { ...r.report, knownLiterals: r.literalCount };
  return out;
}

export function fileName(date = new Date(), ext = "json") {
  return `dxcufgbs-debug-${fileStamp(date)}.${ext}`;
}

function download(data, type, filename) {
  const save = globalThis.foundry?.utils?.saveDataToFile;
  if (typeof save === "function") return save(data, type, filename);
  const blob = new Blob([data], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/**
 * GM: builds the file and downloads it, zipped when asked or when the JSON is over AUTO_ZIP_BYTES (plain JSON when
 * the browser can't zip). Refuses a final file over MAX_EXPORT_BYTES.
 * @returns {{ok: boolean, json: string, filename: string, bytes: number, zipped: boolean, data: string|Uint8Array}}
 */
export async function exportFile(report, selected, { zip = false } = {}) {
  const file = await buildFile(report, selected);
  const json = JSON.stringify(file, null, 2);
  const jsonBytes = new TextEncoder().encode(json);
  const date = new Date();
  let filename = fileName(date);
  let data = json;
  let type = "application/json";
  let zipped = false;
  if (zip || jsonBytes.length > AUTO_ZIP_BYTES) {
    const archive = await zipOneFile(filename, jsonBytes, date);
    if (archive) {
      data = archive;
      type = "application/zip";
      filename = fileName(date, "zip");
      zipped = true;
    } else if (zip) {
      ui.notifications.warn(t("Notify.NoZip"));
    }
  }
  const bytes = zipped ? data.length : jsonBytes.length;
  if (bytes > MAX_EXPORT_BYTES) {
    ui.notifications.error(t("Notify.TooBig", { size: formatBytes(bytes), max: formatBytes(MAX_EXPORT_BYTES) }));
    return { ok: false, json, filename, bytes, zipped, data };
  }
  download(data, type, filename);
  ui.notifications.info(t("Notify.Exported", { file: filename, size: formatBytes(bytes) }));
  return { ok: true, json, filename, bytes, zipped, data };
}

/**
 * "Copy issue summary": Foundry, system and browser versions, the selected modules' exact code (version, tag,
 * commit) and the top of the error digest of the current / last recording, as Markdown.
 */
export async function issueSummary(selected = []) {
  const b = browserInfo();
  const events = recorder.storedEvents();
  // Module titles are not private, but they go through a Redactor anyway; events were redacted when stored.
  const r = Redactor.fromWorld(game, globalThis.location);
  const versions = scrubVersions(await codeVersions([...selected, ...modulesInEvents(events)]), r);
  const lines = [
    `**Foundry VTT:** ${game.version ?? "?"} (build ${game.release?.build ?? "?"})`,
    `**System:** ${game.system?.id ?? "?"} ${game.system?.version ?? ""}`.trimEnd(),
    `**Browser:** ${b.family} ${b.version} on ${b.os} (${b.desktopApp ? "desktop app" : "browser"})`,
    `**Recorder:** ${MODULE_ID} ${recorderVersion()}`,
    "**Modules:**"
  ];
  if (!selected.length) lines.push("- (no module ticked)");
  for (const id of selected) {
    const mod = game.modules.get(id);
    const v = versions.modules[id] ?? {};
    const code = [v.tag, v.commit ? `commit ${short(v.commit)}${v.branch ? ` (${v.branch})` : ""}` : null, v.repo].filter(Boolean).join(" · ");
    const title = r.scrubString(mod?.title ?? id, { maxLength: 120 });
    const version = r.scrubString(v.version ?? mod?.version ?? "?", { version: true, maxLength: 60 });
    lines.push(`- ${title} (\`${id}\`) ${version}${code ? ` · ${code}` : ""}`);
  }
  const digest = buildDigest(events, versions);
  if (digest.length) lines.push("**Errors (most frequent first):**", ...digestLines(digest, 5));
  return lines.join("\n");
}
