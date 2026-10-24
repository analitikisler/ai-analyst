// Light / dark / system menu in the top bar (DECISIONS.md §9; Overt ThemeToggle on the shadcn DropdownMenu).
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { fmt, useT } from "@/i18n";
import { useTheme, type ThemePref } from "@/lib/theme";

const ICONS = { light: SunIcon, dark: MoonIcon, system: MonitorIcon } as const;
const OPTIONS: ThemePref[] = ["system", "dark", "light"];

export function ThemeToggle({ align = "end" }: { align?: "start" | "end" }) {
  const t = useT();
  const { pref, resolved, setPref } = useTheme();
  const Current = resolved === "dark" ? MoonIcon : SunIcon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="pointer-coarse:size-10" aria-label={fmt(t.shell.theme_current, { theme: t.shell.themes[pref] })} title={t.shell.theme} />}>
        <Current strokeWidth={1.75} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-36">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t.shell.theme}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={pref} onValueChange={(v) => setPref(v as ThemePref)}>
            {OPTIONS.map((o) => {
              const Icon = ICONS[o];
              return (
                <DropdownMenuRadioItem key={o} value={o}>
                  <Icon strokeWidth={1.75} />
                  {t.shell.themes[o]}
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
