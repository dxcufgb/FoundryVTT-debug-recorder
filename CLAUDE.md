# Dxcufgb's Debug Recorder

FoundryVTT v13 module (id `dxcufgbs-debug-recorder`, the install folder must have the same name). A GM-run helper for
bug reports: while recording it collects debug data about the user's own modules (ids starting with `dxcufgbs-`, or
author "Dxcufgb", so Dice Trails / Lively Tokens with other ids count too) into one self-describing JSON file for a
GitHub issue. System-agnostic. No build step and no npm dependencies.

## Layout
- `scripts/main.js` – entry: settings (`autoStopMinutes`; client `openOnLoad`, which opens the window for a GM on `ready`; hidden world `selection` {saved, ids} and `status`
  {recording, startedAt, by}), the GM-only settings menu and keybinding, the public API (documented in its header
  comment), the `dxcufgbs-debug-recorder.ready` hook (fired on `setup`; `api` is on the module from `init`).
- `scripts/privacy.js` – the privacy layer, pure logic without Foundry globals (unit tested in `tests/`). `Redactor`:
  `scrubString` (data URIs, URLs, paths, e-mail, hosts, IPs, world literals, ids → pseudonyms), `redact` (deep: drops
  `DROP_KEYS`, scrubs keys, documents → {document, docId}, caps), `cleanStack`, `report` (counts per category).
  `Redactor.fromWorld(game, location)` learns every name / text / id of the world (`absorbWorld`, `absorbDocument`);
  `LiteralScrubber` matches them by first word. `moduleFromStack` attributes a stack to a module.
- `scripts/recorder.js` – the recordings: a list of sessions (one per bug, at most `MAX_RECORDINGS`, at most one running,
  on the GM that started it), each with `id`, `number`, `label` and `report`: `start` / `stop` / `remove` / `clear`, `rename`,
  `setReport`, `getRecording`, `recordingState`,
  `record` (redacts, collapses identical errors/warnings with `count`, caps at `MAX_EVENTS`, counts drops), the API
  functions `register` / `breadcrumb` / `isRecording`, snapshots (start / stop / export, try/catch, 3 s for promises,
  size cap), module state at start and end, learning new names on `create*` / `update*` hooks, auto-stop,
  `prepareExport` / `storedEvents` (by id; default the running or newest), `subscribe` for the window.
- `scripts/capture.js` – items 19–24: console wrappers, window `error` / `unhandledrejection`, the core `error` hook
  (merged with the console.error Foundry logs for the same error), notification wrapper. Installed at Start, removed
  at Stop; never throws, never recurses.
- `scripts/environment.js` – `environmentHeader` (items 1–11) and `moduleState` (12–15, 17, 18): raw data, redacted
  by the caller. Setting strings become `‹string:N›` unless they are one of the setting's choices; flags and object
  settings are reported as `shapeOf` "path:type" lines, never values.
- `scripts/versions.js` – exact code per module: `moduleVersion` / `codeVersions` (version, release `tag` from the
  download / manifest path, GitHub `repo` slug from `url`, `commit` + `branch` from a same-origin GET of the relative
  `modules/<id>/.git/HEAD` → ref file → `packed-refs`; cached per page; `.git/config` is never read), `parseFrames`
  (cleaned stack → `{fn, module | system | core, path, line, col}`), `resolveFrames` (adds version / tag / commit, or
  the Foundry build for core), `frameString`, `modulesInEvents`.
- `scripts/export.js` – `buildFile` (final redaction pass over the whole file; then, from redacted data or validated
  package metadata only: `digest` right after the header, `versions`, frame commits, `summary`, `redaction` last),
  `buildDigest` (one group per collapsed error / warning event, sorted by count then first seen, with the `seq` of the
  last 20 breadcrumbs / notifications / setting changes before it), `summaryMarkdown`, `exportFile` (zipped when asked
  or over `AUTO_ZIP_BYTES` (5 MB), 20 MB limit on the final file, `dxcufgbs-debug-<UTC>.json|.zip`), `issueSummary`
  (async: versions, commits and the top of the digest), `exportRecordings` (one → `exportFile`; two or more → always one
  .zip with a JSON file per recording, named `dxcufgbs-debug-[<label slug>-]<start UTC>.json`).
- `scripts/zip.js` – a zip writer (`zipFiles` for several files, `zipOneFile`; `CompressionStream("deflate-raw")`, CRC-32,
  no dependencies; `null` when the browser can't, so a single export falls back to JSON and a multi-recording export is
  refused).
- `scripts/indicator.js` – the "Debug recording" badge on every client, driven by the `status` setting.
- `scripts/apps/recorder-app.js` + `templates/recorder.hbs` – `RecorderApp` (HandlebarsApplicationMixin(ApplicationV2)),
  `OpenRecorderMenu` (the settings menu entry). Timer and counters update in place every second so typing in the
  report fields is never interrupted. The recordings list: a checkbox per recording (Shift-click ticks a range from the
  last clicked), an editable label, view and delete; ticks and button counts update without a re-render.
- `scripts/util.js` – constants, `t()` (`DXDR.` keys), `escapeHTML`, `isOwnModule`, `selectableModules`, `clientLabel`.
- `styles/debug-recorder.css` (theme tokens on `.dxdr`, light/dark), `lang/en.json`.
- `tests/privacy.test.mjs`, `tests/versions.test.mjs`, `tests/zip.test.mjs` (checked with the `unzip` CLI when it is
  installed) and `tests/pipeline.test.mjs` (the privacy gate: a mocked world seeded with
  names, the instance URL, IPs, world title and chat text; fails if any of it reaches the file). CI runs them all via
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
- **Events** have a `seq` (index in `events`, referenced by the digest) and, when they have a stack, `frames`.
  Error events carry `errorClass` (the class name), never the error object.
- **Versions**: the repo slug, tag and commit are let through unscrubbed only as validated short values
  (`SLUG_RE`, `TAG_RE`, 40-hex SHA); never store a module's `url`, `manifest` or `download` itself.
- **Keys**: the privacy layer drops keys named `name`, `title`, `text`, `img`, … anywhere, so the recorder's own data
  never uses them (browser `family`, API `member`).
- **Labels and reports** are the GM's own text, kept as typed for the window and scrubbed by the recording's Redactor
  whenever they are written to a file, a file name (`slugify` after scrubbing) or the issue summary.
- **GM only**: only GMs start / stop / export; players only see the indicator. Player-client collection and surviving
  a reload come in v0.2.
- **Escaping**: templates use `{{ }}` only; any HTML built in JS uses `escapeHTML`.
