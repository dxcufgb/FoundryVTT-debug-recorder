// The privacy gate: runs the whole recorder (main.js, API, capture, export) against a mocked Foundry world seeded with
// recognisable names, the instance's URL, IPs, the world title, chat and journal text, and fails if any seeded value
// shows up in the exported file or the issue summary. Run with: node --test tests/*.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";

/* -------------------------------------------- */
/*  Seeds: none of these may reach the file     */
/* -------------------------------------------- */

const ORIGIN = "http://skivbrytare.local:30000";
const SEED = {
  userGM: "Kalle Anka", userPlayer: "Musse Pigg", actor: "Elira Moonwhisper", token: "Elira the Brave", item: "Frostbrand Greataxe",
  scene: "Drakhålan Keep", journal: "Secret Plans of Vex", page: "Vex Ledger", combatant: "Grimtooth Raider",
  newActor: "Zorbath Newcomer", worldTitle: "Secret Campaign of Doom", worldId: "my-secret-world",
  worldDescription: "Only for my closest friends on Thursdays", chat: "The dragon sleeps under the old mill",
  host: "skivbrytare.local", hostPort: "skivbrytare.local:30000", ip4: "192.168.1.20", ip4b: "10.0.0.5",
  ip6: "fe80::1ff:fe23:4567:890a", email: "kalle@example.com", folder: "Villains of Thornwick",
  // Only in a journal page (not in chat), so chat learning can't hide a gap in journal text.
  journalText: "The vault code is nine four seven beneath the lighthouse", journalBlock: "Bribe the harbourmaster with amber wine"
};
const IDS = { gm: "GmUser0000000001", player: "PlUser0000000002", actor: "Act0r00000000001", item: "Item000000000001",
  scene: "Scene00000000001", token: "Token00000000001", journal: "Journ00000000001", page: "Page000000000001",
  message: "Msg0000000000001", combat: "Combat0000000001", combatant: "Cmbt000000000001", newActor: "NewAct0000000001" };

/* -------------------------------------------- */
/*  Mocked Foundry                              */
/* -------------------------------------------- */

class Collection extends Map {
  constructor(docs = []) {
    super(docs.map(d => [d.id, d]));
  }
  *[Symbol.iterator]() { yield* this.values(); }
  get contents() { return [...this.values()]; }
  filter(fn) { return this.contents.filter(fn); }
}

const hooks = {};
const Hooks = {
  on(name, fn) { (hooks[name] ??= []).push({ fn, id: ++Hooks._id }); return Hooks._id; },
  once(name, fn) { const id = Hooks.on(name, (...a) => { Hooks.off(name, id); return fn(...a); }); return id; },
  off(name, id) { hooks[name] = (hooks[name] ?? []).filter(h => h.id !== id && h.fn !== id); },
  callAll(name, ...args) { for (const h of [...(hooks[name] ?? [])]) h.fn(...args); return true; },
  call(name, ...args) { return Hooks.callAll(name, ...args); },
  _id: 0
};

const settingValues = new Map();
const settingsRegistry = new Map();
const settings = {
  settings: settingsRegistry,
  register(ns, key, data) { settingsRegistry.set(`${ns}.${key}`, { ...data, namespace: ns, key }); },
  registerMenu() {},
  get(ns, key) {
    const k = `${ns}.${key}`;
    return settingValues.has(k) ? structuredClone(settingValues.get(k)) : structuredClone(settingsRegistry.get(k)?.default);
  },
  async set(ns, key, value) {
    settingValues.set(`${ns}.${key}`, value);
    settingsRegistry.get(`${ns}.${key}`)?.onChange?.(value);
    return value;
  }
};

const FAKE = "dxcufgbs-fake";
const users = new Collection([
  { id: IDS.gm, name: SEED.userGM, role: 4, isGM: true, active: true },
  { id: IDS.player, name: SEED.userPlayer, role: 1, isGM: false, active: true, character: { name: SEED.actor } }
]);
const actor = {
  id: IDS.actor, name: SEED.actor, prototypeToken: { name: SEED.token },
  items: [{ id: IDS.item, name: SEED.item, flags: { [FAKE]: { charges: 3 } } }], effects: [],
  flags: { [FAKE]: { notes: { [SEED.actor]: `note about ${SEED.actor}` }, owner: IDS.player, [IDS.item]: { linked: true } } }
};
const scene = {
  id: IDS.scene, name: SEED.scene, navName: SEED.scene,
  tokens: [{ id: IDS.token, name: SEED.token, flags: { [FAKE]: { effect: "embers" } } }], notes: [], tiles: [], lights: [], sounds: [], regions: [], drawings: [], walls: []
};
const journal = {
  id: IDS.journal, name: SEED.journal, ownership: { default: 3, [IDS.player]: 2 },
  pages: [{ id: IDS.page, name: SEED.page, text: { content: `<h2>Notes</h2><p>${SEED.journalText}. Then go home.</p><ul><li>${SEED.journalBlock}</li></ul>` } }],
  flags: { [FAKE]: { store: "shared", quests: { Q1x2Q3x4Q5x6Q7x8: { title: SEED.journal, status: "active" } } } }
};

