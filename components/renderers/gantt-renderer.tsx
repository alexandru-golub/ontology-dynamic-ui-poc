"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { formatCell, sortedColumns, type RendererProps } from "./types";

const DAY = 86_400_000;
const fmt = (ts: number) =>
  new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/**
 * Gantt renderer — positional config on the surface's columns:
 *   col[0] = task name, col[1] = start date, col[2] = end date.
 * Bars span the min..max date range of the loaded rows; rows without
 * parseable dates are listed without a bar.
 */
export function GanttRenderer({ title, columns, rows }: RendererProps) {
  const cols = sortedColumns(columns);
  const nameField = cols[0]?.field;
  const startField = cols[1]?.field;
  const endField = cols[2]?.field;
  const ownerField = cols[3]?.field;

  const { min, max, spans, undated } = useMemo(() => {
    const parsed: Array<{ row: (typeof rows)[number]; s: number; e: number }> = [];
    const undated: typeof rows = [];
    for (const row of rows) {
      const s = Date.parse(String(row.values[startField ?? ""] ?? ""));
      const e = Date.parse(String(row.values[endField ?? ""] ?? ""));
      if (Number.isNaN(s) || Number.isNaN(e)) undated.push(row);
      else parsed.push({ row, s, e });
    }
    if (parsed.length === 0) return { min: 0, max: 0, spans: [], undated };
    const lo = Math.min(...parsed.map((p) => p.s));
    const hi = Math.max(...parsed.map((p) => p.e));
    const range = Math.max(hi - lo, DAY);
    const spans = parsed.map((p) => ({
      row: p.row,
      left: ((p.s - lo) / range) * 100,
      width: Math.max(((p.e - p.s) / range) * 100, 1.2),
    }));
    return { min: lo, max: hi, spans, undated };
  }, [rows, startField, endField]);

  const noDates = rows.length > 0 && spans.length === 0;

  return (
    <div className="h-full overflow-auto p-4">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-semibold">{title} · schedule</h3>
        {spans.length > 0 && (
          <Badge variant="outline" className="font-mono text-[10px]">
            {fmt(min)} → {fmt(max)}
          </Badge>
        )}
      </div>
      {spans.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {noDates
            ? "Rows are missing parseable start/end dates (columns 2 and 3 should be date-typed)."
            : `No ${title} rows.`}
        </p>
      )}
      {undated.length > 0 && (
        <div className="mb-3 space-y-1 rounded border border-dashed p-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Missing dates ({undated.length})
          </p>
          {undated.map((row) => (
            <p key={row.id} className="text-xs text-muted-foreground">
              {formatCell(nameField ? row.values[nameField] : null)}
            </p>
          ))}
        </div>
      )}
      <div className="space-y-1.5">
        {spans.map(({ row, left, width }) => (
          <div key={row.id} className="grid grid-cols-[220px_1fr] items-center gap-3">
            <div className="truncate text-sm">
              <span className="font-medium">{formatCell(nameField ? row.values[nameField] : null)}</span>
              {ownerField && (
                <span className="ml-2 text-[10px] text-muted-foreground">{formatCell(row.values[ownerField])}</span>
              )}
              <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                {String(row.values[startField ?? ""] ?? "")} → {String(row.values[endField ?? ""] ?? "")}
              </span>
            </div>
            <div className="relative h-7 rounded bg-muted/40">
              <div
                className="absolute top-1 h-5 rounded bg-primary/80"
                style={{ left: `${left}%`, width: `${width}%` }}
                title={`${formatCell(nameField ? row.values[nameField] : null)}: ${String(row.values[startField ?? ""] ?? "")} → ${String(row.values[endField ?? ""] ?? "")}`}
              />
            </div>
          </div>
        ))}
      </div>    </div>
  );
}
