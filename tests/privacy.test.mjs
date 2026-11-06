// Unit tests of the privacy layer (scripts/privacy.js). Run with: node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { Redactor, LiteralScrubber, reducePath, moduleFromStack, isDroppedKey, errorName, MASK } from "../scripts/privacy.js";

function redactor() {
  const r = new Redactor({ hosts: ["skivbrytare.local:30000", "skivbrytare.local"], protectedWords: ["dxcufgbs-quest-log", "dnd5e"] });
  r.addName("Elira Moonwhisper", "Actor");
  r.addName("Elira", "Token");
  r.addName("Bo", "User");
  r.addName("Kalle Anka", "User");
  r.addName("The Rusty Anchor", "Scene");
  r.addId("a1B2c3D4e5F6g7H8", "Actor");
  r.addId("uSeRiDuSeRiDuSeR", "User");
  r.addWorld({ id: "my-secret-world", title: "Secret Campaign of Doom" });
  r.addText("<p>The dragon sleeps under the old mill.</p>");
  return r;
}

test("names: longest first, word boundaries, case-insensitive, short names skipped", () => {
  const r = redactor();
  assert.equal(r.scrubString("Elira Moonwhisper attacks"), `${MASK.name} attacks`);
  assert.equal(r.scrubString("elira moonwhisper"), MASK.name);
  assert.equal(r.scrubString("Elira alone"), `${MASK.name} alone`);
  assert.equal(r.scrubString("Moonwhisper's sheet"), `${MASK.name}'s sheet`);
  assert.equal(r.scrubString("Eliranova is not a name"), "Eliranova is not a name");
  assert.equal(r.scrubString("Bo is too short"), "Bo is too short");
  assert.equal(r.scrubString("Entering The Rusty Anchor."), `Entering ${MASK.name}.`);
});

test("module ids and our own words are never scrubbed", () => {
  const r = redactor();
  r.addName("Quest Log", "Scene");
  r.addName("Gamemaster", "User");
  assert.equal(r.scrubString("dxcufgbs-quest-log failed"), "dxcufgbs-quest-log failed");
  assert.equal(r.scrubString("GAMEMASTER"), "GAMEMASTER");
  assert.equal(r.scrubString("the Quest Log opened"), `the ${MASK.name} opened`);
});

test("names that start with our own words are scrubbed; our own values and keys are kept", () => {
  const r = redactor();
  for (const n of ["Gamemaster", "Assistant GM", "Trusted Player", "Player", "None", "Message", "World"]) r.addName(n, "User");
  assert.equal(r.scrubString("uncaught Gamemaster,Assistant GM,None,Player,Trusted Player"), `uncaught ${Array(5).fill(MASK.name).join(",")}`);
  const out = r.redact({ role: "GAMEMASTER", label: "Player 2", scope: "world", level: "error", message: "Player joined", Player: 1 });
  assert.deepEqual(out, { role: "GAMEMASTER", label: "Player 2", scope: "world", level: "error", message: `${MASK.name} joined`, [MASK.name]: 1 });
  assert.equal(r.redact({ compatibility: { minimum: "1.2.3.4" } }).compatibility.minimum, "1.2.3.4");
});

test("world title, id and texts", () => {
  const r = redactor();
  assert.equal(r.scrubString("World Secret Campaign of Doom loaded"), `World ${MASK.world} loaded`);
  assert.equal(r.scrubString("id my-secret-world"), `id ${MASK.world}`);
  assert.equal(r.scrubString("said: The dragon sleeps under the old mill."), `said: ${MASK.text}.`);
});

test("URLs: origin never kept, module code paths kept with line:col, world paths reduced", () => {
  const r = redactor();
  assert.equal(r.scrubString("at f (http://skivbrytare.local:30000/modules/dxcufgbs-quest-log/scripts/main.js:10:5)"),
    "at f (modules/dxcufgbs-quest-log/scripts/main.js:10:5)");
  assert.equal(r.scrubString("http://skivbrytare.local:30000/worlds/my-secret-world/assets/elira.webp"), "[world]/assets/");
  assert.equal(r.scrubString("https://evil.example.com/x?token=abc"), MASK.url);
  assert.equal(r.scrubString("http://skivbrytare.local:30000"), MASK.url);
  assert.equal(r.scrubString("ws://skivbrytare.local:30000/socket.io/?EIO=4"), MASK.url);
  assert.equal(r.scrubString("http://skivbrytare.local:30000/scripts/foundry.mjs:12:3"), "scripts/foundry.mjs:12:3");
  assert.equal(r.scrubString("https://cdn.example.com/scripts/lib.js"), MASK.url);
  assert.equal(r.scrubString("http://skivbrytare.local:30000/modules/adv/art/Portrait.webp"), "modules/adv/art/");
  assert.equal(r.scrubString("file:///C:/Users/Kalle/AppData/Local/FoundryVTT/Data/modules/x/a.js:1:2"), "modules/x/a.js:1:2");
  assert.equal(r.scrubString("blob:http://skivbrytare.local:30000/1234-5678"), MASK.url);
  assert.equal(r.scrubString("img data:image/png;base64,iVBORw0KGgo="), `img ${MASK.dataUri}`);
});

test("file system paths", () => {
  const r = redactor();
  assert.equal(r.scrubString("C:\\Users\\Kalle\\secret.txt"), MASK.path);
  assert.equal(r.scrubString("/home/kalle/foundrydata/Data/modules/x/main.js:3:4"), "modules/x/main.js:3:4");
  assert.equal(r.scrubString("load /worlds/my-secret-world/scenes/map.webp."), "load [world]/scenes/.");
  assert.equal(r.scrubString("worlds/my-secret-world/data/actors.db"), "[world]/data/");
  assert.equal(r.scrubString("modules/x/scripts/a.js:1:2"), "modules/x/scripts/a.js:1:2");
  assert.equal(r.scrubString("and/or 1/2"), "and/or 1/2");
});

