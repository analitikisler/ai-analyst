// The model's own text for a turn (B1): a reason it cannot answer, or the closing line under a card. Plain text
// with the little Markdown models write: **bold**, "- " and "1. " lists, paragraphs. Headings become bold lines;
// any other mark-up is dropped, never rendered as HTML.
import type { ReactNode } from "react";

/** **bold** to <strong>; stray *, _ and ` are dropped. */
function inline(text: string, key: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={`${key}-${i}`} className="font-semibold text-text-strong">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part.replace(/`([^`]*)`/g, "$1").replace(/(^|\s)[*_]+|[*_]+(?=\s|$|[.,;:])/g, "$1")
    ),
  );
}

export type Block = { kind: "p"; text: string } | { kind: "ul" | "ol"; items: string[] };

/** Splits the text into paragraphs and lists. Exported for tests of the shape, not the markup. */
export function blocksOf(text: string): Block[] {
  const out: Block[] = [];
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    const last = out[out.length - 1];
    const ul = line.match(/^[-*•]\s+(.*)$/);
    const ol = line.match(/^\d+[.)]\s+(.*)$/);
    if (!line) {
      out.push({ kind: "p", text: "" });
    } else if (ul || ol) {
      const kind = ul ? "ul" : "ol";
      const item = (ul ?? ol)![1];
      if (last && last.kind === kind) last.items.push(item);
      else out.push({ kind, items: [item] });
    } else {
      const plain = line.replace(/^#{1,6}\s+(.*)$/, "**$1**");
      if (last && last.kind === "p" && last.text) last.text += ` ${plain}`;
      else out.push({ kind: "p", text: plain });
    }
  }
  return out.filter((b) => (b.kind === "p" ? b.text : b.items.length));
}

export function ModelText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className ?? "flex max-w-[68ch] flex-col gap-2 text-[15px] leading-6 text-text"}>
      {blocksOf(text).map((b, i) =>
        b.kind === "p" ? (
          <p key={i}>{inline(b.text, String(i))}</p>
        ) : b.kind === "ul" ? (
          <ul key={i} className="flex list-disc flex-col gap-1 pl-5">
            {b.items.map((x, j) => (
              <li key={j}>{inline(x, `${i}-${j}`)}</li>
            ))}
          </ul>
        ) : (
          <ol key={i} className="flex list-decimal flex-col gap-1 pl-5">
            {b.items.map((x, j) => (
              <li key={j}>{inline(x, `${i}-${j}`)}</li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
}
