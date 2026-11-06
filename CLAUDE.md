# Dxcufgb's Debug Recorder

FoundryVTT v13 module (id `dxcufgbs-debug-recorder`, the install folder must have the same name). A GM-run helper for
bug reports: while recording it collects debug data about the user's own modules (ids starting with `dxcufgbs-`, or
author "Dxcufgb", so Dice Trails / Lively Tokens with other ids count too) into one self-describing JSON file for a
GitHub issue. System-agnostic. No build step and no npm dependencies.

## Layout
- `scripts/main.js` – entry: settings (`autoStopMinutes`; hidden world `selection` {saved, ids} and `status`
  {recording, startedAt, by}), the GM-only settings menu and keybinding, the public API (documented in its header
  comment), the `dxcufgbs-debug-recorder.ready` hook (fired on `setup`; `api` is on the module from `init`).
- `scripts/privacy.js` – the privacy layer, pure logic without Foundry globals (unit tested in `tests/`). `Redactor`:
  `scrubString` (data URIs, URLs, paths, e-mail, hosts, IPs, world literals, ids → pseudonyms), `redact` (deep: drops
  `DROP_KEYS`, scrubs keys, documents → {document, docId}, caps), `cleanStack`, `report` (counts per category).
  `Redactor.fromWorld(game, location)` learns every name / text / id of the world (`absorbWorld`, `absorbDocument`);
  `LiteralScrubber` matches them by first word. `moduleFromStack` attributes a stack to a module.
- `scripts/recorder.js` – the session (one at a time, on the GM that started it): `start` / `stop` / `clear`,
  `record` (redacts, collapses identical errors/warnings with `count`, caps at `MAX_EVENTS`, counts drops), the API
  functions `register` / `breadcrumb` / `isRecording`, snapshots (start / stop / export, try/catch, 3 s for promises,
  size cap), module state at start and end, learning new names on `create*` / `update*` hooks, auto-stop,
  `prepareExport`, `subscribe` for the window.
- `scripts/capture.js` – items 19–24: console wrappers, window `error` / `unhandledrejection`, the core `error` hook
  (merged with the console.error Foundry logs for the same error), notification wrapper. Installed at Start, removed
  at Stop; never throws, never recurses.
- `scripts/environment.js` – `environmentHeader` (items 1–11) and `moduleState` (12–15, 17, 18): raw data, redacted
  by the caller. Setting strings become `‹string:N›` unless they are one of the setting's choices; flags and object
  settings are reported as `shapeOf` "path:type" lines, never values.
- `scripts/export.js` – `buildFile` (final redaction pass over the whole file, `redaction` report last),
  `summaryMarkdown`, `exportFile` (20 MB limit, `dxcufgbs-debug-<UTC>.json`), `issueSummary`.
- `scripts/indicator.js` – the "Debug recording" badge on every client, driven by the `status` setting.
- `scripts/apps/recorder-app.js` + `templates/recorder.hbs` – `RecorderApp` (HandlebarsApplicationMixin(ApplicationV2)),
  `OpenRecorderMenu` (the settings menu entry). Timer and counters update in place every second so typing in the
  report fields is never interrupted.
- `scripts/util.js` – constants, `t()` (`DXDR.` keys), `escapeHTML`, `isOwnModule`, `selectableModules`, `clientLabel`.
- `styles/debug-recorder.css` (theme tokens on `.dxdr`, light/dark), `lang/en.json`.
- `tests/privacy.test.mjs` (unit tests) and `tests/pipeline.test.mjs` (the privacy gate: a mocked world seeded with
  names, the instance URL, IPs, world title and chat text; fails if any of it reaches the file). CI runs both via
  `lint` in `.github/foundry-module.json`: `node --test tests/*.test.mjs`.
- `.github/workflows/ci.yml` / `release.yml` – thin callers of `dxcufgb/foundry-module-ci`; identical in every
  module, do not edit them here. `claude.yml` – the Claude review. `coderabbit.yml` – asks CodeRabbit for a review.

## Conventions
- `MODULE_ID` must equal `id` in `module.json`; CI checks it.
- Every visible setting (`config: true`) needs a Name and Hint in `lang/en.json`; CI checks it.
- Strings go through `t()` (`DXDR.` prefix). Hook handlers catch and `console.error` their errors.
- Update the wiki (not `README.md`, which only has the install steps and links to the wiki) when behaviour, settings or
  the API change.

## Review focus
- **Privacy first**: anything stored goes through the session's `Redactor` when it is stored, never only at export.
  Never write a name, chat / journal / description text, the world title / id, a URL, host, IP or port, an image path
  or an unpseudonymised document id. A new field that could hold user text must be covered by a seed in
  `tests/pipeline.test.mjs`. The pseudonym mapping never leaves the Redactor.
- **Locked API**: `register(moduleId, {snapshot})`, `breadcrumb(moduleId, key, data?)`, `isRecording()` and the
  `dxcufgbs-debug-recorder.ready` hook are used by 20 other modules: never rename or change their meaning. Late
  registrants are accepted; nothing here may throw into a calling module.
- **Wrappers**: the console / notification wrappers must call the original exactly once with the same arguments and
  `this`, swallow their own errors, and be removed at Stop (only when nobody wrapped them again since).
- **Keys**: the privacy layer drops keys named `name`, `title`, `text`, `img`, … anywhere, so the recorder's own data
  never uses them (browser `family`, API `member`).
- **GM only**: only GMs start / stop / export; players only see the indicator. Player-client collection and surviving
  a reload come in v0.2.
- **Escaping**: templates use `{{ }}` only; any HTML built in JS uses `escapeHTML`.
