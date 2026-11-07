// The zip writer (scripts/zip.js): a standard unzip must read what it writes. Run with: node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { zipOneFile, zipFiles, crc32, canZip } from "../scripts/zip.js";
import { slugify } from "../scripts/util.js";

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

const second = JSON.stringify({ format: "dxcufgbs-debug-recorder", other: "second file", n: [1, 2, 3] }, null, 2);
const names = ["dxcufgbs-debug-bug-one-2026-11-06T10-00-00Z.json", "dxcufgbs-debug-2026-11-06T10-05-00Z.json", "dxcufgbs-debug-åäö-2026-11-06T10-09-00Z.json"];

/** Reads every entry of an archive through its central directory: [{name, data}]. */
function readZip(zip) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out = [];
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(at, true), 0x02014b50);
    const compSize = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLen));
    assert.equal(view.getUint32(local, true), 0x04034b50);
    const localName = view.getUint16(local + 26, true);
    const data = zlib.inflateRawSync(zip.subarray(local + 30 + localName, local + 30 + localName + compSize)).toString("utf8");
    assert.equal(view.getUint32(at + 16, true), crc32(new TextEncoder().encode(data)));
    out.push({ name, data });
    at += 46 + nameLen;
  }
  return out;
}

test("zipFiles: several entries, each at its own offset, in order", async () => {
  const zip = await zipFiles([{ name: names[0], data: sample }, { name: names[1], data: second }, { name: names[2], data: new TextEncoder().encode("bytes") }]);
  assert.deepEqual(readZip(zip), [{ name: names[0], data: sample }, { name: names[1], data: second }, { name: names[2], data: "bytes" }]);
  assert.equal(await zipFiles([]), null);
});

test("unzip reads an archive of several files", { skip: !hasUnzip && "unzip CLI not installed" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dxdr-zip-"));
  try {
    const file = path.join(dir, "dxcufgbs-debug-2-recordings-2026-11-06T10-10-00Z.zip");
    fs.writeFileSync(file, await zipFiles([{ name: names[0], data: sample }, { name: names[1], data: second }]));
    assert.match(execFileSync("unzip", ["-t", file], { encoding: "utf8" }), /No errors detected/);
    assert.deepEqual(execFileSync("unzip", ["-Z1", file], { encoding: "utf8" }).trim().split("\n"), names.slice(0, 2));
    assert.equal(execFileSync("unzip", ["-p", file, names[1]], { encoding: "utf8" }), second);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("slugify keeps file names to ASCII letters, digits and dashes", () => {
  assert.equal(slugify("Sheet crashes on ‹name› (again)!"), "sheet-crashes-on-name-again");
  assert.equal(slugify("Åsa's bug"), "asa-s-bug");
  assert.equal(slugify("../../etc/passwd"), "etc-passwd");
  assert.equal(slugify("‹›"), "");
  assert.equal(slugify("x".repeat(60)).length, 40);
});
