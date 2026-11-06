// The zip writer (scripts/zip.js): a standard unzip must read what it writes. Run with: node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { zipOneFile, crc32, canZip } from "../scripts/zip.js";

const hasUnzip = (() => {
  try {
    execFileSync("unzip", ["-v"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
})();

const sample = JSON.stringify({ format: "dxcufgbs-debug-recorder", text: "åäö ‹name› [world]", list: Array.from({ length: 2000 }, (_, i) => ({ i, msg: "repeated message" })) }, null, 2);

test("crc32 matches the reference value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
});

test("the archive has one deflated entry that inflates back to the input", async () => {
  assert.ok(canZip());
  const zip = await zipOneFile("dxcufgbs-debug-2026-11-06T10-00-00Z.json", sample, new Date(2026, 10, 6, 10, 0, 0));
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint16(8, true), 8);
  const nameLen = view.getUint16(26, true);
  const compSize = view.getUint32(18, true);
  const raw = zlib.inflateRawSync(zip.subarray(30 + nameLen, 30 + nameLen + compSize));
  assert.equal(raw.toString("utf8"), sample);
  assert.equal(view.getUint32(14, true), crc32(raw));
  assert.ok(zip.length < Buffer.byteLength(sample) / 5, "compresses");
  const end = zip.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 1);
});

test("unzip -t and unzip -p read it", { skip: !hasUnzip && "unzip CLI not installed" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dxdr-zip-"));
  try {
    const name = "dxcufgbs-debug-2026-11-06T10-00-00Z.json";
    const file = path.join(dir, "dxcufgbs-debug-2026-11-06T10-00-00Z.zip");
    fs.writeFileSync(file, await zipOneFile(name, sample));
    const testOut = execFileSync("unzip", ["-t", file], { encoding: "utf8" });
    assert.match(testOut, /No errors detected/);
    const list = execFileSync("unzip", ["-Z1", file], { encoding: "utf8" }).trim();
    assert.equal(list, name);
    assert.equal(execFileSync("unzip", ["-p", file, name], { encoding: "utf8" }), sample);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
