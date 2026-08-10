"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SuggestInput } from "@/components/suggest-input";
import { cn } from "@/lib/utils";
import { formatCell, sortedColumns, type RendererProps } from "./types";

export function FormRenderer({
  rootLabel,
  columns,
  rows,
  suggestions,
  canUpdate,
  canCreate,
  onUpdateRow,
  onCreateRow,
}: RendererProps) {
  const cols = sortedColumns(columns);
  const primary = cols[0]?.field;
  const [selectedId, setSelectedId] = useState<string | null>(rows[0]?.id ?? null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);

  const openRow = (id: string) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    setSelectedId(id);
    setCreating(false);
    const initial: Record<string, string> = {};
    for (const column of cols) initial[column.field] = String(row.values[column.field] ?? "");
    setDraft(initial);
  };

  const startNew = () => {
    setCreating(true);
    setSelectedId(null);
    const initial: Record<string, string> = {};
    for (const column of cols) initial[column.field] = "";
    setDraft(initial);
  };

  const save = async () => {
    setBusy(true);
    try {
      const values: Record<string, unknown> = {};
      for (const column of cols) values[column.field] = draft[column.field] ?? "";
      if (creating) {
        await onCreateRow?.(values);
        setCreating(false);
      } else if (selected) {
        await onUpdateRow?.(selected.id, values);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid h-full grid-cols-[240px_1fr]">
      <div className="overflow-y-auto border-r p-2">
        {canCreate && (
          <Button size="sm" variant="outline" className="mb-2 w-full" onClick={startNew}>
            + New {rootLabel}
          </Button>
        )}
        <div className="space-y-1">
          {rows.map((row) => (
            <button
              key={row.id}
              onClick={() => openRow(row.id)}
              className={cn(
                "block w-full rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted",
                selectedId === row.id ? "border-primary bg-muted" : "border-border",
              )}
            >
              <span className="block truncate font-medium">{formatCell(primary ? row.values[primary] : null)}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {cols.slice(1, 3).map((c) => formatCell(row.values[c.field])).join(" · ")}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-y-auto p-4">
        {creating ? (
          <h3 className="mb-3 text-sm font-semibold">New {rootLabel}</h3>
        ) : selected ? (
          <h3 className="mb-3 text-sm font-semibold">{formatCell(primary ? selected.values[primary] : null)}</h3>
        ) : (
          <p className="text-sm text-muted-foreground">Select a {rootLabel} to edit.</p>
        )}
        {(creating || selected) && (
          <div className="max-w-md space-y-3">
            {cols.map((column) => (
              <div key={column.field} className="grid gap-1.5">
                <Label>
                  {column.label}
                  <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                    {column.source ?? column.field}
                  </span>
                </Label>
                {suggestions[column.field] ? (
                  <SuggestInput
                    value={draft[column.field] ?? ""}
                    onChange={(v) => setDraft((p) => ({ ...p, [column.field]: v }))}
                    onCommit={() => undefined}
                    suggestions={suggestions[column.field]}
                  />
                ) : (
                  <Input
                    value={draft[column.field] ?? ""}
                    onChange={(e) => setDraft((p) => ({ ...p, [column.field]: e.target.value }))}
                  />
                )}
              </div>
            ))}
            {(canUpdate || (creating && canCreate)) && (
              <div className="flex justify-end">
                <Button onClick={() => void save()} disabled={busy}>
                  {busy ? "Saving…" : creating ? "Create" : "Save"}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
