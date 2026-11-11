# Dxcufgb's Debug Recorder

A helper for bug reports about Dxcufgb's modules. The GM starts a recording, plays until the problem shows up, and stops. The recorder collects the versions, settings, errors and warnings of the modules you picked, and what those modules report about themselves, into one file. That file is the whole bug report: attach it to the **Bug report with a debug recording** form on the module's GitHub page.

Names, chat and journal text, the world's title and the server's address are removed before anything is stored, and a preview shows exactly what the file contains before you share it.

| | |
| --- | --- |
| **Foundry VTT** | v13 |
| **System** | any |
| **Module id** | `dxcufgbs-debug-recorder` |
| **Who uses it** | GMs (players only see a "Debug recording" badge) |
| **Latest release** | [Releases](https://github.com/dxcufgb/FoundryVTT-debug-recorder/releases/latest) |

## Start here

1. [Installation](Installation): install from the manifest URL and enable it in your world.
2. [Recording a Bug Report](Recording-a-Bug-Report): start, stop, download and attach the file.
3. [What Is Recorded](What-Is-Recorded): every part of the file.
4. [Privacy](Privacy): what is removed, and how.

## More

- [Supported Modules](Supported-Modules): the modules you can record, and which report their own state.
- [Settings](Settings): auto-stop, opening the window on load, and the keybinding.

## For module authors

The [API](API) page covers `register`, `breadcrumb`, `isRecording` and the `dxcufgbs-debug-recorder.ready` hook.

## Help

Something not working? See [Troubleshooting](Troubleshooting) first, then [open an issue](https://github.com/dxcufgb/FoundryVTT-debug-recorder/issues). If you like the module, you can [support me on Ko-fi](https://ko-fi.com/dxcufgb).
