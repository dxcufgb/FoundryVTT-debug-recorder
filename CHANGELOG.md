# Changelog

## 0.1.0

- First version.
- A GM-only recorder window (module settings, or a key you set under Configure Controls): pick which of Dxcufgb's modules to record, Start / Stop with a timer and counters of events, errors, warnings and dropped events, fields for steps to reproduce, expected and actual behaviour, a preview of the exact file, **Export file**, **Copy issue summary** and **Clear**.
- The file (`dxcufgbs-debug-<UTC time>.json`) always starts with the environment: Foundry, system, browser and OS, desktop app or browser, screen and window size, graphics card and WebGL, language, this client's role, connected users, every active module with its version, and the rendering settings. Then, per selected module: version, compatibility, load order, settings (text values left out), API members, which documents carry its flags (counts and key shapes, no values), its data journals, socket status, and the snapshot the module reports about itself. A Markdown summary of all that is in the file too.
- Recorded while running: uncaught errors and promise rejections, errors Foundry caught in hooks (with the hook's name), console errors, warnings and logs of the selected modules, console errors of everything else, warning and error notifications, deprecation warnings, and breadcrumbs the modules leave through the API. Repeated identical errors are counted once; at most 10,000 events are kept.
- Privacy: names of users, actors, tokens, items, combatants, scenes, journals and folders, chat and journal text, the world's title and id, the server's address, host names, IPs and e-mail addresses are removed when something is stored, document ids become per-recording pseudonyms (U1, A3…), and the file ends with a count of everything that was removed.
- Everyone sees a "Debug recording" badge while the GM records. A recording stops by itself after 30 minutes (setting). Exports over 20 MB are refused.
- API for other modules: `register(moduleId, { snapshot })`, `breadcrumb(moduleId, key, data)`, `isRecording()` and the `dxcufgbs-debug-recorder.ready` hook.
