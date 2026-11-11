# What Is Recorded

Every recording becomes one self-describing JSON file (`"format": "dxcufgbs-debug-recorder"`, `"schemaVersion": 1`). Everything in it went through the [privacy layer](Privacy) when it was stored. The parts, in the order they appear in the file:

## Header

- **format**, **schemaVersion**, **recorderVersion**, **createdAt**
- **recording**: its number and name, when it started (UTC), how long it ran, whether it is still running or stopped by itself, and the auto-stop time
- **selectedModules**: the ids of the modules you ticked

## Error digest

**digest**: one entry per distinct error or warning, most frequent first (at most 100). Each has its count, when it first and last happened, the module it came from with that module's exact code (version, release tag, commit), the hook it happened in, the message, the top stack frame, and the breadcrumbs and notifications that came before it (by event number). Read this first.

## The exact code

**versions**: for every selected module and every module named in an error, its version, release tag and GitHub repository and, for a module installed as a git clone, the commit and branch. Foundry's build and the system's version too.

## Your report

**report**: the steps to reproduce, expected and actual behaviour you wrote under **What happened** (empty if you left them empty).

## The environment

Always in the file, taken when the recording started:

- Foundry version, generation, build and channel; the game system and its version
- Browser and its version, the operating system, desktop app or browser, mobile or not (the full user agent is not kept)
- Screen and window size, pixel ratio, an estimate of the browser zoom and Foundry's UI scale
- Graphics card, WebGL version and limits, PIXI version
- Foundry's language
- This client's role ("GM 1"), how many users the world has and how many are connected
- Every active module with its version, and how many are disabled
- What each selected module requires or recommends, and whether it is there
- The core settings that change how the canvas renders (performance mode, max FPS, resolution scaling and so on)

## Per selected module

Taken at the start and at the end of the recording:

- Installed, active, version, compatibility (minimum, verified, maximum) and load order
- Its settings: key, scope, type and value, with text values left out (`‹string:N›`, unless the text is one of the setting's own choices)
- The names and types of its API members
- Which documents carry its flags: how many of each type, the shape of the flag keys and their size, never the values
- Its data journals, and whether its socket is in the manifest and listening
- The **snapshot** the module reports about itself, at start, stop and download, if it [reports state](Supported-Modules)

## Events

**events**: what happened while it recorded, each with the time since the start, the module it came from, and, when it has a stack, the stack frames (module, file, line, column and function, with that module's version, or Foundry's build for core frames):

- Uncaught errors and unhandled promise rejections
- Errors Foundry caught in hooks, with the hook's name
- Console errors, warnings, logs and info from the selected modules, and console errors from everything else
- Deprecation and compatibility warnings from the selected modules
- Warning and error notifications
- Breadcrumbs the selected modules leave through the [API](API)
- Snapshots that failed

Identical repeated errors and warnings are stored once with a count. At most 10,000 events are kept; later ones are only counted as dropped.

## Counts and summary

- **counts**: events in total, errors, warnings, collapsed repeats and dropped events, per type
- **summary**: the same information as Markdown (versions, the top 10 of the digest, a table of the selected modules and your report), easy to read in the issue
- **redaction**: last in the file, a count of everything the privacy layer removed, per kind
