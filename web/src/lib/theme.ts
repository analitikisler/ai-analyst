// Light / dark / system. "system" removes data-theme, so the CSS media query decides (brand/tokens.css);
// light or dark set data-theme on <html>. index.html applies the saved choice before first paint.
import { useSyncExternalStore } from "react";
import { usePref, type Prefs } from "./prefs";

export type ThemePref = Prefs["theme"];
export type ResolvedTheme = "light" | "dark";

const media = () => window.matchMedia("(prefers-color-scheme: dark)");

export function applyTheme(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", pref);
}

function subscribeResolved(cb: () => void) {
  const m = media();
  m.addEventListener("change", cb);
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => {
    m.removeEventListener("change", cb);
    obs.disconnect();
  };
}

function readResolved(): ResolvedTheme {
  const forced = document.documentElement.getAttribute("data-theme");
  if (forced === "light" || forced === "dark") return forced;
  return media().matches ? "dark" : "light";
}

/** `{ pref, resolved, setPref }`; `resolved` is the theme showing now. */
export function useTheme() {
  const [pref, setStored] = usePref("theme");
  const resolved = useSyncExternalStore(subscribeResolved, readResolved, () => "light" as ResolvedTheme);
  const setPref = (p: ThemePref) => {
    setStored(p);
    applyTheme(p);
  };
  return { pref, resolved, setPref };
}
