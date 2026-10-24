// Language: the browser decides (tr or en), Settings can override it, one language per screen.
// `useT()` gives the typed copy object, `useLang()` the code; `fmt` and `plural` fill templates.
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import type { Lang } from "@/api/types";
import { usePref } from "@/lib/prefs";
import { en, type Copy } from "./en";
import { tr } from "./tr";

export type { Copy } from "./en";
export const COPY: Record<Lang, Copy> = { en, tr };
export const LANGS: Lang[] = ["en", "tr"];

type Vars = Record<string, string | number | null | undefined>;

/** Fills `{name}` placeholders. A missing value leaves the placeholder, so a gap shows in review. */
export function fmt(template: string, vars: Vars = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => {
    const v = vars[k];
    return v === null || v === undefined ? m : String(v);
  });
}

const rules: Record<Lang, Intl.PluralRules> = { en: new Intl.PluralRules("en-GB"), tr: new Intl.PluralRules("tr") };

/**
 * Picks `one` or `other` by the language's plural rules, then fills it; `{count}` is always available
 * (pass a formatted `count` in `vars` to override the raw number).
 */
export function plural(lang: Lang, count: number, forms: { one: string; other: string }, vars: Vars = {}): string {
  const form = rules[lang].select(count) === "one" ? forms.one : forms.other;
  return fmt(form, { count, ...vars });
}

/** The browser's first language that is Turkish or English; English otherwise. */
export function detectLanguage(languages: readonly (string | undefined)[] = typeof navigator === "undefined" ? [] : (navigator.languages ?? [navigator.language])): Lang {
  for (const l of languages) {
    if (!l) continue;
    const code = l.toLowerCase();
    if (code.startsWith("tr")) return "tr";
    if (code.startsWith("en")) return "en";
  }
  return "en";
}

interface LanguageValue {
  lang: Lang;
  copy: Copy;
  /** The browser's language, shown next to "Browser language" in Settings. */
  detected: Lang;
}

const LanguageContext = createContext<LanguageValue | null>(null);

/** `lang` pins the language (tests, previews); otherwise the Settings choice, then the browser. */
export function LanguageProvider({ children, lang: pinned }: { children: ReactNode; lang?: Lang }) {
  const [pref] = usePref("lang");
  const detected = useMemo(() => detectLanguage(), []);
  const lang: Lang = pinned ?? (pref === "system" ? detected : pref);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const value = useMemo(() => ({ lang, copy: COPY[lang], detected }), [lang, detected]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

function useLanguage(): LanguageValue {
  const v = useContext(LanguageContext);
  if (!v) throw new Error("useT/useLang need <LanguageProvider>.");
  return v;
}

/** The copy object for the current language. */
export const useT = () => useLanguage().copy;
/** "en" or "tr". */
export const useLang = () => useLanguage().lang;
/** The browser's language (for the "Browser language" option). */
export const useDetectedLang = () => useLanguage().detected;

/** Picks the current language from a server-made `{ en, tr }` string. */
export function useBilingual() {
  const lang = useLang();
  return (s: { en: string; tr: string } | null | undefined) => (s ? s[lang] : "");
}