const modules = new Collection([
  { id: "dxcufgbs-debug-recorder", title: "Dxcufgb's Debug Recorder", version: "0.1.0", active: true, authors: new Set([{ name: "Dxcufgb" }]) },
  {
    id: FAKE, title: "Dxcufgb's Fake Module", version: "1.2.0", active: true, socket: true, authors: new Set([{ name: "Dxcufgb" }]),
    // Public package metadata; the manifest is served from the instance itself, which must never reach the file.
    url: "https://github.com/dxcufgb/FoundryVTT-fake", manifest: `${ORIGIN}/modules/${FAKE}/releases/download/v1.2.0/module.json`,
    download: "https://github.com/dxcufgb/FoundryVTT-fake/releases/latest/download/module.zip",
    compatibility: { minimum: "13", verified: "13" },
    relationships: { requires: new Set([{ id: "lib-wrapper", type: "module" }]), recommends: new Set([{ id: "dice-so-nice", type: "module" }]) },
    api: { open() {}, get count() { throw new Error("getters must not be called"); }, version: 2 }
  },
  { id: "dxcufgbs-late", title: "Dxcufgb's Late Module", version: "0.3.0", active: true, authors: [{ name: "Dxcufgb" }], url: `${ORIGIN}/late`, download: `${ORIGIN}/late.zip` },
  { id: "lively-tokens-x", title: "Lively Tokens", version: "2.0.0", active: true, authors: [{ name: "Dxcufgb" }] },
  { id: "lib-wrapper", title: "libWrapper", version: "1.13.0", active: true, authors: [] },
  { id: "old-thing", title: "Old", version: "0.0.1", active: false, authors: [] }
]);

const notifications = {
  notify(message, type) { return { message, type }; },
  info(m, o) { return this.notify(m, "info", o); },
  warn(m, o) { return this.notify(m, "warning", o); },
  error(m, o) { return this.notify(m, "error", o); }
};

const windowListeners = {};
function fakeElement() {
  const el = {
    dataset: {}, classList: { add() {} }, children: [], style: {},
    setAttribute() {}, addEventListener() {}, remove() {}, append(c) { el.children.push(c); },
    querySelector: () => ({ textContent: "" }), querySelectorAll: () => [], getContext: () => null
  };
  return el;
}

let saved = null;
/** Windows rendered (class names): the recorder opens on "ready" for a GM. */
const opened = [];
const SHA_FAKE = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1234";
const SHA_LATE = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb5678";
const GIT_FILES = {
  [`modules/${FAKE}/.git/HEAD`]: "ref: refs/heads/main\n",
  [`modules/${FAKE}/.git/refs/heads/main`]: `${SHA_FAKE}\n`,
  "modules/dxcufgbs-late/.git/HEAD": `${SHA_LATE}\n`
};
const fetchCalls = [];
const realConsole = { error: console.error, warn: console.warn, log: console.log, info: console.info };

