import { valuesOf, jsonSize, roleKey, clientLabel } from "./util.js";
import { WORLD_COLLECTIONS } from "./privacy.js";

/*
 * What the recorder reads about the client and the selected modules. Everything returned here is raw: the recorder
 * passes it through the Redactor before storing it. Nothing here reads names, chat, journal text or flag values.
 *
 * environmentHeader() → items 1–11 of the spec (always in the file, can't be switched off)
 * moduleState(id)     → items 12–15, 17, 18 for one selected module (16, its snapshot, comes from the API)
 */

/** Core settings that change how the canvas renders (item 11). Missing ones are skipped. */
const RENDER_SETTINGS = ["noCanvas", "performanceMode", "maxFPS", "pixelRatioResolutionScaling", "mipmap",
  "lightAnimation", "visionAnimation", "photosensitiveMode", "fontSize", "tokenDragPreview", "chatBubbles"];

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

/** Browser family + version (key "family": "name" keys are dropped by the privacy layer), OS, desktop app or browser, from the user agent (the full UA string is not kept). */
export function browserInfo(nav = globalThis.navigator) {
  const ua = String(nav?.userAgent ?? "");
  const desktopApp = /Electron\//.test(ua) || /FoundryVirtualTabletop/i.test(ua);
  const tests = [
    ["Edge", /Edg(?:e|A|iOS)?\/([\d.]+)/],
    ["Opera", /OPR\/([\d.]+)/],
    ["Vivaldi", /Vivaldi\/([\d.]+)/],
    ["Firefox", /Firefox\/([\d.]+)/],
    ["Chrome", /Chrome\/([\d.]+)/],
    ["Safari", /Version\/([\d.]+).*Safari/]
  ];
  let family = "Unknown";
  let version = "";
  for (const [n, re] of tests) {
    const m = ua.match(re);
    if (m) {
      family = n;
      version = m[1];
      break;
    }
  }
  if (family === "Chrome" && nav?.brave) family = "Brave";
  if (desktopApp) family = `${family} (Electron)`;
  const platform = String(nav?.userAgentData?.platform ?? "");
  let os = platform || "Unknown";
  if (!platform) {
    if (/Windows/.test(ua)) os = "Windows";
    else if (/Android/.test(ua)) os = "Android";
    else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
    else if (/Mac OS X|Macintosh/.test(ua)) os = "macOS";
    else if (/CrOS/.test(ua)) os = "ChromeOS";
    else if (/Linux/.test(ua)) os = "Linux";
  }
  return { family, version, os, desktopApp, mobile: !!nav?.userAgentData?.mobile || /Mobi/.test(ua) };
}

function displayInfo() {
  const w = globalThis.window ?? globalThis;
  return {
    screen: safe(() => ({ width: w.screen.width, height: w.screen.height })),
    devicePixelRatio: safe(() => w.devicePixelRatio),
    window: safe(() => ({ width: w.innerWidth, height: w.innerHeight })),
    // Browser zoom can't be read directly; outer/inner width is a fair estimate on desktop.
    zoomEstimate: safe(() => (w.innerWidth ? Math.round((w.outerWidth / w.innerWidth) * 100) / 100 : null)),
    uiScale: safe(() => game.settings.get("core", "uiConfig")?.uiScale ?? null)
  };
}

function webglInfo() {
  let temp = null;
  try {
    const renderer = globalThis.canvas?.app?.renderer;
    let gl = renderer?.gl ?? renderer?.context?.gl ?? null;
    if (!gl && typeof globalThis.document?.createElement === "function") {
      temp = document.createElement("canvas");
      gl = temp.getContext?.("webgl2") ?? temp.getContext?.("webgl") ?? null;
    }
    if (!gl || typeof gl.getParameter !== "function") return { available: false, pixi: safe(() => PIXI.VERSION) };
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    const info = {
      available: true,
      webgl: typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext ? 2 : 1,
      renderer: String(debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
      vendor: String(debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)),
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      pixi: safe(() => PIXI.VERSION),
      canvasActive: !!renderer
    };
    if (temp) gl.getExtension("WEBGL_lose_context")?.loseContext();
    return info;
  } catch {
    return { available: false };
  }
}

function renderSettings() {
  const out = {};
  for (const key of RENDER_SETTINGS) {
    if (!safe(() => game.settings.settings.has(`core.${key}`), false)) continue;
    const v = safe(() => game.settings.get("core", key));
    if (v === null || ["string", "number", "boolean"].includes(typeof v)) out[key] = v;
  }
  return out;
}

