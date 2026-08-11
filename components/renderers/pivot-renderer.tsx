"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCell, sortedColumns, type RendererProps } from "./types";

/**
 * Pivot renderer — positional config on the surface's columns:
 *   col[0] = row dimension, col[1] = column dimension, col[2] = value.
 * Cells aggregate the value column over each (row × column) group:
 * `.count` sources (or non-numeric values) count rows, numeric values sum.
 * Pure frontend: rows are the same paged connection every renderer uses.
 */
export function PivotRenderer({ title, columns, rows }: RendererProps) {
  const cols = sortedColumns(columns);
  const rowDim = cols[0]?.field;
  const colDim = cols[1]?.field;
  const valueField = cols[2]?.field;
  const valueColumn = cols[2];

  const isCount = /\.count$/.test((valueColumn?.source ?? "").trim());
  const sums = !isCount && valueColumn?.type !== undefined && ["number", "money"].includes(valueColumn.type);

  const { rowKeys, colKeys, cellOf, rowTotal, colTotal, grandTotal } = useMemo(() => {
    const rk = [...new Set(rows.map((r) => String(r.values[rowDim ?? ""] ?? "")))].sort((a, b) => a.localeCompare(b));
    const ck = [...new Set(rows.map((r) => String(r.values[colDim ?? ""] ?? "")))].sort((a, b) => a.localeCompare(b));
    const cells = new Map<string, number>();
    const rowTotal = new Map<string, number>();
    const colTotal = new Map<string, number>();
    let grand = 0;
    const bump = (map: Map<string, number>, key: string, amount: number) => map.set(key, (map.get(key) ?? 0) + amount);
    for (const row of rows) {
      const a = String(row.values[rowDim ?? ""] ?? "");
      const b = String(row.values[colDim ?? ""] ?? "");
      const raw = row.values[valueField ?? ""];
      const amount = sums ? (typeof raw === "number" ? raw : Number(raw) || 0) : 1;
      bump(cells, `${a}\u0000${b}`, amount);
      bump(rowTotal, a, amount);
      bump(colTotal, b, amount);
      grand += amount;
    }
    const cellOf = (a: string, b: string) => cells.get(`${a}\u0000${b}`) ?? 0;
    return { rowKeys: rk, colKeys: ck, cellOf, rowTotal, colTotal, grandTotal: grand };
  }, [rows, rowDim, colDim, valueField, sums]);

  const summary = sums ? `sum of ${valueColumn?.label ?? valueField ?? "value"}` : isCount ? "count" : "row count";

  if (!rowDim || !colDim) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Pivot needs 3 columns: row dim, column dim, value.</p>;
  }

  return (
    <div className="h-full overflow-auto p-4">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-semibold">{title} · pivot</h3>
        <Badge variant="outline" className="font-mono text-[10px]">
          rows: {cols[0]?.label} · cols: {cols[1]?.label} · {summary}
        </Badge>
      </div>
      <Table className="min-w-max">
        <TableHeader>
          <TableRow>
            <TableHead>{cols[0]?.label}</TableHead>
            {colKeys.map((key) => (
              <TableHead key={key} className="text-right">{formatCell(key)}</TableHead>
            ))}
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rowKeys.map((a) => (
            <TableRow key={a}>
              <TableCell className="font-medium">{formatCell(a)}</TableCell>
              {colKeys.map((b) => (
                <TableCell key={b} className="text-right tabular-nums">{cellOf(a, b).toLocaleString()}</TableCell>
              ))}
              <TableCell className="text-right font-semibold tabular-nums">{rowTotal.get(a)?.toLocaleString()}</TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell className="font-semibold">Total</TableCell>
            {colKeys.map((b) => (
              <TableCell key={b} className="text-right font-semibold tabular-nums">{colTotal.get(b)?.toLocaleString()}</TableCell>
            ))}
            <TableCell className="text-right font-semibold tabular-nums">{grandTotal.toLocaleString()}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
