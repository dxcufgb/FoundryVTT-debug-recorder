# API

For module authors. Any module can send the recorder a snapshot of its state and leave breadcrumbs. The recorder is never a dependency: a module that integrates works exactly the same without it.

```js
const rec = game.modules.get("dxcufgbs-debug-recorder")?.api;   // there from "init"
rec?.register("my-module", { snapshot: () => ({ open: 2, cached: 14 }) });
rec?.breadcrumb("my-module", "app.render", { parts: 2 });
rec?.isRecording();                                              // true while a recording runs
```

The recorder also fires `Hooks.callAll("dxcufgbs-debug-recorder.ready", api)` on `setup`, so load order doesn't matter:

```js
Hooks.once("dxcufgbs-debug-recorder.ready", rec => rec.register(MY_ID, { snapshot }));
```

The member names and the hook name are permanent.

## `register(moduleId, { snapshot })`

`snapshot()` returns JSON data about your module's runtime state. It is called at Start, at Stop and when the file is downloaded, while your module is ticked. It may return a promise (it gets 3 seconds). It is wrapped in try/catch, the result goes through the [privacy layer](Privacy), and a result bigger than 256 kB is replaced with `{truncated, bytes}`. Registering again replaces the earlier registration; a module that registers while a recording runs still gets its start snapshot. Returns `true`, or `false` for a bad id. A module that registers shows *reports state* in the window, and a module that isn't one of Dxcufgb's can appear in the list this way.

## `breadcrumb(moduleId, key, data?)`

A trail of what your module did. `key` is `"area.action"` (at most 100 characters), `data` a small flat object (a value that isn't an object is stored as `{value}`; over 4 kB it becomes `{truncated, bytes}`). Stored only while recording and only for ticked modules; redacted like everything else. Never throws. The [error digest](What-Is-Recorded#error-digest) lists the breadcrumbs that came before each error.

## `isRecording()`

`true` while a recording runs. Check it before building breadcrumb data that costs something.

## Keep your data clean

The privacy layer is a safety net, not a filter you can rely on. Send counts, booleans, numbers, versions and your module's own fixed ids; never names, free text, image paths, URLs or error messages. For an error, send its type (`TypeError`), not its message. Keep breadcrumbs out of per-frame and per-key-press code.

## A small integration file

Dxcufgb's modules each have a `scripts/debug-recorder.js` along these lines:

```js
const RECORDER_ID = "dxcufgbs-debug-recorder";
let moduleId = null, snapshotFn = null, recorder = null, announced = null;

function connect() {
  const rec = announced ?? game.modules?.get(RECORDER_ID)?.api;
  if (recorder || !moduleId || !snapshotFn || typeof rec?.register !== "function") return;
  try {
    if (rec.register(moduleId, { snapshot: () => { try { return snapshotFn(); } catch { return { snapshotError: true }; } } }) !== false) recorder = rec;
  } catch (err) {
    console.warn(`${moduleId} | Debug Recorder registration failed`, err);
  }
}
Hooks.once(`${RECORDER_ID}.ready`, rec => { announced = rec; connect(); });
Hooks.once("ready", connect);

export function registerDebugRecorder(id, fn) { moduleId = id; snapshotFn = fn; connect(); }

export function crumb(key, data) {
  if (!recorder) return;
  try {
    if (recorder.isRecording?.()) recorder.breadcrumb(moduleId, key, typeof data === "function" ? data() : data);
  } catch {
    // a recorder problem must never break the module
  }
}
```
