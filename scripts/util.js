/*
 * Constants and small helpers. Nothing here touches Foundry globals at import time (the privacy test imports this
 * file in Node).
 */

export const MODULE_ID = "dxcufgbs-debug-recorder";
export const TEMPLATE_PATH = `modules/${MODULE_ID}/templates`;

/** The file format: `format` and `schemaVersion` at the top of every exported file. */
export const FORMAT = "dxcufgbs-debug-recorder";
export const SCHEMA_VERSION = 1;

/** Most events kept in one recording; later ones are only counted (`counts.dropped`). */
export const MAX_EVENTS = 10000;
/** Exports bigger than this are refused (GitHub issue attachments). */
export const MAX_EXPORT_BYTES = 20 * 1024 * 1024;
/** JSON bigger than this is exported as a .zip automatically (when the browser can zip). */
export const AUTO_ZIP_BYTES = 5 * 1024 * 1024;
/** A module snapshot bigger than this is replaced with {truncated, bytes}. */
export const MAX_SNAPSHOT_BYTES = 256 * 1024;
/** A breadcrumb's data bigger than this is replaced with {truncated, bytes}. */
export const MAX_BREADCRUMB_BYTES = 4096;
/** How long a module's snapshot() may take when it returns a promise. */
export const SNAPSHOT_TIMEOUT_MS = 3000;

/** Localize a DXDR.* key, formatting when data is given. */
export function t(key, data) {
  const full = `DXDR.${key}`;
  return data ? game.i18n.format(full, data) : game.i18n.localize(full);
}

export function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Values of a Map, Set, Foundry Collection, array or other iterable (empty for anything else). */
export function valuesOf(collection) {
  if (!collection) return [];
  try {
    if (typeof collection.values === "function") return Array.from(collection.values());
    if (typeof collection[Symbol.iterator] === "function") return Array.from(collection);
  } catch {
    // an odd collection: treat it as empty
  }
  return [];
}

/** Size of a value as JSON, in characters (0 when it can't be serialised). */
export function jsonSize(value) {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

export function recorderVersion() {
  return globalThis.game?.modules?.get(MODULE_ID)?.version ?? "0.0.0";
}

/** The author names of a module (v13 keeps them in a Set). */
export function authorsOf(mod) {
  return valuesOf(mod?.authors).map(a => (typeof a === "string" ? a : a?.name)).filter(n => typeof n === "string");
}

/** One of the user's own modules: id starting with "dxcufgbs-", or author "Dxcufgb" (Dice Trails, Lively Tokens…). */
export function isOwnModule(mod) {
  if (!mod?.id || mod.id === MODULE_ID) return false;
  return mod.id.startsWith("dxcufgbs-") || authorsOf(mod).some(n => n.trim().toLowerCase() === "dxcufgb");
}

/** Active modules the recorder can watch: the user's own, plus any other module that registered with the API. */
export function selectableModules(registeredIds = []) {
  const registered = new Set(registeredIds);
  return valuesOf(game.modules)
    .filter(m => m.active && m.id !== MODULE_ID && (isOwnModule(m) || registered.has(m.id)))
    .sort((a, b) => String(a.title ?? a.id).localeCompare(String(b.title ?? b.id)));
}

/** "4:05" or "1:02:03". */
export function formatDuration(ms) {
  const total = Math.max(0, Math.floor((ms ?? 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** UTC timestamp for file names: 2026-11-05T21-04-33Z. */
export function fileStamp(date = new Date()) {
  return date.toISOString().replace(/\.\d+Z$/, "Z").replaceAll(":", "-");
}

/** "1.4 MB" */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The CONST.USER_ROLES key of a role number ("GAMEMASTER", "PLAYER"…). */
export function roleKey(role) {
  const roles = globalThis.CONST?.USER_ROLES ?? {};
  return Object.entries(roles).find(([, v]) => v === role)?.[0] ?? "UNKNOWN";
}

const ROLE_LABELS = { GAMEMASTER: "GM", ASSISTANT: "Assistant GM", TRUSTED: "Trusted player", PLAYER: "Player" };

/** A client label with no name in it: role + index among the users of that role ("Player 2", "GM 1"). */
export function clientLabel(user) {
  if (!user) return "Unknown";
  const key = roleKey(user.role);
  const sameRole = valuesOf(game.users).filter(u => u.role === user.role).map(u => u.id).sort();
  const index = Math.max(0, sameRole.indexOf(user.id)) + 1;
  return `${ROLE_LABELS[key] ?? "User"} ${index}`;
}
