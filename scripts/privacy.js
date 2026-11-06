/*
 * The privacy layer. Everything the recorder stores goes through a Redactor *when it is stored* (and the whole file
 * once more at export). No Foundry globals here: it is unit tested in Node (tests/privacy.test.mjs), and
 * `absorbWorld` reads the `game` object it is given.
 *
 * What a Redactor does, in this order, to every string:
 *  1. data: URIs → [data-uri]
 *  2. URLs: the instance's origin never appears. A path under modules/<id>/ or systems/<id>/ is kept from there on
 *     (code files with :line:col, asset files without the file name); a world path becomes [world]/<folders>/ with the
 *     file name removed; any other URL → [url].
 *  3. File-system paths (C:\…, /home/…, worlds/…) the same way; anything else → [path].
 *  4. e-mail addresses → [email]; the instance's host name and any host:port → [host]; IPv4 / IPv6 → [ip].
 *  5. Literals collected from the world (longest first, word-boundary aware, case-insensitive, nothing under 3
 *     characters): names of users, actors, tokens, items, combatants, scenes, journals, folders… → ‹name›; chat and
 *     world-description text → ‹text›; world title and id → [world]. Module ids are never touched.
 *  6. Document ids (16 letters/digits) → per-recording pseudonyms (U1, A3, S2…). The mapping stays in memory, is
 *     never written to the file, and is dropped with the Redactor.
 * And to objects: keys such as name, content, text, notes, description, img, src, password… are dropped anywhere
 * (case-insensitive), keys are scrubbed like strings, documents become {document, docId}, functions/DOM nodes/
 * cycles become short markers, and depth, array length and string length are capped.
 * `report` counts every redaction per category; it goes at the end of the file.
 */

import { MODULE_ID } from "./util.js";

export const MASK = {
  name: "‹name›",
  text: "‹text›",
  world: "[world]",
  host: "[host]",
  url: "[url]",
  path: "[path]",
  ip: "[ip]",
  email: "[email]",
  dataUri: "[data-uri]"
};

/** Keys dropped anywhere in stored objects (compared lower-case). */
export const DROP_KEYS = new Set([
  "name", "names", "navname", "content", "contents", "text", "texts", "notes", "note", "description", "desc",
  "title", "flavor", "biography", "bio", "html", "innerhtml", "outerhtml", "body", "speaker", "alias",
  "img", "image", "images", "src", "thumb", "thumbnail", "avatar", "portrait", "texture",
  "password", "passwd", "email", "cookie", "cookies", "license", "licensekey", "session", "sessionid",
  "auth", "authorization", "credentials", "secret", "secrets", "apikey"
]);
const DROP_KEY_RE = new RegExp(
  "^(?:display|player|character|user|actor|token|scene|item|first|last|full|nick|real|world|journal|page|combatant|owner|author)name$" +
  "|password|passwd|secret|cookie|licen[cs]e|api[-_]?key|access[-_]?token|auth[-_]?token|session[-_]?id", "i");

export function isDroppedKey(key) {
  const k = String(key).toLowerCase();
  return DROP_KEYS.has(k) || DROP_KEY_RE.test(k);
}

/** Pseudonym prefixes per document type. */
export const ID_PREFIX = {
  User: "U", Actor: "A", Item: "I", Scene: "S", Token: "T", Combat: "C", Combatant: "CB", JournalEntry: "J",
  JournalEntryPage: "JP", ChatMessage: "M", Macro: "MC", Playlist: "PL", PlaylistSound: "PS", RollTable: "RT",
  TableResult: "TR", Cards: "K", Card: "KC", Folder: "F", ActiveEffect: "E", Tile: "TL", Note: "N",
  AmbientLight: "L", AmbientSound: "AS", Region: "R", Drawing: "D", Wall: "W", Adventure: "AD"
};

