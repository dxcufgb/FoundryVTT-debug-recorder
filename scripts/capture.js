import { MODULE_ID } from "./util.js";
import { moduleFromStack } from "./privacy.js";

/*
 * Event capture while recording (spec items 19–24). Installed at Start, removed at Stop.
 *
 *  - uncaught errors and unhandled promise rejections (window events)                         → "error" / "rejection"
 *  - errors Foundry caught in hooks and elsewhere (the core "error" hook, with the hook name)  → "hookError"
 *  - console.error / warn / log / info from selected modules, console.error from anything else → "console"
 *  - deprecation / compatibility warnings from selected modules                                → "deprecation"
 *  - warning and error notifications                                                           → "notification"
 *
 * Every event is attributed to a module by the first modules/<id>/ frame of its stack (skipping the recorder).
 * Nothing is stored here: `sink.record(type, fields, {module, level})` redacts and stores. A capture problem must never
 * break the console, a notification or the code that logged.
 */

const CONSOLE_LEVELS = ["error", "warn", "log", "info"];
const DEPRECATION_RE = /Deprecated since Version|Backwards-compatible support will be removed|is deprecated|has been deprecated/i;

let state = null;

function asError(value) {
  return value && typeof value === "object" && typeof value.message === "string" && typeof value.stack === "string" ? value : null;
}

/** The call stack without the recorder's own frames (and the "Error" line). */
function callStack() {
  const stack = new Error().stack ?? "";
  return stack.split("\n").slice(1).filter(l => !l.includes(`modules/${MODULE_ID}/`)).slice(0, 25).join("\n");
}

/** Console arguments as one message (%c styles removed) plus up to three logged objects. */
export function formatConsoleArgs(args) {
  const parts = [];
  const data = [];
  let skipStyles = 0;
  args.forEach((arg, i) => {
    if (skipStyles > 0 && typeof arg === "string") {
      skipStyles--;
      return;
    }
    if (typeof arg === "string") {
      if (i === 0) skipStyles = (arg.match(/%c/g) ?? []).length;
      parts.push(arg.replace(/%c/g, ""));
    } else if (asError(arg)) {
      parts.push(`${arg.name ?? "Error"}: ${arg.message}`);
    } else if (arg === null || ["number", "boolean", "undefined", "bigint", "symbol"].includes(typeof arg)) {
      parts.push(String(arg));
    } else if (data.length < 3) {
      data.push(arg);
    }
  });
  return { message: parts.join(" ").replace(/\s+/g, " ").trim(), data: data.length ? data : undefined };
}

/**
 * Starts capturing. `sink` = {record(type, fields, opts), isSelected(moduleId)}. `target` lets the test pass its own
 * window / console / notifications.
 */