test("hosts, IPs and e-mail", () => {
  const r = redactor();
  assert.equal(r.scrubString("connect to skivbrytare.local failed"), `connect to ${MASK.host} failed`);
  assert.equal(r.scrubString("SKIVBRYTARE.LOCAL:30000 down"), `${MASK.host} down`);
  assert.equal(r.scrubString("other.lan:8080 and localhost:30000"), `${MASK.host} and ${MASK.host}`);
  assert.equal(r.scrubString("from 192.168.1.20 and 10.0.0.5"), `from ${MASK.ip} and ${MASK.ip}`);
  assert.equal(r.scrubString("v6 fe80::1ff:fe23:4567:890a here"), `v6 ${MASK.ip} here`);
  assert.equal(r.scrubString("2001:0db8:85a3:0000:0000:8a2e:0370:7334"), MASK.ip);
  assert.equal(r.scrubString("at 12:30:45 in main.js:12:34"), "at 12:30:45 in main.js:12:34");
  assert.equal(r.scrubString("mail kalle@example.com"), `mail ${MASK.email}`);
  assert.equal(r.redact({ version: "1.2.3.4" }).version, "1.2.3.4");
});

test("ids become stable pseudonyms; the mapping is not exposed", () => {
  const r = redactor();
  const a = r.scrubString("Actor.a1B2c3D4e5F6g7H8 updated");
  assert.equal(a, "Actor.A1 updated");
  assert.equal(r.scrubString("again a1B2c3D4e5F6g7H8"), "again A1");
  assert.equal(r.scrubString("user uSeRiDuSeRiDuSeR"), "user U1");
  assert.equal(r.scrubString("random Zx9Zx9Zx9Zx9Zx9Z"), "random X1");
  assert.equal(r.scrubString("registerSettings"), "registerSettings");
  assert.deepEqual(r.redact({ docId: "anything", docIds: ["a1B2c3D4e5F6g7H8", "other"] }), { docId: "X2", docIds: ["A1", "X3"] });
  // a second pass keeps pseudonyms as they are
  assert.deepEqual(r.redact({ docId: "X2" }), { docId: "X2" });
  assert.ok(!JSON.stringify(r).includes("a1B2c3D4e5F6g7H8"));
});

test("objects: dropped keys, scrubbed keys, documents, cycles, functions, caps", () => {
  const r = redactor();
  const obj = {
    name: "Elira", Content: "x", notes: "y", img: "z.png", nested: { Description: "d", password: "p", characterName: "c", keep: 1 },
    "Elira Moonwhisper": 3, a1B2c3D4e5F6g7H8: true, fn() {}, list: Array.from({ length: 250 }, (_, i) => i),
    doc: { documentName: "Actor", id: "a1B2c3D4e5F6g7H8", name: "Elira" }
  };
  obj.self = obj;
  const out = r.redact(obj);
  assert.equal(out.name, undefined);
  assert.equal(out.Content, undefined);
  assert.deepEqual(out.nested, { keep: 1 });
  assert.equal(out[MASK.name], 3);
  assert.equal(out.A1, true);
  assert.equal(out.fn, "[function]");
  assert.equal(out.self, "[circular]");
  assert.equal(out.list.length, 201);
  assert.deepEqual(out.doc, { document: "Actor", docId: "A1" });
  assert.ok(r.report.droppedKeys >= 7);
  assert.ok(isDroppedKey("NAME") && isDroppedKey("userName") && isDroppedKey("licenseKey") && !isDroppedKey("key"));
});

test("errors and stacks", () => {
  const r = redactor();
  const err = new TypeError("Elira Moonwhisper broke at http://skivbrytare.local:30000/worlds/my-secret-world/a.png");
  err.stack = `TypeError: ${err.message}\n    at render (http://skivbrytare.local:30000/modules/dxcufgbs-quest-log/scripts/main.js:5:6)`;
  const info = r.redact({ error: err }).error;
  assert.equal(info.error, "TypeError");
  assert.equal(info.message, `${MASK.name} broke at [world]/`);
  assert.ok(info.stack.includes("modules/dxcufgbs-quest-log/scripts/main.js:5:6"));
  assert.ok(!info.stack.includes("skivbrytare"));
  assert.equal(errorName({ name: "Elira" }), "Error");
  assert.equal(errorName({ name: "MyModuleError" }), "MyModuleError");
});

test("module attribution from stacks skips the recorder", () => {
  const stack = "Error\n at a (http://h/modules/dxcufgbs-debug-recorder/scripts/capture.js:1:1)\n at b (http://h/modules/dxcufgbs-quest-log/scripts/x.js:2:2)";
  assert.equal(moduleFromStack(stack), "dxcufgbs-quest-log");
  assert.equal(moduleFromStack("no frames"), null);
});

test("reducePath", () => {
  assert.deepEqual(reducePath("/modules/x/a.js:1:2"), { text: "modules/x/a.js:1:2", kind: "code" });
  assert.deepEqual(reducePath("/modules/x/icons/a.webp"), { text: "modules/x/icons/", kind: "asset" });
  assert.deepEqual(reducePath("/worlds/w/a/b/c.png"), { text: "[world]/a/b/", kind: "world" });
  assert.deepEqual(reducePath("/somewhere/else"), { text: "[path]", kind: "masked" });
});

test("LiteralScrubber prefers the longest literal", () => {
  const s = new LiteralScrubber();
  s.add("Red", "name");
  s.add("Red Dragon Inn", "name");
  assert.equal(s.scrub("at the Red Dragon Inn, Red waits", () => "#"), "at the #, # waits");
});
