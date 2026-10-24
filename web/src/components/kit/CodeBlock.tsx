// Ported from Overt (ui/CodeBlock.tsx): mono code on the sunken `well`, with a copy button. Used for the SQL
// an answer ran and the MCP snippets in Settings.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "cn";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useT } from "@/i18n";

/** Copy text to the clipboard; `copied` flips true for 1.5 s. */
export function useCopy() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for insecure contexts (file://, http on a LAN address).
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  };
  return { copied, copy };
}

export interface CopyButtonProps {
  text: string;
  label?: string;
  className?: string;
  /** Show the text label next to the icon. */
  showLabel?: boolean;
}

export function CopyButton({ text, label, className, showLabel }: CopyButtonProps) {
  const t = useT();
  const { copied, copy } = useCopy();
  const name = label ?? t.common.copy;
  const Icon = copied ? CheckIcon : CopyIcon;
  return (
    <button
      type="button"
      onClick={() => void copy(text)}
      aria-label={showLabel ? undefined : copied ? t.common.copied : name}
      title={copied ? t.common.copied : name}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-xs font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text",
        copied && "text-success hover:text-success",
        className,
      )}
    >
      <Icon size={14} strokeWidth={1.75} aria-hidden />
      {showLabel && <span>{copied ? t.common.copied : name}</span>}
      <span className="sr-only" aria-live="polite">
        {copied ? t.common.copied_sr : ""}
      </span>
    </button>
  );
}

const SQL_KEYWORDS = /\b(SELECT|FROM|WHERE|AND|OR|GROUP BY|ORDER BY|AS|SUM|CAST|DATE_TRUNC|DATE|BETWEEN|IN|NULLIF|DESC|ASC|LIMIT|SAFE_DIVIDE)\b/g;

/** A small SQL tinter (08-art.md §4 #19): keywords, strings, comments; everything else in ink. */
function tintSql(code: string) {
  return code.split("\n").map((line, i) => {
    const parts: ReactNode[] = [];
    if (line.trimStart().startsWith("--")) parts.push(<span key="c" className="text-code-comment">{line}</span>);
    else {
      const tokens = line.split(/('[^']*')/);
      tokens.forEach((tok, j) => {
        if (tok.startsWith("'")) parts.push(<span key={j} className="text-code-string">{tok}</span>);
        else {
          let last = 0;
          for (const m of tok.matchAll(SQL_KEYWORDS)) {
            if (m.index! > last) parts.push(tok.slice(last, m.index));
            parts.push(<span key={`${j}-${m.index}`} className="text-code-keyword">{m[0]}</span>);
            last = m.index! + m[0].length;
          }
          parts.push(tok.slice(last));
        }
      });
    }
    return (
      <span key={i}>
        {parts}
        {"\n"}
      </span>
    );
  });
}

export interface CodeBlockProps {
  code: string;
  /** Small label in the header ("sql", "json"). */
  language?: string;
  title?: string;
  /** Max height before scrolling (px). */
  maxHeight?: number;
  /** Soft-wrap long lines instead of scrolling sideways. */
  wrap?: boolean;
  /** Leave out the header's copy button when the page has its own (Chat apps: "Copy config"). */
  copy?: boolean;
  className?: string;
}

export function CodeBlock({ code, language, title, maxHeight = 420, wrap, copy = true, className }: CodeBlockProps) {
  const t = useT();
  return (
    <div className={cn("group relative min-w-0 overflow-hidden rounded-lg border border-border bg-well", className)}>
      {(title || language) && (
        <div className="flex h-9 items-center justify-between gap-2 border-b border-border pr-1.5 pl-3">
          <span className="truncate text-xs font-medium text-text-muted">{title ?? language}</span>
          <div className="flex items-center gap-2">
            {title && language && <span className="font-mono text-2xs text-text-subtle">{language}</span>}
            {copy && <CopyButton text={code} label={t.common.copy_code} showLabel />}
          </div>
        </div>
      )}
      <pre tabIndex={0} aria-label={title ?? language} className={cn("overflow-auto p-3 font-mono text-[12.5px] leading-5 text-text outline-offset-[-2px]", wrap ? "break-words whitespace-pre-wrap" : "whitespace-pre")} style={{ maxHeight }}>
        <code>{language === "sql" ? tintSql(code) : code}</code>
      </pre>
      {copy && !title && !language && (
        <CopyButton text={code} label={t.common.copy_code} className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" />
      )}
    </div>
  );
}
