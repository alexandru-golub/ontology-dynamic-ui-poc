"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatCell, sortedColumns, type RendererProps } from "./types";

const UNASSIGNED = "Unassigned";

function groupKey(value: unknown): string {
  const text = String(value ?? "");
  return text === "" ? UNASSIGNED : text;
}

/**
 * A lane value can only be written when the grouping column points at a
 * neighbor (e.g. >HAS_STATUS:Status.name), not at a self property or a count —
 * those have no "move between lanes" meaning and would write display strings
 * (e.g. "true"/"false") into typed properties.
 */
function isWritableGroup(source: string | null | undefined): boolean {
  const src = (source ?? "").trim();
  if (!src || src.startsWith("self.") || /\.count$/.test(src)) return false;
  return true; // Label.prop | >Rel:Label.prop | <Rel:Label.prop
}

/**
 * Kanban board grouped by a status-like column. Cards are draggable between
 * lanes when the user has `update` permission: dropping a card calls
 * `onUpdateRow(rowId, { [groupField]: targetGroup })` — the same generic row
 * write the table uses. Dropping on "Unassigned" clears the grouping value.
 */
export function BoardRenderer({ title, columns, rows, canUpdate, onUpdateRow }: RendererProps) {
  const cols = sortedColumns(columns);
  const primary = cols[0]?.field;
  // Group by the status-like column if present, else the first column that is
  // not unique per row (a natural grouping key), else the first column.
  const groupField =
    cols.find((c) => c.field === "status")?.field ??
    cols.find((c) => new Set(rows.map((r) => String(r.values[c.field] ?? ""))).size < rows.length)?.field ??
    cols[0]?.field;

  const groupColumn = cols.find((c) => c.field === groupField);
  const draggable = Boolean(canUpdate && onUpdateRow && groupField && isWritableGroup(groupColumn?.source));

  const groups = useMemo(() => {
    const map = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = groupKey(row.values[groupField ?? ""]);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    // Always offer an Unassigned lane when cards can be dragged, so users can
    // un-group a card; it sorts last.
    if (draggable && !map.has(UNASSIGNED)) map.set(UNASSIGNED, []);
    return [...map.entries()].sort((a, b) =>
      a[0] === UNASSIGNED ? 1 : b[0] === UNASSIGNED ? -1 : a[0].localeCompare(b[0]),
    );
  }, [rows, groupField, draggable]);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overGroup, setOverGroup] = useState<string | null>(null);

  const handleDrop = (group: string) => {
    const id = draggingId;
    setDraggingId(null);
    setOverGroup(null);
    if (!id || !groupField || !onUpdateRow) return;
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const current = groupKey(row.values[groupField]);
    if (current === group) return; // dropped in its own lane — no-op
    // Empty string detaches the grouping neighbor (e.g. Status) server-side.
    void onUpdateRow(id, { [groupField]: group === UNASSIGNED ? "" : group });
  };

  return (
    <div className="relative flex h-full gap-3 overflow-x-auto p-4">
      {groups.map(([group, groupRows]) => (
        <div
          key={group}
          onDragOver={(event) => {
            if (!draggable) return;
            event.preventDefault(); // allow the drop
            event.dataTransfer.dropEffect = "move";
            setOverGroup(group);
          }}
          onDragLeave={(event) => {
            // Ignore transitions between children inside the same lane.
            if (overGroup === group && !event.currentTarget.contains(event.relatedTarget as Node)) {
              setOverGroup(null);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            handleDrop(group);
          }}
          className={cn(
            "flex min-w-56 max-w-72 flex-1 flex-col rounded-lg border bg-muted/30 transition-colors",
            draggable && "border-dashed",
            draggable && overGroup === group && "border-primary bg-muted ring-2 ring-primary/30",
          )}
        >
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <span className="text-sm font-semibold">{group}</span>
            {draggable && overGroup === group && draggingId ? (
              <Badge variant="secondary" className="animate-pulse">Drop here</Badge>
            ) : (
              <Badge variant="secondary">{groupRows.length}</Badge>
            )}
          </div>
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
            {groupRows.map((row) => (
              <div
                key={row.id}
                draggable={draggable}
                onDragStart={(event) => {
                  setDraggingId(row.id);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", row.id);
                }}
                onDragEnd={() => {
                  setDraggingId(null);
                  setOverGroup(null);
                }}
                className={cn(
                  "rounded-md border bg-card p-3 text-sm shadow-sm",
                  draggable && "cursor-grab active:cursor-grabbing",
                  draggingId === row.id && "opacity-40",
                )}
              >
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
            {groupRows.length === 0 && (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">Empty</p>
            )}
          </div>
        </div>
      ))}
      {groups.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No {title} rows.</p>}
      {draggable && (
        <p className="pointer-events-none absolute bottom-1 right-3 text-[10px] text-muted-foreground/70">
          Drag cards between lanes to update their {groupField}
        </p>
      )}
    </div>
  );
}