function install() {
  const g = globalThis;
  g.Hooks = Hooks;
  g.CONST = { USER_ROLES: { NONE: 0, PLAYER: 1, TRUSTED: 2, ASSISTANT: 3, GAMEMASTER: 4 }, DOCUMENT_OWNERSHIP_LEVELS: { INHERIT: -1, NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } };
  g.ui = { notifications };
  g.foundry = {
    applications: {
      api: { ApplicationV2: class { render() { opened.push(this.constructor.name); return this; } }, HandlebarsApplicationMixin: Base => class extends Base {}, DialogV2: { confirm: async () => true } },
      instances: new Map()
    },
    utils: { saveDataToFile: (data, type, filename) => { saved = { data, type, filename }; } }
  };
  g.window = g;
  g.location = { href: `${ORIGIN}/game`, origin: ORIGIN, host: SEED.hostPort, hostname: SEED.host, port: "30000", protocol: "http:" };
  Object.defineProperty(g, "navigator", {
    value: { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.86 Safari/537.36" },
    configurable: true, writable: true
  });
  g.screen = { width: 1920, height: 1080 };
  g.devicePixelRatio = 1.25;
  g.innerWidth = 1536;
  g.innerHeight = 730;
  g.outerWidth = 1536;
  g.addEventListener = (type, fn) => { (windowListeners[type] ??= []).push(fn); };
  g.removeEventListener = (type, fn) => { windowListeners[type] = (windowListeners[type] ?? []).filter(f => f !== fn); };
  g.document = { createElement: fakeElement, body: fakeElement() };
  // Same-origin static files: the fake module and the late module are git clones (.git served, like Foundry does).
  g.fetch = async url => {
    fetchCalls.push(String(url));
    const body = GIT_FILES[url];
    return body === undefined
      ? { ok: false, status: 404, headers: { get: () => "text/html" }, text: async () => `<html>${ORIGIN}</html>` }
      : { ok: true, status: 200, headers: { get: () => "application/octet-stream" }, text: async () => body };
  };
  g.game = {
    version: "13.348", release: { generation: 13, build: 348, channel: "stable" },
    system: { id: "dnd5e", version: "5.1.0" },
    world: { id: SEED.worldId, title: SEED.worldTitle, description: `<p>${SEED.worldDescription}</p>` },
    modules, settings, users, user: users.get(IDS.gm),
    keybindings: { register() {} },
    i18n: { lang: "en", localize: k => k, format: (k, d) => `${k} ${JSON.stringify(d)}` },
    actors: new Collection([actor]),
    items: new Collection([]),
    scenes: new Collection([scene]),
    journal: new Collection([journal]),
    macros: new Collection([]),
    playlists: new Collection([]),
    tables: new Collection([]),
    cards: new Collection([]),
    folders: new Collection([{ id: "Fold000000000001", name: SEED.folder }]),
    combats: new Collection([{ id: IDS.combat, combatants: [{ id: IDS.combatant, name: SEED.combatant }] }]),
    messages: new Collection([{ id: IDS.message, content: `<p>${SEED.chat}</p>`, speaker: { alias: SEED.actor } }]),
    socket: { connected: true, hasListeners: ch => ch === `module.${FAKE}` },
    clipboard: { copyPlainText: async () => {} }
  };
  // The fake module's own settings, with private values in them.
  settings.register(FAKE, "serverUrl", { scope: "world", config: true, type: String, default: `${ORIGIN}/api` });
  settings.register(FAKE, "favourite", { scope: "client", config: false, type: String, default: SEED.actor });
  settings.register(FAKE, "mode", { scope: "world", config: true, type: String, default: "fixed", choices: { fixed: "Fixed", online: "Online" } });
  settings.register(FAKE, "size", { scope: "world", config: true, type: Number, default: 4 });
  settings.register(FAKE, "layout", { scope: "client", config: false, type: Object, default: { [SEED.scene]: { x: 1, label: SEED.token } } });
}

/** A module error with the instance URL in its stack, so it is attributed to the fake module. */
function moduleError(message, Ctor = Error) {
  const err = new Ctor(message);
  err.stack = `${Ctor.name}: ${message}\n    at FakeSheet.render (${ORIGIN}/modules/${FAKE}/scripts/sheet.js:42:7)\n    at ${ORIGIN}/scripts/foundry.mjs:1000:3`;
  return err;
}

const leaky = `${SEED.actor} (Actor.${IDS.actor}) in ${SEED.scene} on ${ORIGIN}/worlds/${SEED.worldId}/maps/keep.webp from ${SEED.ip4}, ` +
  `${SEED.ip6} via ${SEED.hostPort}; world ${SEED.worldTitle}; chat "${SEED.chat}"; mail ${SEED.email}; user ${SEED.userPlayer}`;

let recorder;
let exporter;
let api;
let file;
let fileJson;

before(async () => {
  install();
  for (const k of Object.keys(realConsole)) console[k] = () => {};
  // The fake module listens for the recorder's ready hook from import time, like the sibling modules do.
  Hooks.once("dxcufgbs-debug-recorder.ready", rec => rec.register(FAKE, {
    snapshot: () => ({
      openSheets: 2, lastActor: SEED.actor, server: ORIGIN, ip: SEED.ip4, world: SEED.worldTitle, lastChat: SEED.chat,
      name: SEED.token, img: `worlds/${SEED.worldId}/portraits/elira.webp`, docIds: [IDS.actor, IDS.scene], byUser: { [IDS.player]: 1 },
      nested: { description: SEED.worldDescription, path: `C:\\Users\\${SEED.userGM}\\Foundry\\Data\\worlds\\${SEED.worldId}\\x.png` }
    })
  }));
  ({ api } = await import("../scripts/main.js"));
  recorder = await import("../scripts/recorder.js");
  exporter = await import("../scripts/export.js");
  for (const h of ["init", "setup"]) Hooks.callAll(h);
  for (const h of [...(hooks.ready ?? [])]) await h.fn();
});

after(() => Object.assign(console, realConsole));

test("API: locked names on the module and in the ready hook; nothing stored before Start", () => {
  assert.equal(game.modules.get("dxcufgbs-debug-recorder").api, api);
  assert.deepEqual(Object.keys(api).sort(), ["breadcrumb", "isRecording", "register"]);
  assert.equal(api.isRecording(), false);
  assert.equal(recorder.isRegistered(FAKE), true);
  assert.doesNotThrow(() => api.breadcrumb(FAKE, "early.crumb", { x: 1 }));
  assert.doesNotThrow(() => api.register(null));
  assert.equal(recorder.getState().hasData, false);
  // openOnLoad (client, default on): the GM gets the recorder window as soon as the world is ready.
  assert.equal(game.settings.get("dxcufgbs-debug-recorder", "openOnLoad"), true);
  assert.equal(game.settings.settings.get("dxcufgbs-debug-recorder.openOnLoad").scope, "client");
  assert.ok(opened.includes("RecorderApp"), "the recorder window opens on ready for a GM");
});

test("full pipeline: record, export, and no seeded value anywhere in the file", async () => {
  assert.equal(await recorder.start([FAKE, "dxcufgbs-late"], { autoStopMinutes: 30 }), true);
  assert.equal(api.isRecording(), true);
  assert.equal(game.settings.get("dxcufgbs-debug-recorder", "status").recording, true);

  // A late registrant is still accepted and gets its start snapshot.
  api.register("dxcufgbs-late", { snapshot: () => ({ ready: true, who: SEED.userPlayer }) });
  // Breadcrumbs: only for selected modules.
  api.breadcrumb(FAKE, "app.render", { actor: SEED.actor, url: `${ORIGIN}/x`, ip: SEED.ip4, docId: IDS.actor, scene: IDS.scene, name: SEED.token, n: 3 });
  api.breadcrumb("lively-tokens-x", "not.selected", { x: 1 });
  // A module quoting journal text in a free-form field: the whole text, one paragraph's sentence, and a list item.
  api.breadcrumb(FAKE, "journal.quote", { snippet: SEED.journalText, line: `found: ${SEED.journalBlock}!` });
  console.error(moduleError(`could not parse "${SEED.journalText}"`));
  api.breadcrumb(FAKE, "huge", Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`k${i}`, "y".repeat(40)])));

  console.error(moduleError(`Sheet failed: ${leaky}`, TypeError));
  for (let i = 0; i < 3; i++) console.error(moduleError("same error again"));
  console.warn("Something is deprecated: use B", moduleError(`deprecated for ${SEED.actor}`));
  console.log("state", moduleError(`log line about ${SEED.token}`), { content: SEED.chat, owner: IDS.player, label: SEED.item });
  console.log(`unattributed ${SEED.actor}`);
  for (const fn of windowListeners.error ?? []) fn({ error: moduleError(`uncaught ${leaky}`), message: "x", filename: `${ORIGIN}/modules/${FAKE}/scripts/main.js`, lineno: 3, colno: 9 });
  for (const fn of windowListeners.unhandledrejection ?? []) fn({ reason: moduleError(`rejected ${leaky}`) });
  // Like Foundry's Hooks.onError: a wrapper error (logged where it was caught) with the thrown error as its cause.
  const hookCause = moduleError(`hook failed for ${SEED.journal}`);
  const hookErr = new Error(`Error thrown in hooked function 'onUpdateActor' for hook 'updateActor'. ${hookCause.message}`, { cause: hookCause });
  hookErr.stack = `Error: ${hookErr.message}\n    at Hooks.onError (${ORIGIN}/modules/lib-wrapper/lib-wrapper.js:1:34500)\n    at ${ORIGIN}/scripts/foundry.mjs:2000:1`;
  console.error(hookErr);
  Hooks.callAll("error", "Hooks.#call", hookErr, { hook: "updateActor", fn: function onUpdateActor() {} });
  Hooks.callAll("error", "Hooks.#call", moduleError(`second hook failed ${SEED.combatant}`), { hook: "renderChatMessage" });
  ui.notifications.error(`Could not open ${SEED.actor}'s sheet at ${SEED.ip4b}`);
  ui.notifications.info(`info ${SEED.actor} is not recorded`);

  // A document created during the recording: its name is learnt and scrubbed from then on.
  const newcomer = { id: IDS.newActor, name: SEED.newActor, items: [], effects: [] };
  Hooks.callAll("createActor", newcomer);
  console.error(moduleError(`${SEED.newActor} (${IDS.newActor}) failed`));

  const report = {
    steps: `1. Open ${SEED.actor} at ${ORIGIN}\n2. From ${SEED.ip4} as ${SEED.userGM}`,
    expected: `${SEED.worldTitle} loads`,
    actual: SEED.chat
  };
  const during = await exporter.buildFile(report);
  assert.equal(during.recording.stillRecording, true);

  assert.equal(await recorder.stop(), true);
  assert.equal(api.isRecording(), false);
  console.error(moduleError("after stop: not recorded"));

  file = await exporter.buildFile(report);
  fileJson = JSON.stringify(file);
  const lower = fileJson.toLowerCase();
  const allSeeds = [...Object.values(SEED), ...Object.values(IDS), ORIGIN, ":30000", "Elira", "Moonwhisper", "Zorbath", "Thursdays"];
  for (const seed of allSeeds) assert.ok(!lower.includes(String(seed).toLowerCase()), `seeded value leaked into the file: ${seed}`);
  for (const seed of allSeeds) assert.ok(!JSON.stringify(during).toLowerCase().includes(String(seed).toLowerCase()), `seeded value leaked while recording: ${seed}`);
});

