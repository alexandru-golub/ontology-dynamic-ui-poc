"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TypedInput } from "@/components/typed-input";
import { cn } from "@/lib/utils";

export type ColumnType = "string" | "number" | "boolean" | "date" | "money";
export type TableColumn = {
  id?: string;
  field: string;
  label: string;
  order: number;
  source?: string | null;
  suggest?: boolean;
  suggestSource?: string | null;
  type?: ColumnType;
};
export type TableRowData = { id: string; values: Record<string, unknown> };

export type SortState = { field: string; dir: "asc" | "desc" } | null;

function formatValue(value: unknown): React.ReactNode {
  if (value === null || value === undefined || value === "") return <span className="text-muted-foreground/60">—</span>;
  if (typeof value === "boolean") {
    return value ? <Badge variant="success">yes</Badge> : <Badge variant="secondary">no</Badge>;
  }
  if (typeof value === "number") return value.toLocaleString();
  return String(value);
}

/**
 * Presentational table. Rows arrive already filtered/sorted server-side
 * (`surfaceRows` applies search/filters/orderBy); the header only reports
 * sort changes via `onSortChange` so the connection can re-query.
 */
export function DataTable({
  columns,
  rows,
  editable = false,
  selectable = false,
  selectedIds = new Set<string>(),
  onSelectionChange,
  onUpdate,
  sort = null,
  onSortChange,
  suggestions,
  emptyMessage = "No rows.",
  hasNextPage = false,
  totalCount,
  onLoadMore,
}: {
  columns: TableColumn[];
  rows: TableRowData[];
  editable?: boolean;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  onUpdate?: (id: string, values: Record<string, unknown>) => Promise<void> | void;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  suggestions?: Record<string, string[]>;
  emptyMessage?: string;
  hasNextPage?: boolean;
  totalCount?: number;
  onLoadMore?: () => void;
}) {
  const [editCell, setEditCell] = useState<{ rowId: string; field: string } | null>(null);
  const [draft, setDraft] = useState("");

  const sortedColumns = useMemo(() => [...columns].sort((a, b) => a.order - b.order), [columns]);

  const cycleSort = (field: string) => {
    if (!onSortChange) return;
    onSortChange(
      sort?.field === field ? (sort.dir === "asc" ? { field, dir: "desc" } : null) : { field, dir: "asc" },
    );
  };

  const allSelected = rows.length > 0 && rows.every((row) => selectedIds.has(row.id));

  const toggleAll = (checked: boolean) => {
    const next = new Set(selectedIds);
    for (const row of rows) {
      if (checked) next.add(row.id);
      else next.delete(row.id);
    }
    onSelectionChange?.(next);
  };

  const toggleRow = (id: string, checked: boolean) => {
    const next = new Set(selectedIds);
    if (checked) next.add(id);
    else next.delete(id);
    onSelectionChange?.(next);
  };

  const beginEdit = (row: TableRowData, field: string) => {
    if (!editable) return;
    setEditCell({ rowId: row.id, field });
    setDraft(String(row.values[field] ?? ""));
  };

  const commitEdit = async (finalValue?: string) => {
    if (!editCell) return;
    const cell = editCell;
    const next = finalValue ?? draft;
    setEditCell(null);
    await onUpdate?.(cell.rowId, { [cell.field]: next });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto p-2">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {selectable && (
                <TableHead className="w-10">
                  <Checkbox checked={allSelected} onCheckedChange={(checked) => toggleAll(Boolean(checked))} aria-label="Select all rows" />
                </TableHead>
              )}
              {sortedColumns.map((column) => (
                <TableHead
                  key={column.field}
                  className={cn("cursor-pointer select-none", onSortChange && "hover:text-foreground", sort?.field === column.field && "text-foreground")}
                  onClick={() => cycleSort(column.field)}
                >
                  <span className="inline-flex items-center gap-1">
                    {column.label}
                    {sort?.field === column.field ? (
                      sort.dir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
                    ) : (
                      <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                    )}
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={sortedColumns.length + (selectable ? 1 : 0)} className="h-24 text-center text-muted-foreground">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
            {rows.map((row) => (
              <TableRow key={row.id} data-selected={selectedIds.has(row.id) ? "true" : undefined}>
                {selectable && (
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.has(row.id)}
                      onCheckedChange={(checked) => toggleRow(row.id, Boolean(checked))}
                      aria-label={`Select row ${row.id}`}
                    />
                  </TableCell>
                )}
                {sortedColumns.map((column) => {
                  const editing = editCell?.rowId === row.id && editCell.field === column.field;
                  const value = row.values[column.field];
                  const suggestionsFor = suggestions?.[column.field];
                  return (
                    <TableCell
                      key={column.field}
                      className={cn(editable && "cursor-text")}
                      onDoubleClick={() => beginEdit(row, column.field)}
                    >
                      {editing ? (
                        <TypedInput
                          autoFocus
                          type={column.type}
                          value={draft}
                          onChange={setDraft}
                          onCommit={(v) => void commitEdit(v)}
                          onCancel={() => setEditCell(null)}
                          suggestions={suggestionsFor}
                          className="h-8"
                        />
                      ) : (
                        formatValue(value)
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
        <span>
          {rows.length} of {totalCount ?? rows.length} row{(totalCount ?? rows.length) === 1 ? "" : "s"}
        </span>
        {hasNextPage && (
          <Button size="sm" variant="outline" onClick={onLoadMore}>
            Load more
          </Button>
        )}
      </div>
    </div>
  );
}
