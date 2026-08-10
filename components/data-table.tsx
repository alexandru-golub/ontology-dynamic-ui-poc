"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SuggestInput } from "@/components/suggest-input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type TableColumn = { id?: string; field: string; label: string; order: number; source?: string | null; suggest?: boolean; suggestSource?: string | null };
export type TableRowData = { id: string; values: Record<string, unknown> };

type SortState = { field: string; dir: "asc" | "desc" } | null;

function formatValue(value: unknown): React.ReactNode {
  if (value === null || value === undefined || value === "") return <span className="text-muted-foreground/60">—</span>;
  if (typeof value === "boolean") {
    return value ? <Badge variant="success">yes</Badge> : <Badge variant="secondary">no</Badge>;
  }
  if (typeof value === "number") return value.toLocaleString();
  return String(value);
}

export function DataTable({
  columns,
  rows,
  editable = false,
  selectable = false,
  selectedIds = new Set<string>(),
  onSelectionChange,
  onUpdate,
  searchable = true,
  suggestions,
  emptyMessage = "No rows.",
}: {
  columns: TableColumn[];
  rows: TableRowData[];
  editable?: boolean;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  onUpdate?: (id: string, values: Record<string, unknown>) => Promise<void> | void;
  searchable?: boolean;
  suggestions?: Record<string, string[]>;
  emptyMessage?: string;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState>(null);
  const [editCell, setEditCell] = useState<{ rowId: string; field: string } | null>(null);
  const [draft, setDraft] = useState("");

  const sortedColumns = useMemo(() => [...columns].sort((a, b) => a.order - b.order), [columns]);

  const filteredRows = useMemo(() => {
    let result = rows;
    const q = query.trim().toLowerCase();
    if (q) {
      result = result.filter((row) =>
        sortedColumns.some((column) => String(row.values[column.field] ?? "").toLowerCase().includes(q)),
      );
    }
    if (sort) {
      result = [...result].sort((a, b) => {
        const av = a.values[sort.field];
        const bv = b.values[sort.field];
        if (av === bv) return 0;
        const cmp = av === null || av === undefined ? -1 : bv === null || bv === undefined ? 1 : av < bv ? -1 : 1;
        return sort.dir === "asc" ? cmp : -cmp;
      });
    }
    return result;
  }, [rows, query, sort, sortedColumns]);

  const allSelected = filteredRows.length > 0 && filteredRows.every((row) => selectedIds.has(row.id));

  const toggleAll = (checked: boolean) => {
    const next = new Set(selectedIds);
    for (const row of filteredRows) {
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
      {searchable && (
        <div className="relative m-2 mb-0 w-full max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Filter rows…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      )}
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
                  className={cn("cursor-pointer select-none", sort?.field === column.field && "text-foreground")}
                  onClick={() =>
                    setSort((prev) =>
                      prev?.field === column.field
                        ? prev.dir === "asc"
                          ? { field: column.field, dir: "desc" }
                          : null
                        : { field: column.field, dir: "asc" },
                    )
                  }
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
            {filteredRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={sortedColumns.length + (selectable ? 1 : 0)} className="h-24 text-center text-muted-foreground">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
            {filteredRows.map((row) => (
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
                        suggestionsFor && suggestionsFor.length > 0 ? (
                          <SuggestInput
                            autoFocus
                            value={draft}
                            onChange={setDraft}
                            onCommit={(v) => void commitEdit(v)}
                            onCancel={() => setEditCell(null)}
                            suggestions={suggestionsFor}
                            className="h-8"
                          />
                        ) : (
                          <Input
                            autoFocus
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") void commitEdit();
                              if (event.key === "Escape") setEditCell(null);
                            }}
                            onBlur={() => void commitEdit()}
                            className="h-8"
                          />
                        )
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
      <div className="border-t px-3 py-2 text-xs text-muted-foreground">
        {filteredRows.length} of {rows.length} row{rows.length === 1 ? "" : "s"}
      </div>
    </div>
  );
}
