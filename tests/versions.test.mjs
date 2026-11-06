// Code versions and stack frames (scripts/versions.js). Run with: node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { repoSlug, releaseTag, gitCommit, parseFrames, resolveFrames, frameString } from "../scripts/versions.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";

/** A fetch over a {path: body} map; anything else is a 404 HTML page, like Foundry's. */
function fakeFetch(files, calls = []) {
  return async (url, init) => {
    calls.push(url);
    const body = files[url];
    return body === undefined
      ? { ok: false, status: 404, headers: { get: () => "text/html; charset=utf-8" }, text: async () => "<!DOCTYPE html>" }
      : { ok: true, status: 200, headers: { get: () => "application/octet-stream" }, text: async () => body };
  };
}

test("repo slug: github.com only, never a URL", () => {
  assert.equal(repoSlug("https://github.com/dxcufgb/FoundryVTT-quest-log"), "dxcufgb/FoundryVTT-quest-log");
  assert.equal(repoSlug("https://github.com/dxcufgb/FoundryVTT-quest-log.git"), "dxcufgb/FoundryVTT-quest-log");
  assert.equal(repoSlug("https://github.com/dxcufgb/repo/tree/main"), "dxcufgb/repo");
  assert.equal(repoSlug("http://skivbrytare.local:30000/modules/x"), null);
  assert.equal(repoSlug("https://gitlab.com/a/b"), null);
  assert.equal(repoSlug(undefined), null);
});

test("release tag from download / manifest paths", () => {
  assert.equal(releaseTag("https://github.com/o/r/releases/download/v1.4.0/module.zip"), "v1.4.0");
  assert.equal(releaseTag("https://github.com/o/r/releases/latest/download/module.zip", "https://github.com/o/r/releases/download/1.2.3/module.json"), "1.2.3");
  assert.equal(releaseTag("https://github.com/o/r/releases/latest/download/module.zip"), null);
  assert.equal(releaseTag(null), null);
});

test("git commit: loose ref, packed ref, detached HEAD, not a clone; relative paths only", async () => {
  const calls = [];
  const files = {
    "modules/a/.git/HEAD": "ref: refs/heads/main\n", "modules/a/.git/refs/heads/main": `${SHA}\n`,
    "modules/b/.git/HEAD": "ref: refs/heads/feature/x\n", "modules/b/.git/packed-refs": `# pack-refs\n${SHA} refs/heads/feature/x\n`,
    "modules/c/.git/HEAD": `${SHA}\n`,
    "modules/d/.git/HEAD": "ref: refs/heads/gone\n"
  };
  const f = fakeFetch(files, calls);
  assert.deepEqual(await gitCommit("a", f), { commit: SHA, branch: "main", reason: null });
  assert.deepEqual(await gitCommit("b", f), { commit: SHA, branch: "feature/x", reason: null });
  assert.deepEqual(await gitCommit("c", f), { commit: SHA, branch: null, reason: "detached HEAD" });
  assert.equal((await gitCommit("d", f)).commit, null);
  assert.equal((await gitCommit("e", f)).reason, "not a git clone, or .git not served");
  assert.ok(calls.every(u => u.startsWith("modules/")), "only relative module paths are fetched");
  assert.ok(!calls.some(u => u.includes("config")), ".git/config is never read");
});

test("frames: Chrome and Firefox lines, module / system / core, versions resolved", () => {
  const stack = [
    "TypeError: ‹name› broke",
    "at FakeSheet.render (modules/dxcufgbs-fake/scripts/sheet.js:42:7)",
    "at async Promise.all (index 0)",
    "at scripts/foundry.mjs:1000:3",
    "at Roll.evaluate (systems/dnd5e/dnd5e.mjs:12:9)",
    "_onClick@modules/other/main.js:5:6",
    "at x ([url])"
  ].join("\n");
  const frames = parseFrames(stack);
  assert.deepEqual(frames[0], { fn: "FakeSheet.render", line: 42, col: 7, module: "dxcufgbs-fake", path: "scripts/sheet.js" });
  assert.deepEqual(frames[1], { fn: null, line: 1000, col: 3, core: true, path: "scripts/foundry.mjs" });
  assert.equal(frames[2].system, "dnd5e");
  assert.deepEqual(frames[3], { fn: "_onClick", line: 5, col: 6, module: "other", path: "main.js" });
  assert.equal(frames.length, 4);
  const versions = { core: { foundry: "13.351", build: 351 }, modules: { "dxcufgbs-fake": { version: "1.2.0", tag: "v1.2.0", commit: SHA } } };
  resolveFrames(frames, versions);
  assert.equal(frames[0].commit, SHA);
  assert.equal(frames[1].build, 351);
  assert.equal(frameString(frames[0]), "modules/dxcufgbs-fake/scripts/sheet.js:42:7");
  assert.equal(frameString(frames[2]), "systems/dnd5e/dnd5e.mjs:12:9");
});
