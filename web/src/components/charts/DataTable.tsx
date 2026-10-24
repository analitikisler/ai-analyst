// The table every chart can show itself as ("Show as a table"), and the table chart type. Scrolls inside its own
// focusable box, so the page never scrolls sideways.
import type { ReactNode } from "react";
import { cn } from "cn";

export interface Column<T> {
  key: string;
  label: ReactNode;
  num?: boolean;
  render: (row: T) => ReactNode;
}

export function DataTable<T>({ rows, columns, label, className, dense, maxHeight }: { rows: T[]; columns: Column<T>[]; label: string; className?: string; dense?: boolean; maxHeight?: number }) {
  return (
    <div tabIndex={0} role="region" aria-label={label} className={cn("min-w-0 overflow-auto rounded-md outline-offset-[-2px]", className)} style={{ maxHeight }}>
      <table className="w-full border-collapse text-[13px] leading-[18px]">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-border-strong">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn("h-9 px-2 text-2xs font-medium whitespace-nowrap text-text-muted first:pl-0 last:pr-0", c.num ? "text-right" : "text-left")}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border last:border-0">
              {columns.map((c) => (
                <td key={c.key} className={cn("px-2 whitespace-nowrap first:pl-0 last:pr-0", dense ? "h-8" : "h-10", c.num ? "text-right font-mono tnum" : "text-text")}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
