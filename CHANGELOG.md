# Changelog

## Unreleased

- Several recordings, one per bug. Starting again adds a new recording to a list instead of replacing the last one (up to 20; delete some to start more). Each recording has its own name, its own "What happened" fields and its own preview; click a recording's times to view it.
- Name each recording in the list. The name is saved in the file (`recording.label`, with names of the world's documents removed like any other text) and used for the file name, e.g. `dxcufgbs-debug-sheet-crashes-<UTC time>.json`.
- A checkbox on every recording, an **All** box, and Shift-click to tick or untick every recording between the one you clicked last and this one (like selecting e-mails in Gmail). A new recording is ticked when it starts.
- **Download selected**: one recording downloads as before (JSON, or .zip when asked or over 5 MB); two or more always download as one .zip with a JSON file per recording.
- **Delete selected** and a delete button per recording replace **Clear**. The running recording can't be deleted.

## 0.1.0

- First version.
- A GM-only recorder window (module settings, or a key you set under Configure Controls): pick which of Dxcufgb's modules to record, Start / Stop with a timer and counters of events, errors, warnings and dropped events, fields for steps to reproduce, expected and actual behaviour, a preview of the exact file, **Export file**, **Copy issue summary** and **Clear**.
- The file (`dxcufgbs-debug-<UTC time>.json`) always starts with the environment: Foundry, system, browser and OS, desktop app or browser, screen and window size, graphics card and WebGL, language, this client's role, connected users, every active module with its version, and the rendering settings. Then, per selected module: version, compatibility, load order, settings (text values left out), API members, which documents carry its flags (counts and key shapes, no values), its data journals, socket status, and the snapshot the module reports about itself. A Markdown summary of all that is in the file too.
- Recorded while running: uncaught errors and promise rejections, errors Foundry caught in hooks (with the hook's name), console errors, warnings and logs of the selected modules, console errors of everything else, warning and error notifications, deprecation warnings, and breadcrumbs the modules leave through the API. Repeated identical errors are counted once; at most 10,000 events are kept.
- Privacy: names of users, actors, tokens, items, combatants, scenes, journals and folders, chat text, journal page text (text pages, up to 20,000 characters each, and image / video captions), the world's title and id, the server's address, host names, IPs and e-mail addresses are removed when something is stored, document ids become per-recording pseudonyms (U1, A3…), and the file ends with a count of everything that was removed.
- The exact code behind every error: per selected module, and per module named in an error, its version, release tag, GitHub repository and, for a module installed as a git clone, the commit. Every stack frame is also stored as module, file, line, column and function, with that module's version (or Foundry's build for core frames).
- An error digest at the top of the file: each distinct error or warning with its count, when it first and last happened, its module and exact code, the top stack frame, and the breadcrumbs and notifications that came before it. The file holds the 100 most frequent; the Markdown summary in the file shows the top 10, and **Copy issue summary** the top 5.
- **.zip** option on export, used automatically for files over 5 MB.
- Everyone sees a "Debug recording" badge while the GM records. A recording stops by itself after 30 minutes (setting). Exports over 20 MB are refused.
- API for other modules: `register(moduleId, { snapshot })`, `breadcrumb(moduleId, key, data)`, `isRecording()` and the `dxcufgbs-debug-recorder.ready` hook.
