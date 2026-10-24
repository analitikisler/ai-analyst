// Tally status glyphs (design/04-system/icons/sprite.svg: i-st-ok, i-st-bad, i-st-warn), because ✓ ✗ are in none
// of the three fonts. Always next to a word; the glyph is decorative.
export type GlyphTone = "ok" | "bad" | "warn";

export function StatusGlyph({ tone, size = 12, className }: { tone: GlyphTone; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden className={className}>
      {tone === "ok" && <path d="M3 8.25 6.5 11.75 13 4.75" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="square" />}
      {tone === "bad" && <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="square" />}
      {tone === "warn" && <path d="M6.9 2.5h2.2v7.25H6.9zM6.9 11.25h2.2v2.25H6.9z" fill="currentColor" />}
    </svg>
  );
}