test("the file is complete and self-describing", () => {
  assert.equal(file.format, "dxcufgbs-debug-recorder");
  assert.equal(file.schemaVersion, 1);
  assert.equal(file.recorderVersion, "0.1.0");
  assert.deepEqual(file.selectedModules, [FAKE, "dxcufgbs-late"]);
  assert.ok(file.recording.startedAt && file.recording.durationMs >= 0);
  assert.deepEqual(Object.keys(file).at(-1), "redaction");
  assert.deepEqual(Object.keys(file).slice(0, 8), ["format", "schemaVersion", "recorderVersion", "createdAt", "recording", "selectedModules", "digest", "versions"]);
  assert.equal(file.environment.foundry.version, "13.348");
  assert.equal(file.environment.system.id, "dnd5e");
  assert.equal(file.environment.browser.family, "Chrome");
  assert.equal(file.environment.browser.os, "Windows");
  assert.equal(file.environment.client.label, "GM 1");
  assert.equal(file.environment.modules.disabledCount, 1);
  assert.equal(file.environment.users.connected, 2);
  assert.ok(file.environment.relationships[FAKE].requires[0].met);
  assert.equal(typeof file.summary, "string");
  assert.ok(file.summary.includes(FAKE));

  const fake = file.modules[FAKE];
  assert.equal(fake.registered, true);
  assert.ok(fake.snapshots.start && fake.snapshots.stop && fake.snapshots.export);
  assert.equal(fake.snapshots.start.openSheets, 2);
  assert.equal(fake.snapshots.start.lastActor, "‹name›");
  assert.deepEqual(fake.snapshots.start.docIds.length, 2);
  assert.equal(file.modules["dxcufgbs-late"].snapshots.start.late, true);
  const setting = key => fake.stateStart.settings.find(s => s.key === key);
  assert.equal(setting("mode").value, "fixed");
  assert.equal(setting("size").value, 4);
  assert.match(setting("serverUrl").value, /^‹string:\d+›$/);
  assert.deepEqual(fake.stateStart.api.find(m => m.member === "count"), { member: "count", type: "getter" });
  assert.equal(fake.stateStart.flags.Actor.documents, 1);
  assert.equal(fake.stateStart.flags.Item.documents, 1);
  assert.equal(fake.stateStart.flags.Token.documents, 1);
  assert.equal(fake.stateStart.journalStores.length, 1);
  assert.equal(fake.stateStart.journalStores[0].defaultOwnership, 3);
  assert.deepEqual(fake.stateStart.journalStores[0].userOwnership, { level2: 1 });
  assert.equal(file.environment.client.role, 4);
  assert.match(fake.stateStart.journalStores[0].docId, /^J\d+$/);
  assert.equal(fake.stateStart.socket.listening, true);

  const types = new Set(file.events.map(e => e.type));
  for (const type of ["breadcrumb", "console", "deprecation", "error", "rejection", "hookError", "notification"]) assert.ok(types.has(type), `no ${type} event`);
  assert.ok(file.events.every(e => e.module !== "lively-tokens-x"));
  const hookEvent = file.events.find(e => e.type === "hookError" && e.hook === "updateActor");
  assert.ok(hookEvent, "the console.error of a hook error is merged with the hook name");
  assert.equal(hookEvent.module, FAKE, "a wrapped error is blamed on where its cause was thrown");
  assert.equal(hookEvent.frames[0].path, "scripts/sheet.js");
  assert.ok(file.events.some(e => e.type === "hookError" && e.hook === "renderChatMessage"));
  assert.equal(file.events.find(e => String(e.message).endsWith("same error again")).count, 3);
  assert.ok(file.events.filter(e => e.type === "console").every(e => e.module === FAKE));
  assert.ok(file.events.every(e => !String(e.message ?? "").includes("after stop")));
  assert.ok(!file.events.some(e => e.type === "notification" && e.notificationType === "info"));
  const crumb = file.events.find(e => e.key === "app.render");
  assert.equal(crumb.data.n, 3);
  assert.match(crumb.data.docId, /^A\d+$/);
  assert.equal(file.events.find(e => e.key === "huge").data.truncated, true);
  assert.ok(file.events.find(e => e.type === "error").stack.includes(`modules/${FAKE}/scripts/sheet.js:42:7`));

  // Exact code per module: version, tag, repo slug (never a URL), commit from the served .git.
  assert.deepEqual(file.versions.modules[FAKE], { version: "1.2.0", tag: "v1.2.0", repo: "dxcufgb/FoundryVTT-fake", commit: SHA_FAKE, branch: "main", commitReason: null });
  assert.deepEqual(file.versions.modules["dxcufgbs-late"], { version: "0.3.0", tag: null, repo: null, commit: SHA_LATE, branch: null, commitReason: null });
  assert.deepEqual(file.versions.core, { foundry: "13.348", generation: 13, build: 348 });
  assert.ok(fetchCalls.length && fetchCalls.every(u => u.startsWith("modules/") && !u.includes("config")), "only relative .git paths");

  // Structured frames with the exact code of each frame.
  const errorEvent = file.events.find(e => e.type === "error");
  assert.deepEqual(errorEvent.frames[0], { fn: "FakeSheet.render", line: 42, col: 7, module: FAKE, path: "scripts/sheet.js", version: "1.2.0", tag: "v1.2.0", commit: SHA_FAKE });
  assert.deepEqual(errorEvent.frames[1], { fn: null, line: 1000, col: 3, core: true, path: "scripts/foundry.mjs", foundry: "13.348", build: 348 });
  assert.equal(typeof errorEvent.stack, "string");

  // The digest: one group per distinct error / warning, most frequent first, with its context.
  const digest = file.digest;
  assert.ok(digest.length >= 6);
  for (let i = 1; i < digest.length; i++) {
    assert.ok(digest[i - 1].count > digest[i].count || (digest[i - 1].count === digest[i].count && digest[i - 1].firstT <= digest[i].firstT), "sorted");
  }
  assert.equal(digest[0].count, 3);
  const sheetGroup = digest.find(g => g.type === "console" && g.message.startsWith("TypeError: Sheet failed"));
  assert.equal(sheetGroup.top, `modules/${FAKE}/scripts/sheet.js:42:7`);
  assert.equal(sheetGroup.module, FAKE);
  assert.equal(sheetGroup.commit, SHA_FAKE);
  assert.equal(sheetGroup.topFrame.commit, SHA_FAKE);
  const crumbSeq = file.events.find(e => e.key === "app.render").seq;
  assert.ok(sheetGroup.before.breadcrumbs.includes(crumbSeq));
  assert.equal(file.events[sheetGroup.seq].message, sheetGroup.message);
  const notifGroup = digest.find(g => g.type === "notification");
  assert.ok(digest.find(g => g.seq > notifGroup.seq).before.notifications.includes(notifGroup.seq));
  assert.ok(file.summary.includes("### Error digest") && file.summary.includes(SHA_FAKE.slice(0, 7)));

  for (const cat of ["names", "texts", "worldStrings", "hosts", "ips", "ids", "droppedKeys", "worldPaths", "emails"]) {
    assert.ok(file.redaction[cat] > 0, `redaction report counts no ${cat}`);
  }
});