export function installCapture(sink, target = {}) {
  if (state) return;
  const win = target.window ?? globalThis.window ?? globalThis;
  const con = target.console ?? globalThis.console;
  const notifications = target.notifications ?? globalThis.ui?.notifications ?? null;
  const hooks = target.hooks ?? globalThis.Hooks;
  const s = { sink, win, con, notifications, hooks, active: true, busy: false, seen: new WeakMap(), originals: {}, wrappers: {}, listeners: [], hookId: null };
  state = s;

  /** Runs one capture handler, never recursively (a capture that logs) and never throwing. */
  const guarded = fn => {
    if (!s.active || s.busy) return;
    s.busy = true;
    try {
      fn();
    } catch {
      // capturing must never break anything
    } finally {
      s.busy = false;
    }
  };
  const remember = (err, ev) => {
    if (err && ev) s.seen.set(err, ev);
  };

  // --- console ---------------------------------------------------------------------------------------------------
  for (const level of CONSOLE_LEVELS) {
    const original = con?.[level];
    if (typeof original !== "function") continue;
    s.originals[level] = original;
    const wrapper = function (...args) {
      guarded(() => {
        const err = args.map(asError).find(Boolean) ?? null;
        if (err && s.seen.has(err)) return;
        const stack = callStack();
        const { message, data } = formatConsoleArgs(args);
        const caller = moduleFromStack(stack);
        const module = (level === "error" ? moduleFromStack(err?.stack) ?? caller : caller ?? moduleFromStack(err?.stack)) ?? null;
        const selected = module && sink.isSelected(module);
        if (level === "warn" && DEPRECATION_RE.test(message)) {
          if (selected) sink.record("deprecation", { message, stack }, { module, level: "warn" });
          return;
        }
        if (!selected && level !== "error") return;
        const ev = sink.record("console", { consoleLevel: level, message, stack: err?.stack ?? stack, data }, { module, level: level === "error" ? "error" : level === "warn" ? "warn" : "info" });
        remember(err, ev);
      });
      return original.apply(this, args);
    };
    s.wrappers[level] = wrapper;
    con[level] = wrapper;
  }

  // --- uncaught errors and rejections ----------------------------------------------------------------------------
  const onError = event => guarded(() => {
    const err = asError(event?.error);
    if (err && s.seen.has(err)) return;
    const location = event?.filename ? `${event.filename}:${event.lineno ?? 0}:${event.colno ?? 0}` : "";
    const ev = sink.record("error", { message: err?.message ?? String(event?.message ?? ""), error: err ?? undefined, stack: err?.stack ?? location },
      { module: moduleFromStack(err?.stack ?? location), level: "error" });
    remember(err, ev);
  });
  const onRejection = event => guarded(() => {
    const reason = event?.reason;
    const err = asError(reason);
    if (err && s.seen.has(err)) return;
    const ev = sink.record("rejection", { message: err?.message ?? String(reason ?? ""), error: err ?? undefined, stack: err?.stack },
      { module: moduleFromStack(err?.stack), level: "error" });
    remember(err, ev);
  });
  if (typeof win?.addEventListener === "function") {
    win.addEventListener("error", onError);
    win.addEventListener("unhandledrejection", onRejection);
    s.listeners.push(["error", onError], ["unhandledrejection", onRejection]);
  }

  // --- errors Foundry caught (Hooks.onError calls the "error" hook) ------------------------------------------------
  if (typeof hooks?.on === "function") {
    s.hookId = hooks.on("error", (location, error, data) => guarded(() => {
      const err = asError(error);
      const hook = typeof data?.hook === "string" ? data.hook : null;
      const fields = { location: typeof location === "string" ? location : null, hook, fn: typeof data?.fn?.name === "string" ? data.fn.name : null };
      const known = err ? s.seen.get(err) : null;
      if (known) {
        // Already logged through console.error: add what the hook knows to that event.
        known.type = "hookError";
        Object.assign(known, sink.redactFields?.(fields) ?? {});
        return;
      }
      const ev = sink.record("hookError", { ...fields, message: err?.message ?? String(error ?? ""), error: err ?? undefined, stack: err?.stack },
        { module: moduleFromStack(err?.stack), level: "error" });
      remember(err, ev);
    }));
  }

  // --- notifications ---------------------------------------------------------------------------------------------
  const notify = notifications?.notify;
  if (typeof notify === "function") {
    s.originals.notify = notify;
    s.wrappers.notify = function (message, type, options) {
      guarded(() => {
        if (type !== "warning" && type !== "error") return;
        let text = message;
        if (options?.localize && typeof text === "string") {
          text = options.format ? game.i18n.format(text, options.format) : game.i18n.localize(text);
        }
        const stack = callStack();
        sink.record("notification", { notificationType: type, message: String(text ?? ""), stack }, { module: moduleFromStack(stack), level: type === "error" ? "error" : "warn" });
      });
      return notify.call(this, message, type, options);
    };
    notifications.notify = s.wrappers.notify;
  }
}

/** Stops capturing and puts back everything that wasn't wrapped again by someone else since. */
export function uninstallCapture() {
  const s = state;
  if (!s) return;
  s.active = false;
  state = null;
  for (const level of CONSOLE_LEVELS) {
    if (s.wrappers[level] && s.con?.[level] === s.wrappers[level]) s.con[level] = s.originals[level];
  }
  if (s.wrappers.notify && s.notifications?.notify === s.wrappers.notify) s.notifications.notify = s.originals.notify;
  for (const [type, fn] of s.listeners) s.win?.removeEventListener?.(type, fn);
  if (s.hookId !== null) s.hooks?.off?.("error", s.hookId);
}

export function isCapturing() {
  return !!state?.active;
}
