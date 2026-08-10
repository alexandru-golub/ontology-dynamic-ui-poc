"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { formatCell, sortedColumns, type RendererProps } from "./types";

export function BoardRenderer({ title, columns, rows }: RendererProps) {
  const cols = sortedColumns(columns);
  const primary = cols[0]?.field;
  // Group by the status-like column if present, else the first column that is
  // not unique per row (a natural grouping key), else the first column.
  const groupField =
    cols.find((c) => c.field === "status")?.field ??
    cols.find((c) => new Set(rows.map((r) => String(r.values[c.field] ?? ""))).size < rows.length)?.field ??
    cols[0]?.field;

  const groups = useMemo(() => {
    const map = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = String(row.values[groupField ?? ""] ?? "Unassigned");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows, groupField]);

  return (
    <div className="flex h-full gap-3 overflow-x-auto p-4">
      {groups.map(([group, groupRows]) => (
        <div key={group} className="flex min-w-56 max-w-72 flex-1 flex-col rounded-lg border bg-muted/30">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-semibold">{group}</span>
            <Badge variant="secondary">{groupRows.length}</Badge>
          </div>
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
            {groupRows.map((row) => (
              <div key={row.id} className="rounded-md border bg-card p-3 text-sm shadow-sm">
                <div className="mb-1 font-semibold">{formatCell(primary ? row.values[primary] : null)}</div>
                {cols
                  .filter((c) => c.field !== groupField && c.field !== primary)
                  .slice(0, 3)
                  .map((column) => (
                    <div key={column.field} className="text-xs text-muted-foreground">
                      <span className="mr-1">{column.label}:</span>
                      {formatCell(row.values[column.field])}
                    </div>
                  ))}
              </div>
            ))}
            {groupRows.length === 0 && <p className="px-2 py-4 text-center text-xs text-muted-foreground">Empty</p>}
          </div>
        </div>
      ))}
      {groups.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No {title} rows.</p>}
    </div>
  );
}