test("export and issue summary contain no seeded value", async () => {
  const result = await exporter.exportFile({ steps: SEED.actor }, []);
  assert.equal(result.ok, true);
  assert.equal(result.zipped, false);
  assert.match(saved.filename, /^dxcufgbs-debug-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\dZ\.json$/);
  const plain = saved.data;

  const zipped = await exporter.exportFile({ steps: SEED.actor }, [], { zip: true });
  assert.equal(zipped.zipped, true);
  assert.equal(saved.type, "application/zip");
  assert.match(saved.filename, /^dxcufgbs-debug-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\dZ\.zip$/);
  const view = new DataView(saved.data.buffer, saved.data.byteOffset, saved.data.byteLength);
  const nameLen = view.getUint16(26, true);
  const inner = zlib.inflateRawSync(saved.data.subarray(30 + nameLen, 30 + nameLen + view.getUint32(18, true))).toString("utf8");
  assert.equal(new TextDecoder().decode(saved.data.subarray(30, 30 + nameLen)), saved.filename.replace(/\.zip$/, ".json"));
  assert.equal(JSON.parse(inner).format, "dxcufgbs-debug-recorder");

  const summary = await exporter.issueSummary([FAKE]);
  assert.ok(summary.includes("13.348") && summary.includes("dnd5e 5.1.0") && summary.includes(`${FAKE}\`) 1.2.0`));
  assert.ok(summary.includes("v1.2.0") && summary.includes(SHA_FAKE.slice(0, 7)) && summary.includes("dxcufgb/FoundryVTT-fake"));
  assert.ok(summary.includes("**Errors (most frequent first):**") && summary.includes("×3"));
  for (const text of [plain, inner, summary]) {
    const lower = text.toLowerCase();
    for (const seed of [...Object.values(SEED), ...Object.values(IDS), ORIGIN]) assert.ok(!lower.includes(String(seed).toLowerCase()), `leak: ${seed}`);
  }
});

