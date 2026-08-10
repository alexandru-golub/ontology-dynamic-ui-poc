"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { formatCell, sortedColumns, type RendererProps } from "./types";

export function CardsRenderer({ title, columns, rows, selectedIds, onSelectionChange }: RendererProps) {
  const cols = sortedColumns(columns);
  const primary = cols[0]?.field;
  return (
    <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row) => (
        <div key={row.id} className="relative rounded-lg border bg-card p-4 shadow-sm transition-colors hover:border-primary/40">
          {onSelectionChange && (
            <Checkbox
              checked={selectedIds.has(row.id)}
              onCheckedChange={(checked) => {
                const next = new Set(selectedIds);
                if (checked) next.add(row.id);
                else next.delete(row.id);
                onSelectionChange(next);
              }}
              className="absolute right-3 top-3"
              aria-label={`Select ${String(row.values[primary ?? "id"] ?? row.id)}`}
            />
          )}
          <div className="mb-2 pr-6 text-sm font-semibold leading-snug">{formatCell(primary ? row.values[primary] : null)}</div>
          <dl className="space-y-1">
            {cols.slice(1).map((column) => (
              <div key={column.field} className="flex items-baseline justify-between gap-2 text-xs">
                <dt className="shrink-0 text-muted-foreground">{column.label}</dt>
                <dd className="truncate text-right">{formatCell(row.values[column.field])}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
      {rows.length === 0 && <p className="col-span-full py-10 text-center text-sm text-muted-foreground">No {title} rows.</p>}
    </div>
  );
}