/** Required / recommended modules and systems of a module, and whether each is there (item 10). */
export function relationshipsOf(mod) {
  const rel = mod?.relationships ?? {};
  const check = r => {
    const type = r?.type ?? "module";
    let installed = null;
    let active = false;
    if (type === "system") {
      active = game.system?.id === r?.id;
      installed = active ? game.system : null;
    } else if (type === "module") {
      installed = game.modules.get(r?.id) ?? null;
      active = !!installed?.active;
    }
    return {
      id: String(r?.id ?? ""), type, met: active, installedVersion: installed?.version ?? null,
      wanted: r?.compatibility ? { minimum: r.compatibility.minimum ?? null, verified: r.compatibility.verified ?? null, maximum: r.compatibility.maximum ?? null } : null
    };
  };
  return {
    requires: valuesOf(rel.requires).map(check),
    recommends: valuesOf(rel.recommends).map(check),
    systems: valuesOf(rel.systems).map(s => ({ id: String(s?.id ?? ""), current: game.system?.id === s?.id }))
  };
}

/** Items 1–11. `selected` = ids of the selected modules. */
export function environmentHeader(selected = []) {
  const sel = new Set(selected);
  const all = valuesOf(game.modules);
  const active = all.filter(m => m.active);
  const users = valuesOf(game.users);
  return {
    foundry: {
      version: safe(() => game.version),
      generation: safe(() => game.release.generation),
      build: safe(() => game.release.build),
      channel: safe(() => game.release.channel)
    },
    system: { id: safe(() => game.system.id), version: safe(() => game.system.version) },
    browser: browserInfo(),
    display: displayInfo(),
    webgl: webglInfo(),
    language: safe(() => game.i18n.lang),
    client: { label: clientLabel(game.user), role: roleKey(game.user?.role) },
    users: {
      total: users.length,
      connected: users.filter(u => u.active).length,
      gmsConnected: users.filter(u => u.active && u.isGM).length
    },
    modules: {
      activeCount: active.length,
      disabledCount: all.length - active.length,
      active: active.map(m => ({ id: m.id, version: m.version ?? null, selected: sel.has(m.id) }))
    },
    relationships: Object.fromEntries(selected.map(id => [id, relationshipsOf(game.modules.get(id))])),
    rendering: renderSettings()
  };
}

/* -------------------------------------------- */
/*  Per selected module                         */
/* -------------------------------------------- */

const FOUNDRY_ID = /^[A-Za-z0-9]{16}$/;

/**
 * The shape of a value as "path:type" lines (numbers and booleans with their value; strings never). Keys that look
 * like document ids are written as <id>, so the shape shows structure, not identity.
 */
export function shapeOf(value, { maxLines = 150, maxDepth = 4, values = true } = {}) {
  const lines = new Map();
  const walk = (v, path, depth) => {
    if (lines.size >= maxLines) return;
    const type = v === null ? "null" : Array.isArray(v) ? `array(${v.length})` : typeof v;
    if (v && typeof v === "object" && !Array.isArray(v) && depth < maxDepth) {
      const keys = Object.keys(v);
      if (!keys.length) lines.set(path || "(root)", "object(0)");
      for (const k of keys) walk(v[k], path ? `${path}.${FOUNDRY_ID.test(k) ? "<id>" : k}` : (FOUNDRY_ID.test(k) ? "<id>" : k), depth + 1);
      return;
    }
    const line = path || "(root)";
    const shown = values && (typeof v === "number" || typeof v === "boolean") ? `${type}=${v}` : type;
    const prev = lines.get(line);
    lines.set(line, prev && prev !== shown ? `${prev.split("=")[0]}` : shown);
  };
  walk(value, "", 0);
  const out = [...lines].map(([p, tpe]) => `${p}:${tpe}`);
  if (lines.size >= maxLines) out.push("…");
  return out;
}

function typeName(type) {
  if (!type) return "unknown";
  if (typeof type === "function") return type.name || "function";
  return type.constructor?.name ?? typeof type;
}

/** A setting value without strings: string → ‹string:N› unless it is one of the setting's own choices. */
export function settingValue(value, choices) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return choices && Object.hasOwn(choices, value) ? value : `‹string:${value.length}›`;
  if (typeof value === "number" || typeof value === "boolean") return value;
  const plain = safe(() => (typeof value.toObject === "function" ? value.toObject() : value), {});
  return { shape: shapeOf(plain, { maxLines: 80 }) };
}

/** Item 13: the module's settings (key, scope, type, value without strings). */
function settingsOf(id) {
  const out = [];
  for (const s of valuesOf(game.settings?.settings)) {
    if (s?.namespace !== id) continue;
    const value = safe(() => game.settings.get(id, s.key));
    out.push({ key: s.key, scope: s.scope, type: typeName(s.type), config: !!s.config, value: settingValue(value, s.choices) });
    if (out.length >= 200) break;
  }
  return out;
}

