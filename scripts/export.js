import { MODULE_ID, FORMAT, SCHEMA_VERSION, MAX_EXPORT_BYTES, recorderVersion, fileStamp, formatBytes, formatDuration, t } from "./util.js";
import { Redactor } from "./privacy.js";
import { browserInfo } from "./environment.js";
import * as recorder from "./recorder.js";

/*
 * The exported file (one self-describing JSON file for a GitHub issue) and the "Copy issue summary" text.
 * Every part was redacted when it was stored; the whole file goes through the session's Redactor once more here,
 * and the redaction report (counts only) is added last.
 */

const REPORT_FIELDS = ["steps", "expected", "actual"];

/** Markdown summary of a file (stored in the file as `summary`). */
export function summaryMarkdown(file) {
  const env = file.environment ?? {};
  const lines = [];
  const b = env.browser ?? {};
  lines.push("## Debug recording", "");
  lines.push(`- Recorder: ${file.recorderVersion}`);
  if (file.recording?.startedAt) lines.push(`- Started: ${file.recording.startedAt} (UTC), duration ${formatDuration(file.recording.durationMs)}${file.recording.autoStopped ? " (stopped automatically)" : ""}`);
  lines.push(`- Foundry VTT: ${env.foundry?.version ?? "?"} (generation ${env.foundry?.generation ?? "?"}, build ${env.foundry?.build ?? "?"})`);
  lines.push(`- System: ${env.system?.id ?? "?"} ${env.system?.version ?? ""}`.trimEnd());
  lines.push(`- Browser: ${b.family ?? "?"} ${b.version ?? ""} on ${b.os ?? "?"} (${b.desktopApp ? "desktop app" : "browser"})`);
  if (env.display?.screen) lines.push(`- Screen: ${env.display.screen.width}×${env.display.screen.height} @${env.display.devicePixelRatio}, window ${env.display.window?.width}×${env.display.window?.height}`);
  if (env.webgl?.available) lines.push(`- GPU: ${env.webgl.renderer} (WebGL ${env.webgl.webgl}, max texture ${env.webgl.maxTextureSize}, PIXI ${env.webgl.pixi})`);
  lines.push(`- Client: ${env.client?.label ?? "?"}; users connected: ${env.users?.connected ?? "?"} (${env.users?.gmsConnected ?? "?"} GM)`);
  lines.push(`- Active modules: ${env.modules?.activeCount ?? "?"} (${env.modules?.disabledCount ?? "?"} disabled)`);
  lines.push("", "### Selected modules", "");
  if (!file.selectedModules?.length) lines.push("None.");
  else {
    lines.push("| Module | Version | Registered | Events | Errors |", "| --- | --- | --- | --- | --- |");
    for (const id of file.selectedModules) {
      const m = file.modules?.[id] ?? {};
      const evs = (file.events ?? []).filter(e => e.module === id);
      const errors = evs.filter(e => e.level === "error").reduce((n, e) => n + (e.count ?? 1), 0);
      lines.push(`| \`${id}\` | ${m.stateEnd?.version ?? m.stateStart?.version ?? "?"} | ${m.registered ? "yes" : "no"} | ${evs.length} | ${errors} |`);
    }
  }
  const c = file.counts ?? {};
  lines.push("", "### Events", "");
  lines.push(`${c.total ?? 0} events (${c.errors ?? 0} errors, ${c.warnings ?? 0} warnings), ${c.collapsed ?? 0} repeats collapsed, ${c.dropped ?? 0} dropped.`);
  const top = (file.events ?? []).filter(e => e.level === "error").sort((a, b) => (b.count ?? 1) - (a.count ?? 1)).slice(0, 10);
  if (top.length) {
    lines.push("", "Top errors:", "");
    for (const e of top) {
      const msg = String(e.message ?? "").replace(/\s+/g, " ").replaceAll("`", "'").slice(0, 160);
      lines.push(`- ${e.type}${e.hook ? ` (${e.hook})` : ""} ×${e.count ?? 1}${e.module ? ` [${e.module}]` : ""}: \`${msg}\``);
    }
  }
  for (const key of REPORT_FIELDS) {
    const text = file.report?.[key];
    if (!text) continue;
    lines.push("", `### ${{ steps: "Steps to reproduce", expected: "Expected behaviour", actual: "Actual behaviour" }[key]}`, "", text);
  }
  return lines.join("\n");
}

