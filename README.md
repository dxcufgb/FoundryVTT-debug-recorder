# Dxcufgb's Debug Recorder

[![Foundry v13](https://img.shields.io/github/v/release/dxcufgb/FoundryVTT-debug-recorder?label=Foundry%20v13&logo=foundryvirtualtabletop&color=ff6400)](https://github.com/dxcufgb/FoundryVTT-debug-recorder/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/dxcufgb/FoundryVTT-debug-recorder/module.zip?label=downloads&color=blue)](https://github.com/dxcufgb/FoundryVTT-debug-recorder/releases)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-support-FF5E5B?logo=kofi&logoColor=white)](https://ko-fi.com/dxcufgb)\
[![CI](https://img.shields.io/github/actions/workflow/status/dxcufgb/FoundryVTT-debug-recorder/ci.yml?branch=main&label=CI)](https://github.com/dxcufgb/FoundryVTT-debug-recorder/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/dxcufgb/FoundryVTT-debug-recorder)](LICENSE)

<a href="https://dxcufgb.github.io/FVTT-dev-showcase/"><img src="https://dxcufgb.github.io/FVTT-dev-showcase/assets/img/workshop-badge.png" alt="Dxcufgb's Workshop: every Foundry VTT project, video and changelog in one place" width="650"></a>

A helper for bug reports about Dxcufgb's modules. The GM starts a recording, plays until the problem shows up, and stops. The recorder collects the versions, settings, errors and warnings of the modules you picked, and what those modules report about themselves, into one file to attach to the bug report on GitHub, together with your steps to reproduce.

Names, chat and journal text, the world's title and the server's address are removed before anything is stored, and a preview shows exactly what the file contains before you share it.

**Foundry VTT:** v13 · **System:** any

## Installation

In Foundry: **Add-on Modules → Install Module**, paste this link into **Manifest URL** at the bottom, and click **Install**:

```
https://github.com/dxcufgb/FoundryVTT-debug-recorder/releases/latest/download/module.json
```

Enable it in your world, then open it from **Game Settings → Configure Settings → Dxcufgb's Debug Recorder → Open the recorder** (GM only). More in [Installation](https://github.com/dxcufgb/FoundryVTT-debug-recorder/wiki/Installation) in the wiki.

## Documentation

The full guide is in the [wiki](https://github.com/dxcufgb/FoundryVTT-debug-recorder/wiki):

- [Recording a Bug Report](https://github.com/dxcufgb/FoundryVTT-debug-recorder/wiki/Recording-a-Bug-Report): start, stop, export and attach the file
- [What Is Recorded](https://github.com/dxcufgb/FoundryVTT-debug-recorder/wiki/What-Is-Recorded): every part of the file
- [Privacy](https://github.com/dxcufgb/FoundryVTT-debug-recorder/wiki/Privacy): what is removed, and how
- [Settings](https://github.com/dxcufgb/FoundryVTT-debug-recorder/wiki/Settings)
- [API](https://github.com/dxcufgb/FoundryVTT-debug-recorder/wiki/API): for module authors
- [Troubleshooting](https://github.com/dxcufgb/FoundryVTT-debug-recorder/wiki/Troubleshooting)

## License

[MIT](LICENSE)
