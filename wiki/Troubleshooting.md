# Troubleshooting

**I can't find the recorder.**
It is GM only: **Game Settings → Configure Settings → Dxcufgb's Debug Recorder → Open the recorder**. The module has to be enabled in the world under **Manage Modules**. You can also set a key for it under **Configure Controls**.

**The module I want isn't in the list.**
Only active modules are listed, and only Dxcufgb's own modules or modules that [registered with the API](API). Enable the module in the world and reopen the window. See [Supported Modules](Supported-Modules).

**"Tick at least one module to record."**
Tick a module under **Modules to record** before you click **Start recording**.

**My recording is gone after a reload.**
Recordings live in this browser page until you download them, and this version can't keep them across a reload. Download the recording before you reload or close the page.

**The recording stopped by itself.**
It stops after the time set in [Settings](Settings) (default 30 minutes). Start a new one; it is added to the list.

**I can't start another recording.**
The list holds at most 20. Delete some (download them first if you still need them).

**The file is too big.**
Files over 20 MB are refused. Record a shorter session or fewer modules, and tick **.zip** (files over 5 MB are zipped anyway).

**"This browser can't make .zip files."**
One recording is then saved as plain JSON; two or more have to be downloaded one at a time. A current Chrome, Edge, Firefox or Safari can zip.

**Players' errors aren't in the file.**
This version records only the GM client that started the recording. If the bug happens on a player's screen, ask them to describe it, or reproduce it on the GM's client.

**The "Debug recording" badge stays after the GM left.**
It disappears for everyone when the recording GM goes offline, and a GM's reload clears a badge they left behind.

**The issue form won't take my file.**
The **Bug report with a debug recording** form accepts `.json` and `.zip` files up to 25 MB. Attach the file exactly as it was downloaded.

Still stuck? [Open an issue](https://github.com/dxcufgb/FoundryVTT-debug-recorder/issues).