/** Builds the export file (an object). `report` = {steps, expected, actual}; `selected` is used without a recording. */
export async function buildFile(report = {}, selected = []) {
  const s = await recorder.prepareExport(selected);
  const r = s.redactor;
  const end = s.recording ? Date.now() : (s.stoppedAt ?? Date.now());
  const file = {
    format: FORMAT,
    schemaVersion: SCHEMA_VERSION,
    recorderVersion: recorderVersion(),
    createdAt: new Date().toISOString(),
    recording: {
      recorded: !s.adHoc,
      startedAt: s.adHoc ? null : new Date(s.startedAt).toISOString(),
      durationMs: s.adHoc ? 0 : end - s.startedAt,
      stillRecording: !!s.recording,
      autoStopped: !!s.autoStopped,
      autoStopMinutes: s.autoStopMinutes
    },
    selectedModules: [...s.selected],
    clients: {
      recorded: [s.client.label],
      note: "Version 0.1 records the GM client that started the recording only."
    },
    report: Object.fromEntries(REPORT_FIELDS.map(k => [k, r.scrubString(String(report[k] ?? "").trim(), { maxLength: 10000 })])),
    environment: s.environment,
    modules: Object.fromEntries([...s.selected].map(id => {
      const m = s.modules[id] ?? {};
      return [id, { registered: recorder.isRegistered(id), stateStart: m.stateStart ?? null, stateEnd: m.stateEnd ?? null, snapshots: m.snapshots ?? {} }];
    })),
    counts: { ...s.counts, stored: s.events.length },
    events: s.events,
    summary: ""
  };
  const clean = r.redact(file, { maxDepth: 24 });
  // Built from the redacted file, so it holds nothing the file doesn't; not scrubbed again, so its own words
  // ("window", "Screen") stay readable even when a world document has that name.
  clean.summary = summaryMarkdown(clean);
  clean.redaction = { ...r.report, knownLiterals: r.literalCount };
  return clean;
}

export function fileName(date = new Date()) {
  return `dxcufgbs-debug-${fileStamp(date)}.json`;
}

function download(json, filename) {
  const save = globalThis.foundry?.utils?.saveDataToFile;
  if (typeof save === "function") return save(json, "application/json", filename);
  const blob = new Blob([json], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/**
 * GM: builds the file, refuses it when it is too big, and downloads it.
 * @returns {{ok: boolean, json: string, filename: string, bytes: number}}
 */
export async function exportFile(report, selected) {
  const file = await buildFile(report, selected);
  const json = JSON.stringify(file, null, 2);
  const bytes = new TextEncoder().encode(json).length;
  const filename = fileName();
  if (bytes > MAX_EXPORT_BYTES) {
    ui.notifications.error(t("Notify.TooBig", { size: formatBytes(bytes), max: formatBytes(MAX_EXPORT_BYTES) }));
    return { ok: false, json, filename, bytes };
  }
  download(json, filename);
  ui.notifications.info(t("Notify.Exported", { file: filename, size: formatBytes(bytes) }));
  return { ok: true, json, filename, bytes };
}

/** "Copy issue summary": Foundry, system and browser versions and the selected modules' versions, as Markdown. */
export function issueSummary(selected = []) {
  const b = browserInfo();
  const lines = [
    `**Foundry VTT:** ${game.version ?? "?"} (build ${game.release?.build ?? "?"})`,
    `**System:** ${game.system?.id ?? "?"} ${game.system?.version ?? ""}`.trimEnd(),
    `**Browser:** ${b.family} ${b.version} on ${b.os} (${b.desktopApp ? "desktop app" : "browser"})`,
    `**Recorder:** ${MODULE_ID} ${recorderVersion()}`,
    "**Modules:**"
  ];
  if (!selected.length) lines.push("- none selected");
  for (const id of selected) {
    const mod = game.modules.get(id);
    lines.push(`- ${mod?.title ?? id} (\`${id}\`) ${mod?.version ?? "?"}`);
  }
  // Module titles are not private, but run the text through a Redactor anyway: nothing reaches the clipboard unscrubbed.
  const r = Redactor.fromWorld(game, globalThis.location);
  return r.scrubString(lines.join("\n"), { maxLength: 20000, version: true });
}