const CODE_EXT = /\.(?:m?js|cjs|ts|hbs|html?|css|json|map|wasm)$/i;
/** Top-level folders of Foundry's own client files, kept (without origin) in stacks. */
const CORE_ROOTS = new Set(["scripts", "common", "client", "client-esm", "ui", "lang", "css", "fonts", "icons", "sounds", "dist", "public", "resources", "node_modules"]);
const ID_RE = /(?<![A-Za-z0-9])[A-Za-z0-9]{16}(?![A-Za-z0-9])/g;
const PSEUDO_RE = /^[A-Z]{1,2}\d+$/;
const DATA_URI_RE = /\bdata:[\w/+.-]+(?:;[\w=.-]+)*,[A-Za-z0-9+/=%._-]*/gi;
const URL_RE = /\b(?:blob:)?(?:https?|wss?|file|ftp|chrome-extension|moz-extension|safari-extension|webpack):\/{1,3}[^\s"'<>()[\]{}`,]+/gi;
const WIN_PATH_RE = /(?<![\w])[A-Za-z]:[\\/][^\s"'<>|?*()`,]*/g;
const UNIX_PATH_RE = /(?<![\w.:/\]~-])\/[^\s"'<>()`,/][^\s"'<>()`,]*/g;
const REL_PATH_RE = /(?<![\w/.\]-])(?:modules|systems|worlds)\/[^\s"'<>()`,]+/gi;
const EMAIL_RE = /(?<![\w.+-])[\w.+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const HOST_PORT_RE = /(?<![\w.-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+([a-z][a-z0-9-]{0,23})(?::\d{2,5})(?![\w])/gi;
const LOCALHOST_RE = /\blocalhost(?::\d{2,5})?\b/gi;
const IPV4_RE = /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\d]|\.\d)/g;
const IPV6_RE = /(?<![\w:])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![\w:])/gi;
const STANDARD_ERRORS = new Set(["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "EvalError",
  "URIError", "AggregateError", "DOMException", "AbortError", "NotFoundError", "NotAllowedError", "NotSupportedError",
  "InvalidStateError", "SecurityError", "QuotaExceededError", "NetworkError", "TimeoutError"]);

/** Words of names that are never scrubbed on their own (they would wreck ordinary messages). */
const STOP_WORDS = new Set(["main", "test", "error", "token", "tokens", "actor", "actors", "scene", "scenes", "user", "users",
  "game", "player", "players", "gamemaster", "the", "and", "with", "from", "data", "undefined", "null", "true", "false",
  "function", "object", "class", "module", "modules", "scripts", "script", "render", "update", "create", "delete",
  "item", "items", "journal", "combat", "chat", "message", "world", "system", "this", "that", "none", "warn",
  "info", "debug", "foundry", "canvas", "hook", "hooks", "setting", "settings", "default", "new", "old", "copy"]);
/**
 * The recorder's own enum values. A string that is exactly one of these (or a client label such as "Player 2") is not
 * name-scrubbed, so a world with a user called "Player" or an item called "Error" still gets readable roles, levels and
 * types. Inside any longer string those words are scrubbed like every other name.
 */
const OWN_VALUES = new Set(["GAMEMASTER", "ASSISTANT", "TRUSTED", "PLAYER", "NONE", "UNKNOWN", "INHERIT", "LIMITED",
  "OBSERVER", "OWNER", "world", "client", "user", "error", "warn", "warning", "info", "log", "breadcrumb", "console",
  "deprecation", "rejection", "hookError", "notification", "snapshotError", "start", "stop", "export", "module", "system",
  "String", "Number", "Boolean", "Object", "Array", "function", "getter", "class", "object", "string", "number",
  "boolean", "undefined", "symbol", "bigint", "unknown", "Chrome", "Firefox", "Edge", "Safari", "Opera", "Vivaldi",
  "Brave", "Unknown", "Windows", "macOS", "Linux", "Android", "iOS", "ChromeOS", "stable", "testing", "development"]);
const CLIENT_LABEL_RE = /^(?:GM|Assistant GM|Trusted player|Player|User) \d+$/;
/** Keys that look like the recorder's own (lower camelCase identifiers) are never name-scrubbed. */
const OWN_KEY_RE = /^[a-z_$][A-Za-z0-9_$]{0,60}$/;
/** Keys whose values are version strings (never masked as IPs). */
const VERSION_KEY_RE = /version$|^(?:minimum|verified|maximum)$/i;
/** Document types whose names are people: each word of 4+ letters is scrubbed on its own too. */
const PERSON_TYPES = new Set(["User", "Actor", "Token", "Combatant"]);

const isWordChar = ch => /[\p{L}\p{N}_]/u.test(ch);
const WORD_TOKEN_RE = /[\p{L}\p{N}_]+/gu;

/** The first module id in a (raw) stack or URL, skipping this recorder's own frames. */
export function moduleFromStack(stack) {
  if (typeof stack !== "string") return null;
  for (const m of stack.matchAll(/modules\/([a-z0-9_-]+)\//gi)) {
    const id = m[1].toLowerCase();
    if (id !== MODULE_ID) return id;
  }
  return null;
}

/** An Error, or an error-like class instance (never a plain object that happens to have message and stack). */
export function isErrorLike(v) {
  if (v instanceof Error) return true;
  if (!v || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto !== Object.prototype && proto !== null && typeof v.stack === "string" && typeof v.message === "string";
}

/** An error's class name when it looks like a class name, else "Error" (never anything a user typed). */
export function errorName(err) {
  const name = err?.name;
  if (typeof name !== "string") return "Error";
  return STANDARD_ERRORS.has(name) || /^[A-Z][A-Za-z0-9]{0,40}Error$/.test(name) ? name : "Error";
}

/** Plain text of an HTML string (rough: tags out, a few entities in, whitespace collapsed). */
export function stripHTML(html) {
  return String(html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Reduces a path (no origin) to what may be recorded.
 * @returns {{text: string, kind: "code"|"asset"|"world"|"core"|"masked"}}
 */
export function reducePath(raw, { sameHost = true } = {}) {
  let p = String(raw ?? "").replace(/\\/g, "/");
  let suffix = "";
  const pos = p.match(/(?::\d+){1,2}$/);
  if (pos) {
    suffix = pos[0];
    p = p.slice(0, -suffix.length);
  }
  p = p.replace(/[?#].*$/, "");
  try {
    p = decodeURI(p);
  } catch {
    // keep it encoded
  }
  const segs = p.split("/").filter(Boolean);
  const dirsOf = rest => {
    const last = rest[rest.length - 1] ?? "";
    const dirs = last.includes(".") ? rest.slice(0, -1) : rest;
    return dirs.length ? `${dirs.join("/")}/` : "";
  };
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i].toLowerCase();
    if ((seg === "modules" || seg === "systems") && segs[i + 1]) {
      const id = segs[i + 1];
      const rest = segs.slice(i + 2);
      const file = rest[rest.length - 1] ?? "";
      if (CODE_EXT.test(file)) return { text: `${seg}/${id}/${rest.join("/")}${suffix}`, kind: "code" };
      return { text: `${seg}/${id}/${dirsOf(rest)}`, kind: "asset" };
    }
    if (seg === "worlds" && segs[i + 1]) return { text: `${MASK.world}/${dirsOf(segs.slice(i + 2))}`, kind: "world" };
  }
  const last = segs[segs.length - 1] ?? "";
  if (sameHost && segs.length && CORE_ROOTS.has(segs[0].toLowerCase()) && CODE_EXT.test(last)) {
    return { text: `${segs.join("/")}${suffix}`, kind: "core" };
  }
  return { text: MASK.path, kind: "masked" };
}

/**
 * Finds literal strings (names, texts) in other strings: indexed by their first word, so a scrub costs one lookup per
 * word however many names the world has. Matches are case-insensitive, start and end at word boundaries, and the
 * longest literal wins. Words inside protected tokens (module ids) are never matched.
 */
export class LiteralScrubber {
  #index = new Map();
  #seen = new Set();
  #dirty = false;
  #protected = new Set();

  get size() {
    return this.#seen.size;
  }

  add(text, category, { minLength = 3 } = {}) {
    const s = String(text ?? "").replace(/\s+/g, " ").trim().replace(/^[^\p{L}\p{N}_]+|[^\p{L}\p{N}_]+$/gu, "");
    if (s.length < minLength) return false;
    const lower = s.toLowerCase();
    if (this.#seen.has(lower)) return false;
    const first = lower.match(/^[\p{L}\p{N}_]+/u)?.[0];
    if (!first) return false;
    this.#seen.add(lower);
    let list = this.#index.get(first);
    if (!list) this.#index.set(first, (list = []));
    list.push({ lower, len: s.length, category });
    this.#dirty = true;
    return true;
  }

  protect(words) {
    for (const w of words ?? []) if (w) this.#protected.add(String(w).toLowerCase());
  }

  #protectedSpans(str) {
    if (!this.#protected.size) return [];
    const spans = [];
    for (const m of str.matchAll(/[A-Za-z0-9_-]+/g)) {
      if (this.#protected.has(m[0].toLowerCase())) spans.push([m.index, m.index + m[0].length]);
    }
    return spans;
  }

  /** Replaces every literal; `replace(category)` gives the replacement and is where callers count. */
  scrub(str, replace) {
    if (!str || !this.#index.size) return str;
    if (this.#dirty) {
      for (const list of this.#index.values()) list.sort((a, b) => b.len - a.len);
      this.#dirty = false;
    }
    const spans = this.#protectedSpans(str);
    const inSpan = (a, b) => spans.some(([x, y]) => a >= x && b <= y);
    let out = "";
    let last = 0;
    WORD_TOKEN_RE.lastIndex = 0;
    let m;
    while ((m = WORD_TOKEN_RE.exec(str))) {
      const start = m.index;
      const list = this.#index.get(m[0].toLowerCase());
      if (!list) continue;
      for (const entry of list) {
        const end = start + entry.len;
        if (end > str.length || inSpan(start, end)) continue;
        if (end < str.length && isWordChar(str[end])) continue;
        if (str.slice(start, end).toLowerCase() !== entry.lower) continue;
        out += str.slice(last, start) + replace(entry.category);
        last = end;
        WORD_TOKEN_RE.lastIndex = end;
        break;
      }
    }
    return last ? out + str.slice(last) : str;
  }
}

/** Embedded collections walked when collecting a world's names and ids. */
const EMBEDDED = {
  Actor: [["items", "Item"], ["effects", "ActiveEffect"]],
  Item: [["effects", "ActiveEffect"]],
  Scene: [["tokens", "Token"], ["notes", "Note"], ["tiles", "Tile"], ["lights", "AmbientLight"], ["sounds", "AmbientSound"],
    ["regions", "Region"], ["drawings", "Drawing"], ["walls", "Wall"]],
  JournalEntry: [["pages", "JournalEntryPage"]],
  Playlist: [["sounds", "PlaylistSound"]],
  RollTable: [["results", "TableResult"]],
  Combat: [["combatants", "Combatant"]],
  Cards: [["cards", "Card"]]
};
/** World collections: game[key] → document type. */
export const WORLD_COLLECTIONS = [["users", "User"], ["actors", "Actor"], ["items", "Item"], ["scenes", "Scene"],
  ["journal", "JournalEntry"], ["macros", "Macro"], ["playlists", "Playlist"], ["tables", "RollTable"], ["cards", "Cards"],
  ["folders", "Folder"], ["combats", "Combat"], ["messages", "ChatMessage"]];
/** Chat messages whose text is collected (the most recent ones). */
const CHAT_TEXT_LIMIT = 500;

function listOf(collection) {
  if (!collection) return [];
  try {
    if (Array.isArray(collection)) return collection;
    if (Array.isArray(collection.contents)) return collection.contents;
    if (typeof collection.values === "function") return Array.from(collection.values());
    if (typeof collection[Symbol.iterator] === "function") return Array.from(collection);
  } catch {
    // unreadable collection
  }
  return [];
}

export class Redactor {
  /** Counts per category, written at the end of the file. */
  report = {};
  #literals = new LiteralScrubber();
  #hosts = [];
  #ids = new Map();
  #pseudonyms = new Set();
  #known = new Map();
  #counters = {};

  constructor({ hosts = [], protectedWords = [] } = {}) {
    for (const h of hosts) this.addHost(h);
    this.#literals.protect(protectedWords);
  }

  /** A Redactor that knows the world's names, texts, ids and the instance's host. */
  static fromWorld(game, location) {
    const r = new Redactor({
      hosts: [location?.host, location?.hostname, location?.origin],
      protectedWords: [...listOf(game?.modules).map(m => m?.id), game?.system?.id]
    });
    r.absorbWorld(game);
    return r;
  }

  count(category, n = 1) {
    this.report[category] = (this.report[category] ?? 0) + n;
  }

  /** How many names / texts are known (for the redaction report). */
  get literalCount() {
    return this.#literals.size;
  }

  addHost(host) {
    const h = String(host ?? "").trim();
    if (h.length < 3 || this.#hosts.includes(h.toLowerCase())) return;
    this.#hosts.push(h.toLowerCase());
    this.#hosts.sort((a, b) => b.length - a.length);
  }

  addName(name, type) {
    if (typeof name !== "string") return;
    this.#literals.add(name, "name");
    if (PERSON_TYPES.has(type)) {
      for (const word of name.match(/[\p{L}\p{N}_'’-]+/gu) ?? []) {
        if (word.length >= 4 && !STOP_WORDS.has(word.toLowerCase())) this.#literals.add(word, "name", { minLength: 4 });
      }
    }
  }

  addText(text) {
    const plain = stripHTML(text);
    if (plain.length < 3) return;
    this.#literals.add(plain, "text");
    for (const part of plain.split(/(?<=[.!?…])\s+|\n+/)) if (part.length >= 12) this.#literals.add(part, "text");
  }

  addWorld(world) {
    if (!world) return;
    this.#literals.add(world.title, "world");
    this.#literals.add(world.id, "world");
    if (world.description) this.addText(world.description);
  }

  addId(id, type) {
    if (typeof id === "string" && id) this.#known.set(id, type);
  }

  /** The pseudonym of a document id (stable for this Redactor). Already pseudonymised values are kept. */
  pseudonym(id, type) {
    const key = String(id ?? "");
    if (!key) return key;
    if (this.#pseudonyms.has(key)) return key;
    let p = this.#ids.get(key);
    if (p) return p;
    const prefix = ID_PREFIX[type ?? this.#known.get(key)] ?? "X";
    const n = (this.#counters[prefix] = (this.#counters[prefix] ?? 0) + 1);
    p = `${prefix}${n}`;
    this.#ids.set(key, p);
    this.#pseudonyms.add(p);
    this.count("ids");
    return p;
  }

  /** Learns a document's id and names (and, with deep, those of its embedded documents). */
  absorbDocument(doc, type, { deep = true, texts = true } = {}) {
    if (!doc || typeof doc !== "object") return;
    try {
      this.addId(doc.id ?? doc._id, type);
      this.addName(doc.name, type);
      if (doc.navName) this.addName(doc.navName, type);
      if (type === "Actor") this.addName(doc.prototypeToken?.name, "Token");
      if (type === "Note") this.addName(doc.text, "Note");
      if (type === "User" && doc.character?.name) this.addName(doc.character.name, "Actor");
      if (type === "ChatMessage") {
        this.addName(doc.speaker?.alias, "Actor");
        if (texts) {
          this.addText(doc.content);
          this.addText(doc.flavor);
        }
      }
      if (type === "Drawing" && texts) this.addText(doc.text);
      if (!deep) return;
      for (const [key, childType] of EMBEDDED[type] ?? []) {
        for (const child of listOf(doc[key])) this.absorbDocument(child, childType, { deep: true, texts });
      }
    } catch {
      // a document we can't read: nothing to learn from it
    }
  }

  /** Learns every name, text and id in a world (the `game` object). */
  absorbWorld(game) {
    if (!game) return;
    this.addWorld(game.world);
    for (const [key, type] of WORLD_COLLECTIONS) {
      const docs = listOf(game[key]);
      const textFrom = type === "ChatMessage" ? Math.max(0, docs.length - CHAT_TEXT_LIMIT) : 0;
      docs.forEach((doc, i) => this.absorbDocument(doc, type, { texts: i >= textFrom }));
    }
  }

  /** Scrubs one string (see the file header for the steps). */
  scrubString(value, { maxLength = 2000, version = false, key = false } = {}) {
    let s = String(value ?? "");
    if (!s) return s;
    if (s.length > 200000) {
      s = s.slice(0, 200000);
      this.count("truncated");
    }
    s = s.replace(DATA_URI_RE, () => {
      this.count("dataUris");
      return MASK.dataUri;
    });
    s = s.replace(URL_RE, url => this.#reduceUrl(url));
    s = s.replace(WIN_PATH_RE, p => this.#reduceFsPath(p));
    s = s.replace(UNIX_PATH_RE, p => this.#reduceFsPath(p));
    s = s.replace(REL_PATH_RE, p => this.#reduceFsPath(p));
    s = s.replace(EMAIL_RE, () => {
      this.count("emails");
      return MASK.email;
    });
    for (const h of this.#hosts) {
      const lower = s.toLowerCase();
      if (!lower.includes(h)) continue;
      let out = "";
      let from = 0;
      let i;
      while ((i = lower.indexOf(h, from)) !== -1) {
        out += s.slice(from, i) + MASK.host;
        from = i + h.length;
        this.count("hosts");
      }
      s = out + s.slice(from);
    }
    s = s.replace(HOST_PORT_RE, (m, tld) => {
      if (CODE_EXT.test(`.${tld}`)) return m;
      this.count("hosts");
      return MASK.host;
    });
    s = s.replace(LOCALHOST_RE, () => {
      this.count("hosts");
      return MASK.host;
    });
    if (!version) {
      s = s.replace(IPV4_RE, () => {
        this.count("ips");
        return MASK.ip;
      });
      s = s.replace(IPV6_RE, m => {
        const groups = m.split(":").length;
        if (!(groups === 8 || (m.includes("::") && /[0-9a-f]/i.test(m) && groups >= 3))) return m;
        this.count("ips");
        return MASK.ip;
      });
    }
    const ownValue = OWN_VALUES.has(s) || CLIENT_LABEL_RE.test(s) || (key && OWN_KEY_RE.test(s));
    if (!ownValue) s = this.#literals.scrub(s, category => {
      this.count(category === "name" ? "names" : category === "text" ? "texts" : "worldStrings");
      return MASK[category];
    });
    s = s.replace(ID_RE, id => {
      if (this.#known.has(id) || (/\d/.test(id) && /[A-Za-z]/.test(id))) return this.pseudonym(id);
      return id;
    });
    if (s.length > maxLength) {
      s = `${s.slice(0, maxLength)}…`;
      this.count("truncated");
    }
    return s;
  }

  #reduceUrl(url) {
    if (/^blob:/i.test(url)) {
      this.count("urls");
      return MASK.url;
    }
    const m = url.match(/^[a-z-]+:\/{1,3}([^/]*)(.*)$/i);
    const isFile = /^file:/i.test(url);
    const host = isFile ? "" : (m?.[1] ?? "");
    const path = isFile ? url.replace(/^file:\/{1,3}/i, "/") : (m?.[2] ?? "");
    const sameHost = !host || this.#hosts.includes(host.toLowerCase());
    const reduced = reducePath(path, { sameHost });
    if (reduced.kind === "masked") {
      this.count("urls");
      return MASK.url;
    }
    this.count(reduced.kind === "world" ? "worldPaths" : "urls");
    return reduced.text;
  }

  #reduceFsPath(raw) {
    const trail = raw.match(/[.,;!?]+$/)?.[0] ?? "";
    const body = trail ? raw.slice(0, -trail.length) : raw;
    const reduced = reducePath(body);
    if (reduced.kind === "code" && reduced.text === body) return raw;
    if (reduced.kind === "asset" && reduced.text === body) return raw;
    this.count(reduced.kind === "world" ? "worldPaths" : "paths");
    return reduced.text + trail;
  }

  /** A stack trace: at most 25 frames, every frame reduced like any other string. */
  cleanStack(stack) {
    const lines = String(stack ?? "").split("\n").map(l => l.trim()).filter(Boolean).slice(0, 26);
    return this.scrubString(lines.join("\n"), { maxLength: 8000 });
  }

  /** {name, message, stack} of an error, scrubbed. */
  errorInfo(err) {
    return {
      error: errorName(err),
      message: this.scrubString(err?.message ?? "", { maxLength: 2000 }),
      stack: err?.stack ? this.cleanStack(err.stack) : undefined
    };
  }

  /** An object key: ids → pseudonyms, names → ‹name›. */
  redactKey(key) {
    const k = String(key);
    if (/^[A-Za-z0-9]{16}$/.test(k) && (this.#known.has(k) || /\d/.test(k))) return this.pseudonym(k);
    return this.scrubString(k, { maxLength: 200, key: true });
  }

  /** Deep-redacts any value (see the file header). Never throws. */
  redact(value, { maxDepth = 6 } = {}) {
    try {
      return this.#walk(value, "", 0, new Set(), maxDepth);
    } catch {
      this.count("unreadable");
      return "[unreadable]";
    }
  }

  #field(str, key) {
    const k = key.toLowerCase();
    if (k === "docid" || k === "docids") return this.pseudonym(str);
    if (k === "stack") return this.cleanStack(str);
    if (k === "summary") return this.scrubString(str, { maxLength: 2000000 });
    return this.scrubString(str, { version: VERSION_KEY_RE.test(key), maxLength: k === "steps" || k === "expected" || k === "actual" ? 10000 : 2000 });
  }

  #walk(v, key, depth, seen, maxDepth) {
    if (v === null) return null;
    switch (typeof v) {
      case "string": return this.#field(v, key);
      case "number": return Number.isFinite(v) ? v : String(v);
      case "boolean": return v;
      case "bigint": return String(v);
      case "undefined": return undefined;
      case "function": return "[function]";
      case "symbol": return "[symbol]";
    }
    try {
      return this.#walkObject(v, key, depth, seen, maxDepth);
    } catch {
      this.count("unreadable");
      return "[unreadable]";
    }
  }

  #walkObject(v, key, depth, seen, maxDepth) {
    if (seen.has(v)) return "[circular]";
    if (depth >= maxDepth) {
      this.count("depth");
      return "[depth]";
    }
    if (typeof v.nodeType === "number" && typeof v.nodeName === "string") return `[element ${String(v.nodeName).toLowerCase()}]`;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
    if (isErrorLike(v)) return this.errorInfo(v);
    if (typeof v.documentName === "string" && (v.id || v._id)) {
      return { document: String(v.documentName).slice(0, 40), docId: this.pseudonym(v.id ?? v._id, v.documentName) };
    }
    if (ArrayBuffer.isView(v)) return `[${v.constructor?.name ?? "TypedArray"} ${v.length ?? v.byteLength}]`;
    if (v instanceof WeakMap || v instanceof WeakSet || v instanceof Promise) return `[${v.constructor.name}]`;
    seen.add(v);
    try {
      const childKey = key.toLowerCase() === "docids" ? "docId" : "";
      if (Array.isArray(v) || v instanceof Set) {
        const arr = Array.from(v);
        const out = arr.slice(0, 200).map(x => {
          const r = this.#walk(x, childKey, depth + 1, seen, maxDepth);
          return r === undefined ? null : r;
        });
        if (arr.length > 200) {
          out.push(`…${arr.length - 200} more`);
          this.count("truncated");
        }
        return out;
      }
      const entries = v instanceof Map ? Array.from(v.entries()).map(([k, x]) => [String(k), x]) : Object.keys(v).map(k => [k, undefined]);
      const out = {};
      let n = 0;
      for (const [k, mapValue] of entries) {
        if (isDroppedKey(k)) {
          this.count("droppedKeys");
          continue;
        }
        if (++n > 200) {
          out["…"] = `${entries.length - 200} more keys`;
          this.count("truncated");
          break;
        }
        let x = mapValue;
        if (!(v instanceof Map)) {
          try {
            x = v[k];
          } catch {
            x = "[unreadable]";
          }
        }
        const r = this.#walk(x, k, depth + 1, seen, maxDepth);
        if (r === undefined) continue;
        let rk = this.redactKey(k);
        if (rk in out) {
          let i = 2;
          while (`${rk}#${i}` in out) i++;
          rk = `${rk}#${i}`;
        }
        out[rk] = r;
      }
      return out;
    } finally {
      seen.delete(v);
    }
  }
}
