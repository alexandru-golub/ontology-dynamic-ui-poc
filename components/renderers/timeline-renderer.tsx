"use client";

import { Badge } from "@/components/ui/badge";
import { formatCell, sortedColumns, type RendererProps } from "./types";

export function TimelineRenderer({ title, columns, rows }: RendererProps) {
  const cols = sortedColumns(columns);
  const primary = cols[0]?.field;
  return (
    <div className="mx-auto max-w-3xl p-6">
      <ol className="relative space-y-6 border-l border-border pl-6">
        {rows.map((row, index) => (
          <li key={row.id} className="relative">
            <span className="absolute -left-[31px] top-1 h-3 w-3 rounded-full bg-primary ring-4 ring-background" />
            <div className="rounded-lg border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{formatCell(primary ? row.values[primary] : null)}</h3>
                <Badge variant="outline" className="font-mono text-[10px]">
                  #{index + 1}
                </Badge>
              </div>
              <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                {cols.slice(1).map((column) => (
                  <div key={column.field} className="flex items-baseline justify-between gap-2">
                    <dt className="text-muted-foreground">{column.label}</dt>
                    <dd className="truncate">{formatCell(row.values[column.field])}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </li>
        ))}
      </ol>
      {rows.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No {title} entries.</p>}
    </div>
  );
}
