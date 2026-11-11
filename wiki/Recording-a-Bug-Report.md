# Recording a Bug Report

Everything happens in the **Debug Recorder** window (GM only). Open it from **Game Settings → Configure Settings → Dxcufgb's Debug Recorder → Open the recorder**, with a key you set under **Configure Controls**, or let it open when the world loads.

## 1. Pick the modules

Under **Modules to record**, tick the module the bug is about (or several). The list shows Dxcufgb's modules that are active in this world; **All** and **None** tick or untick every one. A module marked *reports state* also sends the recorder a snapshot of its own state (see [Supported Modules](Supported-Modules)). Errors from other modules are recorded too, without their logs.

## 2. Record

Click **Start recording**. Everyone in the world sees a small "Debug recording" badge while it runs. Do what makes the bug happen, then click **Stop recording**. The window shows the time and counters of events, errors, warnings and dropped events as you go.

A recording stops by itself after 30 minutes (change it in [Settings](Settings)). Only this GM's client is recorded in this version, and a reload of the page loses the recordings, so download them before you reload.

## 3. Name it and say what happened

Each recording is a row in **Recordings**, one per bug. Give it a name (it becomes part of the file name). Under **What happened** you can write the steps to reproduce, what you expected and what happened instead. These fields are optional and saved in the file; names you type there are removed like everywhere else.

Starting again adds a new recording to the list, so you can record several bugs in one session (up to 20; delete some to start more). Click a recording's times to see its counters, report fields and preview.

## 4. Check the file

Click **Show the file** under **Preview** to see exactly what the file will contain (the first 300,000 characters). Downloading builds the file again with fresh snapshots and anything recorded since, so open the downloaded file and check it too before you share it.

## 5. Download

Tick the recording and click **Download selected**. One recording downloads as `dxcufgbs-debug-<name>-<UTC time>.json`; tick **.zip** for a smaller file (files over 5 MB are always zipped). Two or more ticked recordings download as one .zip with a JSON file per recording. Files over 20 MB are refused: record a shorter session or fewer modules.

## 6. Attach it to the bug report

On the module's GitHub page, open **Issues → New issue → Bug report with a debug recording** and attach the file. That form needs nothing else: the file already has the Foundry, system, browser and module versions, the errors and your report fields. Can't use the recorder? The normal **Bug report** form is still there.

**Copy issue summary** copies a short Markdown text (versions, the exact code of each module and the five most frequent errors) if you want to paste it into an issue or a message as well.

When you're done, delete the recordings you no longer need with the delete button on a row or **Delete selected**. The running recording can't be deleted.
