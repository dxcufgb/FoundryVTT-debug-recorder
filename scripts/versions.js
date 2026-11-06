/*
 * Which exact code produced an error: per module its version, release tag, GitHub repo slug and, when it is installed as
 * a git clone, the commit. Stack frames are parsed into {module, path, line, col, fn} with the version resolved, so a
 * frame maps to one file in one version.
 *
 * Privacy: the repo slug ("owner/repo") and the tag come from public package metadata (module.json url / download /
 * manifest) and are only ever kept as those short validated values, never as a URL; a module whose url is not on
 * github.com gets repo: null. The commit is read with a same-origin GET of a relative path
 * (modules/<id>/.git/HEAD, then the ref file, then packed-refs); nothing on the server is changed, and .git/config is
 * never read.
 */

const SHA_RE = /^[0-9a-f]{40}$/;
const SLUG_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const TAG_RE = /^[\w.+-]{1,40}$/;
const BRANCH_RE = /^[\w.\/-]{1,100}$/;
/** A ref HEAD may point at: refs/heads/… or refs/tags/…, segments of word characters, dots and dashes, no ".." or empty segment. */
const REF_RE = /^refs\/(?:heads|tags)\/(?:[\w-][\w.-]*)(?:\/[\w-][\w.-]*)*$/;

