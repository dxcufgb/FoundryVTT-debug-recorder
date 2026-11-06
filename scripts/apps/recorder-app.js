import { MODULE_ID, TEMPLATE_PATH, t, escapeHTML, selectableModules, formatDuration, formatBytes } from "../util.js";
import * as recorder from "../recorder.js";
import { buildFile, exportFile, issueSummary } from "../export.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/** Characters of the file shown in the preview pane (the whole file is always exported). */
const PREVIEW_LIMIT = 300000;

/** The modules ticked in the window (world setting `selection`); all own modules until the GM saves a choice. */
export function savedSelection() {
  const available = selectableModules(recorder.registeredIds()).map(m => m.id);
  let saved = null;
  try {
    saved = game.settings.get(MODULE_ID, "selection");
  } catch {
    saved = null;
  }
  if (!saved?.saved) return available;
  const wanted = new Set(saved.ids ?? []);
  return available.filter(id => wanted.has(id));
}

/**
 * The recorder window (GM only): module checklist, Start / Stop with timer and counters, the bug report fields
 * (steps, expected, actual), the preview of the exact file, Export, Copy issue summary and Clear.
 */
export class RecorderApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "dxdr-recorder",
    classes: ["dxdr", "dxdr-recorder"],
    tag: "div",
    window: { title: "DXDR.App.Title", icon: "fa-solid fa-bug", resizable: true },
    position: { width: 620, height: 720 },
    actions: {
      toggle: RecorderApp.#onToggle,
      exportFile: RecorderApp.#onExport,
      copySummary: RecorderApp.#onCopySummary,
      clear: RecorderApp.#onClear,
      preview: RecorderApp.#onPreview,
      selectAll: RecorderApp.#onSelectAll,
      selectNone: RecorderApp.#onSelectNone
    }
  };

  static PARTS = {
    main: { template: `${TEMPLATE_PATH}/recorder.hbs`, scrollable: [".dxdr-body"] }
  };

  /** Opens the window (one at a time). GM only. */
  static open() {
    if (!game.user?.isGM) {
      ui.notifications?.warn(t("Notify.GMOnly"));
      return null;
    }
    const existing = foundry.applications.instances.get("dxdr-recorder");
    if (existing) {
      existing.render({ force: true });
      existing.bringToFront?.();
      return existing;
    }
    const app = new RecorderApp();
    app.render({ force: true });
    return app;
  }

  /** What the GM typed, kept across re-renders. */
  report = { steps: "", expected: "", actual: "" };
  preview = { text: "", bytes: 0, truncated: false };
  #ticker = null;
  #unsubscribe = null;
  #busy = false;

  constructor(options = {}) {
    super(options);
    this.#unsubscribe = recorder.subscribe(() => this.render());
  }

  get selection() {
    return savedSelection();
  }

  async _prepareContext() {
    const state = recorder.getState();
    const selected = new Set(state.recording ? state.selected : this.selection);
    const modules = selectableModules(recorder.registeredIds()).map(m => ({
      id: m.id, title: m.title ?? m.id, version: m.version ?? "", selected: selected.has(m.id), registered: recorder.isRegistered(m.id)
    }));
    let autoStop = 30;
    try {
      autoStop = game.settings.get(MODULE_ID, "autoStopMinutes");
    } catch {
      // default
    }
    return {
      modules,
      noModules: !modules.length,
      recording: state.recording,
      hasData: state.hasData,
      elapsed: formatDuration(state.elapsedMs),
      total: state.total,
      errors: state.errors,
      warnings: state.warnings,
      dropped: state.dropped,
      autoStop,
      report: this.report,
      preview: this.preview.text,
      previewInfo: this.preview.text
        ? t(this.preview.truncated ? "App.PreviewTruncated" : "App.PreviewSize", { size: formatBytes(this.preview.bytes), shown: PREVIEW_LIMIT.toLocaleString() })
        : ""
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    for (const field of root.querySelectorAll("[data-report]")) {
      field.addEventListener("input", () => { this.report[field.dataset.report] = field.value; });
    }
    for (const box of root.querySelectorAll("input[data-module]")) {
      box.addEventListener("change", () => this.#saveSelection());
    }
    clearInterval(this.#ticker);
    this.#ticker = setInterval(() => this.#tick(), 1000);
  }

  _onClose(options) {
    clearInterval(this.#ticker);
    this.#ticker = null;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    super._onClose?.(options);
  }

  /** Updates the timer and counters in place, so typing in the report fields is never interrupted. */
  #tick() {
    const root = this.element;
    if (!root) return;
    const s = recorder.getState();
    const set = (sel, v) => {
      const el = root.querySelector(sel);
      if (el) el.textContent = String(v);
    };
    set("[data-live=elapsed]", formatDuration(s.elapsedMs));
    set("[data-live=total]", s.total);
    set("[data-live=errors]", s.errors);
    set("[data-live=warnings]", s.warnings);
    set("[data-live=dropped]", s.dropped);
  }

  #checkedModules() {
    return [...this.element.querySelectorAll("input[data-module]:checked")].map(el => el.dataset.module);
  }

  async #saveSelection(ids = this.#checkedModules()) {
    try {
      await game.settings.set(MODULE_ID, "selection", { saved: true, ids });
    } catch (err) {
      console.error(`${MODULE_ID} | save selection`, err);
    }
  }

  async #guard(fn) {
    if (this.#busy) return;
    this.#busy = true;
    try {
      await fn();
    } catch (err) {
      console.error(`${MODULE_ID} | recorder window`, err);
      ui.notifications.error(t("Notify.Failed"));
    } finally {
      this.#busy = false;
    }
  }

  static async #onToggle() {
    await this.#guard(async () => {
      if (recorder.isRecording()) {
        await recorder.stop();
        ui.notifications.info(t("Notify.Stopped"));
        return;
      }
      const ids = this.#checkedModules();
      if (!ids.length) return ui.notifications.warn(t("Notify.NothingSelected"));
      if (recorder.getState().hasData) {
        const ok = await DialogV2.confirm({
          window: { title: t("Confirm.ReplaceTitle") },
          content: `<p>${t("Confirm.ReplaceBody")}</p>`,
          rejectClose: false
        });
        if (!ok) return;
      }
      await this.#saveSelection(ids);
      this.preview = { text: "", bytes: 0, truncated: false };
      const minutes = game.settings.get(MODULE_ID, "autoStopMinutes");
      if (await recorder.start(ids, { autoStopMinutes: minutes })) ui.notifications.info(t("Notify.Started", { minutes }));
    });
  }

  async #refreshPreview() {
    const ids = recorder.isRecording() || recorder.getState().hasData ? recorder.getState().selected : this.#checkedModules();
    const file = await buildFile(this.report, ids);
    const json = JSON.stringify(file, null, 2);
    this.#setPreview(json);
  }

  #setPreview(json) {
    this.preview = {
      text: json.length > PREVIEW_LIMIT ? json.slice(0, PREVIEW_LIMIT) : json,
      bytes: new TextEncoder().encode(json).length,
      truncated: json.length > PREVIEW_LIMIT
    };
  }

  static async #onPreview() {
    await this.#guard(async () => {
      await this.#refreshPreview();
      this.render();
    });
  }

  static async #onExport() {
    await this.#guard(async () => {
      const ids = recorder.getState().hasData ? recorder.getState().selected : this.#checkedModules();
      const result = await exportFile(this.report, ids);
      this.#setPreview(result.json);
      this.render();
    });
  }

  static async #onCopySummary() {
    await this.#guard(async () => {
      const ids = recorder.getState().hasData ? recorder.getState().selected : this.#checkedModules();
      const text = issueSummary(ids);
      try {
        if (game.clipboard?.copyPlainText) await game.clipboard.copyPlainText(text);
        else await navigator.clipboard.writeText(text);
        ui.notifications.info(t("Notify.Copied"));
      } catch (err) {
        // The browser refused the clipboard (e.g. the page wasn't focused): show the text to copy by hand.
        console.warn(`${MODULE_ID} | clipboard`, err);
        await DialogV2.prompt({
          window: { title: t("App.CopySummary") },
          content: `<p>${escapeHTML(t("App.CopyByHand"))}</p><textarea readonly rows="9" style="width: 100%; font-family: var(--font-mono, monospace);">${escapeHTML(text)}</textarea>`,
          rejectClose: false
        });
      }
    });
  }

  static async #onClear() {
    await this.#guard(async () => {
      if (recorder.isRecording()) return;
      const ok = await DialogV2.confirm({
        window: { title: t("Confirm.ClearTitle") },
        content: `<p>${t("Confirm.ClearBody")}</p>`,
        rejectClose: false
      });
      if (!ok) return;
      recorder.clear();
      this.report = { steps: "", expected: "", actual: "" };
      this.preview = { text: "", bytes: 0, truncated: false };
      this.render();
      ui.notifications.info(t("Notify.Cleared"));
    });
  }

  static async #onSelectAll() {
    if (recorder.isRecording()) return;
    await this.#saveSelection(selectableModules(recorder.registeredIds()).map(m => m.id));
    this.render();
  }

  static async #onSelectNone() {
    if (recorder.isRecording()) return;
    await this.#saveSelection([]);
    this.render();
  }
}

/** The settings menu entry: opens the recorder window instead of a window of its own. */
export class OpenRecorderMenu extends ApplicationV2 {
  async render() {
    try {
      RecorderApp.open();
    } catch (err) {
      console.error(`${MODULE_ID} | open recorder`, err);
    }
    return this;
  }
}