/** Item 14: names and types of the module's API members (getters aren't called). */
export function apiMembers(api) {
  if (!api || (typeof api !== "object" && typeof api !== "function")) return null;
  const out = [];
  const seen = new Set();
  let obj = api;
  while (obj && obj !== Object.prototype && obj !== Function.prototype && out.length < 150) {
    for (const key of Object.getOwnPropertyNames(obj)) {
      if (seen.has(key) || key === "constructor") continue;
      seen.add(key);
      const d = Object.getOwnPropertyDescriptor(obj, key);
      let type = d?.get ? "getter" : typeof d?.value;
      if (type === "function" && /^class[\s{]/.test(safe(() => Function.prototype.toString.call(d.value), ""))) type = "class";
      out.push({ member: key, type });
    }
    obj = Object.getPrototypeOf(obj);
  }
  return out;
}

const EMBEDDED_FOR_FLAGS = {
  Actor: [["items", "Item"], ["effects", "ActiveEffect"]],
  Item: [["effects", "ActiveEffect"]],
  Scene: [["tokens", "Token"], ["tiles", "Tile"], ["notes", "Note"], ["lights", "AmbientLight"], ["sounds", "AmbientSound"],
    ["regions", "Region"], ["drawings", "Drawing"], ["walls", "Wall"]],
  JournalEntry: [["pages", "JournalEntryPage"]],
  Playlist: [["sounds", "PlaylistSound"]],
  Combat: [["combatants", "Combatant"]],
  RollTable: [["results", "TableResult"]]
};

function* worldDocuments() {
  for (const [key, type] of WORLD_COLLECTIONS) {
    for (const doc of valuesOf(game[key])) {
      yield [type, doc];
      for (const [childKey, childType] of EMBEDDED_FOR_FLAGS[type] ?? []) {
        for (const child of valuesOf(doc?.[childKey])) yield [childType, child];
      }
    }
  }
}

/** Items 15 + 17: documents carrying the module's flags (count, key shape, size) and its journal stores. */
function flagsOf(id) {
  const byType = {};
  const journals = [];
  const levels = Object.entries(globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS ?? {});
  const levelName = n => levels.find(([, v]) => v === n)?.[0] ?? String(n);
  for (const [type, doc] of worldDocuments()) {
    const flags = safe(() => doc.flags?.[id]);
    if (flags === null || flags === undefined) continue;
    const entry = (byType[type] ??= { documents: 0, bytes: 0, keys: new Set() });
    entry.documents++;
    entry.bytes += jsonSize(flags);
    if (entry.keys.size < 200) for (const line of shapeOf(flags, { maxLines: 60, values: false })) entry.keys.add(line);
    if (type === "JournalEntry" && journals.length < 25) {
      const ownership = safe(() => doc.ownership, {}) ?? {};
      const perUser = {};
      for (const [userId, level] of Object.entries(ownership)) {
        if (userId === "default") continue;
        const name = levelName(level);
        perUser[name] = (perUser[name] ?? 0) + 1;
      }
      journals.push({
        docId: doc.id,
        defaultOwnership: levelName(ownership.default ?? 0),
        userOwnership: perUser,
        pages: valuesOf(doc.pages).length,
        flagBytes: jsonSize(flags),
        flagKeys: Object.keys(flags).length
      });
    }
  }
  for (const entry of Object.values(byType)) entry.keys = [...entry.keys];
  return { byType, journalStores: journals };
}

/** Items 12–15, 17, 18 for one module. */
export function moduleState(id) {
  const mod = game.modules.get(id);
  if (!mod) return { installed: false };
  const active = valuesOf(game.modules).filter(m => m.active).map(m => m.id);
  const flags = safe(() => flagsOf(id), { byType: {}, journalStores: [] });
  return {
    installed: true,
    active: !!mod.active,
    version: mod.version ?? null,
    compatibility: { minimum: mod.compatibility?.minimum ?? null, verified: mod.compatibility?.verified ?? null, maximum: mod.compatibility?.maximum ?? null },
    loadOrder: active.indexOf(id) + 1 || null,
    settings: safe(() => settingsOf(id), []),
    api: safe(() => apiMembers(mod.api)),
    flags: flags.byType,
    journalStores: flags.journalStores,
    socket: {
      inManifest: !!mod.socket,
      connected: !!safe(() => game.socket.connected, false),
      listening: !!safe(() => game.socket.hasListeners(`module.${id}`), false)
    }
  };
}