/** "owner/repo" of a github.com URL, else null. */
export function repoSlug(url) {
  const m = String(url ?? "").match(/^https?:\/\/(?:www\.)?github\.com\/([^/?#\s]+)\/([^/?#\s]+)/i);
  if (!m) return null;
  const slug = `${m[1]}/${m[2].replace(/\.git$/i, "")}`;
  return SLUG_RE.test(slug) ? slug : null;
}

/** The release tag in a .../releases/download/<tag>/... URL ("v1.4.0"); null for releases/latest or anything else. */
export function releaseTag(...urls) {
  for (const url of urls) {
    const m = String(url ?? "").match(/\/releases\/download\/([^/?#\s]+)\//i);
    if (m && TAG_RE.test(m[1])) return m[1];
  }
  return null;
}

async function fetchText(fetchFn, path) {
  try {
    const r = await fetchFn(path, { cache: "no-store" });
    if (!r?.ok) return null;
    const type = r.headers?.get?.("content-type") ?? "";
    if (/text\/html/i.test(type)) return null;
    return String(await r.text());
  } catch {
    return null;
  }
}

/**
 * The commit of a module installed as a git clone: {commit, branch, reason}. `fetchFn` is fetch (the test passes its
 * own). Paths are relative, so they resolve against the page like Foundry's own module files (route prefix included).
 */
export async function gitCommit(id, fetchFn = globalThis.fetch) {
  if (typeof fetchFn !== "function") return { commit: null, branch: null, reason: "no fetch" };
  const base = `modules/${encodeURIComponent(id)}/.git/`;
  const head = (await fetchText(fetchFn, `${base}HEAD`))?.trim();
  if (!head) return { commit: null, branch: null, reason: "not a git clone, or .git not served" };
  if (SHA_RE.test(head)) return { commit: head, branch: null, reason: "detached HEAD" };
  const ref = head.match(/^ref:\s*(\S+)$/)?.[1];
  // Only refs/heads/… or refs/tags/…, never ".." or an empty segment: the fetch must stay inside modules/<id>/.git/.
  if (!ref || !REF_RE.test(ref) || ref.split("/").some(seg => !seg || seg === "." || seg === ".." || seg.endsWith(".lock"))) {
    return { commit: null, branch: null, reason: "unreadable HEAD" };
  }
  const branch = ref.replace(/^refs\/heads\//, "");
  const safeBranch = BRANCH_RE.test(branch) ? branch : null;
  const loose = (await fetchText(fetchFn, `${base}${ref}`))?.trim();
  if (loose && SHA_RE.test(loose)) return { commit: loose, branch: safeBranch, reason: null };
  const packed = await fetchText(fetchFn, `${base}packed-refs`);
  const line = packed?.split("\n").find(l => l.trim().endsWith(` ${ref}`));
  const sha = line?.trim().split(" ")[0];
  if (sha && SHA_RE.test(sha)) return { commit: sha, branch: safeBranch, reason: null };
  return { commit: null, branch: safeBranch, reason: "ref not found" };
}

const commitCache = new Map();

/** Version info of one module: {version, tag, repo, commit, branch, commitReason}. Commits are cached per page load. */
export async function moduleVersion(id, fetchFn) {
  const mod = game.modules.get(id);
  if (!mod) return { installed: false, version: null, tag: null, repo: null, commit: null, branch: null, commitReason: "not installed" };
  if (!commitCache.has(id)) commitCache.set(id, gitCommit(id, fetchFn));
  const git = await commitCache.get(id);
  return {
    version: mod.version ?? null,
    tag: releaseTag(mod.download, mod.manifest),
    repo: repoSlug(mod.url),
    commit: git.commit,
    branch: git.branch,
    commitReason: git.commit ? null : git.reason
  };
}

/** Version info for several modules, plus core Foundry and the system. */
export async function codeVersions(ids, fetchFn) {
  const modules = {};
  for (const id of [...new Set(ids)].filter(Boolean).sort()) modules[id] = await moduleVersion(id, fetchFn);
  const sys = globalThis.game?.system;
  return {
    core: { foundry: game.version ?? null, generation: game.release?.generation ?? null, build: game.release?.build ?? null },
    system: sys ? { id: sys.id, version: sys.version ?? null, tag: releaseTag(sys.download, sys.manifest), repo: repoSlug(sys.url) } : null,
    modules
  };
}

/** Forgets cached commits (the test, or after a pull). */
export function clearVersionCache() {
  commitCache.clear();
}

/* -------------------------------------------- */
/*  Stack frames                                */
/* -------------------------------------------- */

const CORE_ROOTS = new Set(["scripts", "common", "client", "client-esm", "ui", "dist", "resources"]);
const CHROME_FRAME = /^at\s+(?:async\s+)?(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?$/;
const FIREFOX_FRAME = /^(.*?)@(.+?):(\d+):(\d+)$/;

/**
 * A cleaned stack (scripts/privacy.js cleanStack output) as structured frames:
 * {fn, module | system | core, path, line, col}. `path` is relative to the module / system folder; core frames keep
 * Foundry's own path. Lines that are not frames (the message) are skipped.
 */
export function parseFrames(stack, max = 25) {
  const frames = [];
  for (const raw of String(stack ?? "").split("\n")) {
    const line = raw.trim();
    const m = line.match(CHROME_FRAME) ?? (line.startsWith("at ") ? null : line.match(FIREFOX_FRAME));
    if (!m) continue;
    const [, fnRaw, location, l, c] = m;
    const frame = { fn: fnRaw ? fnRaw.trim().slice(0, 120) || null : null, line: Number(l), col: Number(c) };
    const loc = location.trim();
    const pkg = loc.match(/^(modules|systems)\/([^/]+)\/(.+)$/);
    if (pkg) {
      frame[pkg[1] === "modules" ? "module" : "system"] = pkg[2];
      frame.path = pkg[3];
    } else if (CORE_ROOTS.has(loc.split("/")[0])) {
      frame.core = true;
      frame.path = loc;
    } else {
      frame.path = loc.slice(0, 200);
    }
    frames.push(frame);
    if (frames.length >= max) break;
  }
  return frames;
}

/** Adds the version (and, given `versions` from codeVersions, tag and commit) to each frame. */
export function resolveFrames(frames, versions = null) {
  for (const f of frames) {
    if (f.module) {
      const v = versions?.modules?.[f.module];
      f.version = v?.version ?? globalThis.game?.modules?.get(f.module)?.version ?? null;
      if (v) {
        f.tag = v.tag;
        f.commit = v.commit;
      }
    } else if (f.system) {
      f.version = globalThis.game?.system?.id === f.system ? game.system.version ?? null : null;
    } else if (f.core) {
      f.foundry = versions?.core?.foundry ?? globalThis.game?.version ?? null;
      f.build = versions?.core?.build ?? globalThis.game?.release?.build ?? null;
    }
  }
  return frames;
}

/** "modules/<id>/<path>:line:col" (or the core / system equivalent) of a frame. */
export function frameString(f) {
  if (!f) return null;
  const where = f.module ? `modules/${f.module}/${f.path}` : f.system ? `systems/${f.system}/${f.path}` : f.path;
  return `${where}:${f.line}:${f.col}`;
}

/** Ids of every module named in events (attributed, or in a stack frame). */
export function modulesInEvents(events) {
  const ids = new Set();
  for (const e of events ?? []) {
    if (e.module) ids.add(e.module);
    for (const f of e.frames ?? []) if (f.module) ids.add(f.module);
  }
  return [...ids];
}