/** Every entry of a zip archive, read through its central directory: [{name, data}]. */
function readZip(zip) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  let at = view.getUint32(end + 16, true);
  const out = [];
  for (let i = 0; i < view.getUint16(end + 10, true); i++) {
    const compSize = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const skip = local + 30 + view.getUint16(local + 26, true);
    out.push({ name: new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLen)), data: zlib.inflateRawSync(zip.subarray(skip, skip + compSize)).toString("utf8") });
    at += 46 + nameLen;
  }
  return out;
}

test("several recordings: names, own reports, delete, and two or more always download as one zip", async () => {
  const first = recorder.getState().recordings.at(-1);
  assert.equal(first.recording, false);
  // The GM names the bugs; names of the world's documents typed into a label must not reach the file or file name.
  // SEED.newActor was learnt from a create hook during the first recording and is not in game.actors: only that
  // recording's own Redactor knows it.
  assert.ok(!game.actors.contents.some(a => a.name === SEED.newActor));
  assert.equal(recorder.rename(first.id, `${SEED.actor} sheet breaks in ${SEED.scene} for ${SEED.userPlayer} after ${SEED.newActor}`), true);

  assert.equal(await recorder.start([FAKE], { autoStopMinutes: 30 }), true);
  const secondId = recorder.getState().activeId;
  assert.notEqual(secondId, first.id);
  assert.equal(recorder.getState().recordings.length, 2, "starting again keeps the earlier recording");
  console.error(moduleError("only in the second recording"));
  api.breadcrumb(FAKE, "second.crumb", { n: 1 });
  // A running recording can't be deleted.
  assert.equal(recorder.remove([secondId]), 0);
  assert.equal(await recorder.stop(), true);
  // An actor created after Stop (no create hook is watched any more), then named in the label and the report.
  const lateActor = { id: "LateAct000000001", name: "Quillon Afterstop", items: [], effects: [] };
  game.actors.set(lateActor.id, lateActor);
  recorder.rename(secondId, `Second bug ${SEED.worldTitle} ${ORIGIN} ${lateActor.name}`);
  recorder.setReport(secondId, "steps", `Open ${SEED.journal} and read "${SEED.chat}" with ${lateActor.name}`);

  // Each recording keeps its own events.
  assert.ok(recorder.storedEvents(secondId).some(e => String(e.message).includes("only in the second recording")));
  assert.ok(!recorder.storedEvents(first.id).some(e => String(e.message).includes("only in the second recording")));
  assert.ok(recorder.storedEvents(first.id).some(e => String(e.message).endsWith("same error again")));

  // One recording: a plain JSON file named after its (scrubbed) label.
  saved = null;
  const single = await exporter.exportRecordings([secondId]);
  assert.equal(single.ok, true);
  assert.equal(saved.type, "application/json");
  assert.match(saved.filename, /^dxcufgbs-debug-second-bug-[a-z0-9-]*\d{4}-\d\d-\d\dT\d\d-\d\d-\d\dZ\.json$/);
  const singleFile = JSON.parse(saved.data);
  assert.equal(singleFile.recording.number, 2);
  assert.match(singleFile.recording.label, /^Second bug /);
  assert.equal(singleFile.report.steps.includes("Open"), true);

  // Two recordings: always one zip, a JSON file per recording, even without the .zip box ticked.
  saved = null;
  const both = await exporter.exportRecordings([secondId, first.id], { zip: false });
  assert.equal(both.ok, true);
  assert.equal(both.zipped, true);
  assert.equal(saved.type, "application/zip");
  assert.match(saved.filename, /^dxcufgbs-debug-2-recordings-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\dZ\.zip$/);
  const entries = readZip(saved.data);
  assert.equal(entries.length, 2);
  assert.equal(new Set(entries.map(e => e.name)).size, 2, "unique names in the zip");
  for (const e of entries) assert.match(e.name, /^dxcufgbs-debug-[a-z0-9-]+\d{4}-\d\d-\d\dT\d\d-\d\d-\d\dZ(-\d+)?\.json$/);
  const [secondFile, firstFile] = entries.map(e => JSON.parse(e.data));
  assert.equal(secondFile.recording.number, 2);
  assert.equal(firstFile.recording.number, 1);
  assert.ok(secondFile.events.some(e => String(e.message).includes("only in the second recording")));
  assert.ok(!firstFile.events.some(e => String(e.message).includes("only in the second recording")));
  assert.equal(firstFile.report.steps, "", "each recording has its own report");
  assert.ok(firstFile.summary.includes("- Recording: "));

  const summary = await exporter.issueSummary([FAKE], { id: secondId });
  assert.ok(summary.startsWith("**Recording:** Second bug"));
  const firstSummary = await exporter.issueSummary([FAKE], { id: first.id });
  assert.ok(firstSummary.startsWith("**Recording:** ‹name› sheet breaks"));
  const allSeeds = [...Object.values(SEED), ...Object.values(IDS), ORIGIN, ":30000", "Elira", "Moonwhisper", "Drakhålan", "drakhalan", "Musse", "Zorbath", "Quillon", "Afterstop"];
  const texts = [saved.filename, ...entries.map(e => e.name), ...entries.map(e => e.data), single.filename, JSON.stringify(singleFile), summary, firstSummary];
  for (const text of texts) {
    const lower = text.toLowerCase();
    for (const seed of allSeeds) assert.ok(!lower.includes(String(seed).toLowerCase()), `seeded value leaked via a label or report: ${seed}`);
  }

  // Delete one; the other stays.
  assert.equal(recorder.remove([first.id]), 1);
  assert.deepEqual(recorder.getState().recordings.map(r => r.id), [secondId]);
  await assert.rejects(exporter.buildFile(null, [], { id: first.id }));

  // The list is capped.
  while (recorder.canStart()) {
    await recorder.start([FAKE], { autoStopMinutes: 30 });
    await recorder.stop();
  }
  assert.equal(recorder.getState().recordings.length, 20);
  assert.equal(await recorder.start([FAKE], { autoStopMinutes: 30 }), false);
  assert.equal(recorder.clear(), true);
  assert.equal(recorder.getState().hasData, false);
});

test("export without a recording, clear, caps", async () => {
  assert.equal(recorder.clear(), true);
  const adHoc = await exporter.buildFile({}, [FAKE]);
  assert.equal(adHoc.recording.recorded, false);
  assert.ok(adHoc.modules[FAKE].snapshots.export);
  assert.ok(!JSON.stringify(adHoc).toLowerCase().includes(SEED.actor.toLowerCase()));

  await recorder.start([FAKE], { autoStopMinutes: 30 });
  for (let i = 0; i < 10050; i++) api.breadcrumb(FAKE, "spam", { i });
  const state = recorder.getState();
  assert.equal(state.events, 10000);
  assert.equal(state.dropped, 50);
  await recorder.stop();
  assert.equal(game.settings.get("dxcufgbs-debug-recorder", "status").recording, false);
});
