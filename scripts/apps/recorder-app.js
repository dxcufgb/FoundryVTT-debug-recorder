import { MODULE_ID, TEMPLATE_PATH, AUTO_ZIP_BYTES, MAX_RECORDINGS, t, escapeHTML, selectableModules, formatDuration, formatBytes } from "../util.js";
import { canZip } from "../zip.js";
import * as recorder from "../recorder.js";
import { buildFile, exportFile, exportRecordings, issueSummary } from "../export.js";

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

const EMPTY_REPORT = () => ({ steps: "", expected: "", actual: "" });
const EMPTY_PREVIEW = () => ({ id: null, text: "", bytes: 0, truncated: false });

/**
 * The recorder window (GM only): module checklist, Start / Stop with timer and counters, the list of recordings
 * (one per bug: tick, name, view, delete; Shift-click ticks a range), the bug report fields of the recording being
 * viewed (steps, expected, actual), the preview of its exact file, Download selected, Copy issue summary and Delete
 * selected.
 */
export class RecorderApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "dxdr-recorder",
    classes: ["dxdr", "dxdr-recorder"],
    tag: "div",
    window: { title: "DXDR.App.Title", icon: "fa-solid fa-bug", resizable: true },
    position: { width: 640, height: 760 },
    actions: {
      toggle: RecorderApp.#onToggle,
      exportFile: RecorderApp.#onExport,
      copySummary: RecorderApp.#onCopySummary,
      deletePicked: RecorderApp.#onDeletePicked,
      deleteOne: RecorderApp.#onDeleteOne,
      view: RecorderApp.#onView,
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

  /** The recording whose report, counters and preview are shown (null without recordings). */
  viewing = null;
  /** Ticked recordings (ids), for Download / Delete selected. */
  picked = new Set();
  /** Report fields for an export without any recording (each recording keeps its own). */
  adHocReport = EMPTY_REPORT();
  /** "Export as .zip" ticked (also used automatically for big files; two or more recordings are always zipped). */
  zip = false;
  preview = EMPTY_PREVIEW();
  /** The recording ticked or unticked last: the start of a Shift-click range. */
  #lastPicked = null;
  #ticker = null;
  #unsubscribe = null;
  #busy = false;
  #saving = Promise.resolve();

  constructor(options = {}) {
    super(options);
    this.#unsubscribe = recorder.subscribe(() => this.render());
  }

  get selection() {
    return savedSelection();
  }

  /** The report fields shown: the viewed recording's, or the ad hoc ones without recordings. */
  get report() {
    return (this.viewing && recorder.getRecording(this.viewing)?.report) || this.adHocReport;
  }

  /** Drops ticks and the viewed id of deleted recordings; views the running or newest one by default. */
  #syncWithRecorder(state = recorder.getState()) {
    const ids = new Set(state.recordings.map(r => r.id));
    for (const id of this.picked) if (!ids.has(id)) this.picked.delete(id);
    if (this.#lastPicked && !ids.has(this.#lastPicked)) this.#lastPicked = null;
    if (!ids.has(this.viewing)) this.viewing = state.activeId ?? state.recordings.at(-1)?.id ?? null;
    if (this.preview.id && this.preview.id !== this.viewing) this.preview = EMPTY_PREVIEW();
    return state;
  }

  async _prepareContext() {
    const state = this.#syncWithRecorder();
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
    const viewed = this.viewing ? recorder.recordingState(this.viewing) : null;
    // Newest first, like a mailbox.
    const recordings = [...state.recordings].reverse().map(r => ({
      id: r.id,
      label: r.label,
      placeholder: t("App.DefaultLabel", { n: r.number }),
      recording: r.recording,
      started: new Date(r.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      elapsed: formatDuration(r.elapsedMs),
      total: r.total,
      errors: r.errors,
      picked: this.picked.has(r.id),
      viewing: r.id === this.viewing
    }));
    const pickedCount = this.picked.size;
    return {
      modules,
      noModules: !modules.length,
      recording: state.recording,
      canStart: state.canStart,
      hasData: state.hasData,
      recordings,
      allPicked: recordings.length > 0 && pickedCount === recordings.length,
      pickedCount,
      deletableCount: this.#deletablePicked().length,
      viewedLabel: viewed ? viewed.label || t("App.DefaultLabel", { n: viewed.number }) : "",
      elapsed: formatDuration(viewed?.elapsedMs ?? 0),
      total: viewed?.total ?? 0,
      errors: viewed?.errors ?? 0,
      warnings: viewed?.warnings ?? 0,
      dropped: viewed?.dropped ?? 0,
      autoStop,
      report: this.report,
      zip: this.zip,
      canZip: canZip(),
      zipHint: t("App.ZipHint", { size: formatBytes(AUTO_ZIP_BYTES) }),
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
      field.addEventListener("input", () => {
        if (this.viewing) recorder.setReport(this.viewing, field.dataset.report, field.value);
        else this.adHocReport[field.dataset.report] = field.value;
      });
    }
    root.querySelector("input[data-zip]")?.addEventListener("change", ev => { this.zip = ev.currentTarget.checked; });
    for (const box of root.querySelectorAll("input[data-module]")) {
      box.addEventListener("change", () => this.#saveSelection());
    }
    for (const box of root.querySelectorAll("input[data-pick]")) {
      box.addEventListener("click", ev => this.#onPick(ev, box));
    }
    root.querySelector("input[data-pick-all]")?.addEventListener("change", ev => this.#pickAll(ev.currentTarget.checked));
    for (const input of root.querySelectorAll("input[data-label]")) {
      input.addEventListener("input", () => {
        recorder.rename(input.dataset.label, input.value);
        if (input.dataset.label === this.viewing) {
          for (const head of root.querySelectorAll("[data-viewed-label]")) head.textContent = input.value || input.placeholder;
        }
      });
      input.addEventListener("keydown", ev => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          input.blur();
        }
      });
    }
    this.#updatePickControls();
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

  /** Updates the timer and counters in place, so typing in the report fields or a label is never interrupted. */
  #tick() {
    const root = this.element;
    if (!root) return;
    const set = (el, v) => {
      if (el) el.textContent = String(v);
    };
    const viewed = this.viewing ? recorder.recordingState(this.viewing) : null;
    set(root.querySelector("[data-live=elapsed]"), formatDuration(viewed?.elapsedMs ?? 0));
    for (const key of ["total", "errors", "warnings", "dropped"]) set(root.querySelector(`[data-live=${key}]`), viewed?.[key] ?? 0);
    const active = recorder.getState().activeId;
    const row = active ? root.querySelector(`[data-recording="${CSS.escape(active)}"]`) : null;
    if (row) {
      const s = recorder.recordingState(active);
      set(row.querySelector("[data-row-live=elapsed]"), formatDuration(s?.elapsedMs ?? 0));
      set(row.querySelector("[data-row-live=total]"), s?.total ?? 0);
      set(row.querySelector("[data-row-live=errors]"), s?.errors ?? 0);
    }
  }

  /* -------------------------------------------- */
  /*  Ticking recordings                          */
  /* -------------------------------------------- */

  #pickBoxes() {
    return [...(this.element?.querySelectorAll("input[data-pick]") ?? [])];
  }

  /**
   * A click on a recording's checkbox. With Shift, every recording from the one clicked last to this one gets this
   * one's new state (like selecting a run of e-mails in Gmail).
   */
  #onPick(ev, box) {
    const boxes = this.#pickBoxes();
    const at = boxes.indexOf(box);
    const from = ev.shiftKey && this.#lastPicked ? boxes.findIndex(b => b.dataset.pick === this.#lastPicked) : -1;
    const range = from >= 0 && at >= 0 ? boxes.slice(Math.min(from, at), Math.max(from, at) + 1) : [box];
    for (const b of range) {
      b.checked = box.checked;
      if (box.checked) this.picked.add(b.dataset.pick);
      else this.picked.delete(b.dataset.pick);
    }
    this.#lastPicked = box.dataset.pick;
    this.#updatePickControls();
  }

  #pickAll(on) {
    for (const b of this.#pickBoxes()) {
      b.checked = on;
      if (on) this.picked.add(b.dataset.pick);
      else this.picked.delete(b.dataset.pick);
    }
    this.#lastPicked = null;
    this.#updatePickControls();
  }

  /** The ticked recordings that can be deleted (not the running one). */
  #deletablePicked() {
    const active = recorder.getState().activeId;
    return [...this.picked].filter(id => id !== active);
  }

  /** The "all" checkbox, the counts on the buttons and whether they can be clicked, without re-rendering. */
  #updatePickControls() {
    const root = this.element;
    if (!root) return;
    const boxes = this.#pickBoxes();
    const count = boxes.filter(b => b.checked).length;
    const all = root.querySelector("input[data-pick-all]");
    if (all) {
      all.checked = boxes.length > 0 && count === boxes.length;
      all.indeterminate = count > 0 && count < boxes.length;
    }
    for (const el of root.querySelectorAll("[data-picked-count]")) el.textContent = String(count);
    const deletable = this.#deletablePicked().length;
    for (const el of root.querySelectorAll("[data-deletable-count]")) el.textContent = String(deletable);
    const download = root.querySelector("[data-action=exportFile][data-needs-pick]");
    if (download) download.disabled = count === 0;
    const del = root.querySelector("[data-action=deletePicked]");
    if (del) del.disabled = deletable === 0;
  }

  /** Ticked recordings in list order (newest first), so the zip lists them as the window does. */
  #pickedInOrder() {
    const order = [...recorder.getState().recordings].reverse().map(r => r.id);
    return order.filter(id => this.picked.has(id));
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  #checkedModules() {
    return [...this.element.querySelectorAll("input[data-module]:checked")].map(el => el.dataset.module);
  }

  /**
   * Saves the ticked modules. Saves run one after another: two quick changes saved at once would each create the
   * world setting (found in the live test: two "selection" setting documents).
   */
  #saveSelection(ids = this.#checkedModules()) {
    this.#saving = this.#saving.then(() => game.settings.set(MODULE_ID, "selection", { saved: true, ids })).catch(err => {
      console.error(`${MODULE_ID} | save selection`, err);
    });
    return this.#saving;
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
      if (!recorder.canStart()) return ui.notifications.warn(t("Notify.TooMany", { max: MAX_RECORDINGS }));
      await this.#saveSelection(ids);
      const minutes = game.settings.get(MODULE_ID, "autoStopMinutes");
      if (await recorder.start(ids, { autoStopMinutes: minutes })) {
        // The new recording is viewed and ticked, so Stop → Download works without touching the list.
        const id = recorder.getState().activeId;
        this.viewing = id;
        this.picked.add(id);
        this.preview = EMPTY_PREVIEW();
        this.render();
        ui.notifications.info(t("Notify.Started", { minutes }));
      }
    });
  }

  async #refreshPreview() {
    const id = this.viewing;
    const file = id ? await buildFile(null, [], { id }) : await buildFile(this.adHocReport, this.#checkedModules());
    this.#setPreview(JSON.stringify(file, null, 2), id);
  }

  #setPreview(json, id = this.viewing) {
    this.preview = {
      id,
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

  /** Downloads the ticked recordings (two or more: one .zip), or without recordings a file without a recording. */
  static async #onExport() {
    await this.#guard(async () => {
      if (!recorder.getState().hasData) {
        const result = await exportFile(this.adHocReport, this.#checkedModules(), { zip: this.zip });
        this.#setPreview(result.json, null);
        this.render();
        return;
      }
      const ids = this.#pickedInOrder();
      if (!ids.length) return ui.notifications.warn(t("Notify.NothingPicked"));
      const result = await exportRecordings(ids, { zip: this.zip });
      if (ids.length === 1 && ids[0] === this.viewing && result.json) {
        this.#setPreview(result.json, ids[0]);
        this.render();
      }
    });
  }

  static async #onCopySummary() {
    await this.#guard(async () => {
      const rec = this.viewing ? recorder.getRecording(this.viewing) : null;
      const text = await issueSummary(rec ? rec.selected : this.#checkedModules(), { id: rec?.id ?? null });
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

  /** Asks, then deletes the recordings `ids` (never the running one). */
  async #delete(ids) {
    const active = recorder.getState().activeId;
    ids = ids.filter(id => id !== active);
    if (!ids.length) return;
    const names = ids.map(id => {
      const r = recorder.getRecording(id);
      return r ? r.label || t("App.DefaultLabel", { n: r.number }) : id;
    });
    const ok = await DialogV2.confirm({
      window: { title: t(ids.length === 1 ? "Confirm.DeleteOneTitle" : "Confirm.DeleteTitle", { count: ids.length }) },
      content: `<p>${escapeHTML(t("Confirm.DeleteBody"))}</p><ul>${names.map(n => `<li>${escapeHTML(n)}</li>`).join("")}</ul>`,
      rejectClose: false
    });
    if (!ok) return;
    const removed = recorder.remove(ids);
    this.#syncWithRecorder();
    this.render();
    if (removed) ui.notifications.info(t("Notify.Deleted", { count: removed }));
  }

  static async #onDeletePicked() {
    await this.#guard(() => this.#delete(this.#pickedInOrder()));
  }

  static async #onDeleteOne(event, target) {
    await this.#guard(() => this.#delete([target.dataset.id]));
  }

  static #onView(event, target) {
    const id = target.dataset.id;
    if (!id || id === this.viewing) return;
    this.viewing = id;
    this.preview = EMPTY_PREVIEW();
    this.render();
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
