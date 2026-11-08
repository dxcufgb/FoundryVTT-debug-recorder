/**
 * Dxcufgb's Debug Recorder — entry point.
 *
 * A GM-run helper: while recording, it collects debug data about the user's own modules (ids starting with
 * "dxcufgbs-", or author "Dxcufgb") into one self-describing JSON file for a GitHub issue. Everything is redacted
 * when it is stored (scripts/privacy.js): no names, chat or journal text, world title, URLs, hosts or IPs, and
 * document ids become per-recording pseudonyms.
 *
 * API (names are permanent; other modules code against them):
 *   game.modules.get("dxcufgbs-debug-recorder").api, also passed to Hooks.callAll("dxcufgbs-debug-recorder.ready", api)
 *   register(moduleId, { snapshot })   snapshot() returns JSON-serialisable data about the module's runtime state.
 *                                      Called at Start, Stop and Export while the module is selected; wrapped in
 *                                      try/catch (a promise gets 3 s); the result is redacted. Registering again
 *                                      replaces the earlier registration; late registrants are accepted.
 *   breadcrumb(moduleId, key, data?)   key "area.action", data a small flat object. Stored only while recording and
 *                                      only for selected modules; redacted. Never throws.
 *   isRecording()                      boolean.
 * Callers use optional chaining and the ready hook, so load order doesn't matter, e.g.
 *   Hooks.once("dxcufgbs-debug-recorder.ready", rec => rec.register(MY_ID, { snapshot }));
 *   game.modules.get("dxcufgbs-debug-recorder")?.api?.breadcrumb(MY_ID, "app.render", { parts: 2 });
 * The hook fires on "setup"; the api object exists from "init".
 */
import { MODULE_ID, t } from "./util.js";
import * as recorder from "./recorder.js";
import { RecorderApp, OpenRecorderMenu } from "./apps/recorder-app.js";
import { updateIndicator } from "./indicator.js";

export { MODULE_ID };

/** The public API object (frozen: its members never change). */
export const api = Object.freeze({
  register: (moduleId, options) => recorder.register(moduleId, options),
  breadcrumb: (moduleId, key, data) => recorder.breadcrumb(moduleId, key, data),
  isRecording: () => recorder.isRecording()
});

function registerSettings() {
  game.settings.registerMenu(MODULE_ID, "recorder", {
    name: "DXDR.Settings.Recorder.Name",
    label: "DXDR.Settings.Recorder.Label",
    hint: "DXDR.Settings.Recorder.Hint",
    icon: "fa-solid fa-bug",
    type: OpenRecorderMenu,
    restricted: true
  });
  game.settings.register(MODULE_ID, "autoStopMinutes", {
    name: "DXDR.Settings.AutoStop.Name",
    hint: "DXDR.Settings.AutoStop.Hint",
    scope: "world", config: true, type: Number, default: 30,
    range: { min: 5, max: 240, step: 5 }
  });
  // Opens the recorder window for a GM as soon as the world has loaded (per client, so each GM chooses).
  game.settings.register(MODULE_ID, "openOnLoad", {
    name: "DXDR.Settings.OpenOnLoad.Name",
    hint: "DXDR.Settings.OpenOnLoad.Hint",
    scope: "client", config: true, type: Boolean, default: true
  });
  // Which modules are ticked in the recorder window ({saved, ids}). GM only, not in the settings window.
  game.settings.register(MODULE_ID, "selection", {
    scope: "world", config: false, type: Object, default: { saved: false, ids: [] }
  });
  // Whether a recording is running ({recording, startedAt, by}): drives the indicator on every client.
  game.settings.register(MODULE_ID, "status", {
    scope: "world", config: false, type: Object, default: { recording: false },
    onChange: () => updateIndicator()
  });
}

function registerKeybindings() {
  game.keybindings.register(MODULE_ID, "open", {
    name: "DXDR.Keybindings.Open.Name",
    hint: "DXDR.Keybindings.Open.Hint",
    editable: [],
    restricted: true,
    onDown: () => {
      RecorderApp.open();
      return true;
    }
  });
}

Hooks.once("init", () => {
  try {
    registerSettings();
    registerKeybindings();
    const mod = game.modules.get(MODULE_ID);
    if (mod) mod.api = api;
  } catch (err) {
    console.error(`${MODULE_ID} | init`, err);
  }
});

Hooks.once("setup", () => {
  try {
    Hooks.callAll(`${MODULE_ID}.ready`, api);
  } catch (err) {
    console.error(`${MODULE_ID} | ready hook`, err);
  }
});

Hooks.once("ready", async () => {
  try {
    // A recording doesn't survive a reload of the GM's page yet (v0.2): clear a status this GM left behind.
    const status = game.settings.get(MODULE_ID, "status");
    if (game.user.isGM && status?.recording && status.by === game.user.id && !recorder.isRecording()) {
      await game.settings.set(MODULE_ID, "status", { recording: false });
      ui.notifications.warn(t("Notify.LostOnReload"));
    }
    updateIndicator();
  } catch (err) {
    console.error(`${MODULE_ID} | ready`, err);
  }
  try {
    if (game.user?.isGM && game.settings.get(MODULE_ID, "openOnLoad")) RecorderApp.open();
  } catch (err) {
    console.error(`${MODULE_ID} | open on load`, err);
  }
});

// The recording GM going offline hides the indicator for everyone else.
Hooks.on("userConnected", () => {
  try {
    updateIndicator();
  } catch (err) {
    console.error(`${MODULE_ID} | userConnected`, err);
  }
});
