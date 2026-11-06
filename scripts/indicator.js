import { MODULE_ID, t, escapeHTML, formatDuration } from "./util.js";
import { RecorderApp } from "./apps/recorder-app.js";

/*
 * The recording indicator: a small "Debug recording" badge with a timer, shown on every client (players too) while
 * the world setting `status` says a GM is recording and that GM is online. GMs can click it to open the recorder.
 */

let badge = null;
let timer = null;

function status() {
  try {
    return game.settings.get(MODULE_ID, "status") ?? {};
  } catch {
    return {};
  }
}

function hide() {
  clearInterval(timer);
  timer = null;
  badge?.remove();
  badge = null;
}

export function updateIndicator() {
  const s = status();
  const recorder = s.by ? game.users?.get(s.by) : null;
  if (!s.recording || !recorder?.active) return hide();
  if (!badge) {
    badge = document.createElement("div");
    badge.id = "dxdr-indicator";
    badge.className = "dxdr-indicator";
    badge.setAttribute("role", "status");
    badge.dataset.tooltip = t("Indicator.Tooltip");
    badge.innerHTML = `<i class="fa-solid fa-circle dxdr-indicator-dot" inert></i>
      <span class="dxdr-indicator-label">${escapeHTML(t("Indicator.Label"))}</span>
      <span class="dxdr-indicator-time"></span>`;
    if (game.user.isGM) {
      badge.classList.add("dxdr-clickable");
      badge.addEventListener("click", () => RecorderApp.open());
    }
    document.body.append(badge);
  }
  const tick = () => {
    const el = badge?.querySelector(".dxdr-indicator-time");
    if (el) el.textContent = formatDuration(Date.now() - (s.startedAt ?? Date.now()));
  };
  tick();
  clearInterval(timer);
  timer = setInterval(tick, 1000);
}
