// Per-browser preferences (language override, theme, dismissed cards). localStorage can be missing or throw
// (private windows, blocked storage, previews), so every read and write is guarded and the app works without it.
import { useCallback, useSyncExternalStore } from "react";

const PREFIX = "ai-analyst:";

export interface Prefs {
  /** "system" follows the browser. */
  lang: "system" | "en" | "tr";
  theme: "system" | "light" | "dark";
  /** The sidebar "Make it yours" card was dismissed. */
  makeItYoursDismissed: boolean;
  /** "Not now" on the ai cloud line. */
  cloudNotNow: boolean;
  /** The Ask page conversation column is collapsed. */
  askColumnCollapsed: boolean;
}

const DEFAULTS: Prefs = { lang: "system", theme: "system", makeItYoursDismissed: false, cloudNotNow: false, askColumnCollapsed: false };
const ALLOWED: { [K in keyof Prefs]: (v: unknown) => v is Prefs[K] } = {
  lang: (v): v is Prefs["lang"] => v === "system" || v === "en" || v === "tr",
  theme: (v): v is Prefs["theme"] => v === "system" || v === "light" || v === "dark",
  makeItYoursDismissed: (v): v is boolean => typeof v === "boolean",
  cloudNotNow: (v): v is boolean => typeof v === "boolean",
  askColumnCollapsed: (v): v is boolean => typeof v === "boolean",
};

// In-memory copy so a blocked storage still keeps choices for this tab.
const memory: Partial<Prefs> = {};
const listeners = new Set<() => void>();

export function readPref<K extends keyof Prefs>(key: K): Prefs[K] {
  if (key in memory) return memory[key] as Prefs[K];
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw != null) {
      const v: unknown = JSON.parse(raw);
      if (ALLOWED[key](v)) return v;
    }
  } catch {
    /* storage blocked or bad JSON */
  }
  return DEFAULTS[key];
}

export function writePref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  memory[key] = value;
  try {
    if (value === DEFAULTS[key]) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* keep the in-memory value */
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key?.startsWith(PREFIX)) {
      delete memory[e.key.slice(PREFIX.length) as keyof Prefs];
      cb();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** `[value, setValue]` for one preference; every component using it re-renders on change (and across tabs). */
export function usePref<K extends keyof Prefs>(key: K): [Prefs[K], (v: Prefs[K]) => void] {
  const value = useSyncExternalStore(subscribe, () => readPref(key), () => DEFAULTS[key]);
  const set = useCallback((v: Prefs[K]) => writePref(key, v), [key]);
  return [value, set];
}
