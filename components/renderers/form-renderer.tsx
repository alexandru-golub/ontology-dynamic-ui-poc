"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { TypedInput } from "@/components/typed-input";
import { cn } from "@/lib/utils";
import { validateField, validateValues } from "@/lib/validate";
import { formatCell, sortedColumns, type RendererProps } from "./types";

/**
 * Form renderer v2 — record list + editor, with two upgrades over v1:
 *
 *  1. Multi-record editing: check several records to open a bulk editor that
 *     applies the *changed* fields to every selected record in one go.
 *  2. Per-field validation: every column's validation rules (graph data —
 *     required/min/max/minLength/maxLength/pattern/options) are checked
 *     client-side with inline errors before anything is submitted; the server
 *     re-validates on every write regardless.
 */
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  // bulk-edit state: which fields are included + their values
  const [bulkIncluded, setBulkIncluded] = useState<Record<string, boolean>>({});
  const [bulkDraft, setBulkDraft] = useState<Record<string, string>>({});
  const [bulkErrors, setBulkErrors] = useState<Record<string, string>>({});
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);
  const selectable = Boolean(canUpdate);
  const bulkRows = useMemo(() => rows.filter((r) => selectedIds.has(r.id)), [rows, selectedIds]);
  const bulkMode = selectable && !creating && bulkRows.length > 1;
  const anchorRow = bulkRows[0];

  const columnByField = useMemo(() => {
    const map: Record<string, (typeof cols)[number]> = {};
    for (const column of cols) map[column.field] = column;
    return map;
  }, [cols]);

  const openRow = (id: string) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    setSelectedId(id);
    setSelectedIds(new Set());
    setCreating(false);
    setErrors({});
    setBulkNotice(null);
    const initial: Record<string, string> = {};
    for (const column of cols) initial[column.field] = String(row.values[column.field] ?? "");
    setDraft(initial);
  };

  const startNew = () => {
    setCreating(true);
    setSelectedId(null);
    setSelectedIds(new Set());
    setErrors({});
    setBulkNotice(null);
    const initial: Record<string, string> = {};
    for (const column of cols) initial[column.field] = "";
    setDraft(initial);
  };

  const toggleSelected = (id: string, checked: boolean) => {
    setBulkNotice(null);
    const next = new Set(selectedIds);
    if (checked) next.add(id);
    else next.delete(id);
    setSelectedIds(next);
    if (next.size === 1) {
      const only = rows.find((r) => next.has(r.id));
      if (only) {
        setSelectedId(only.id);
        setCreating(false);
        setErrors({});
        const initial: Record<string, string> = {};
        for (const column of cols) initial[column.field] = String(only.values[column.field] ?? "");
        setDraft(initial);
      }
    } else {
      setSelectedId(null);
      // seed bulk drafts from the anchor row when entering bulk mode
      const anchor = next.size > 0 ? rows.find((r) => next.has(r.id)) : undefined;
      if (anchor) {
        const initial: Record<string, string> = {};
        const included: Record<string, boolean> = {};
        for (const column of cols) {
          initial[column.field] = String(anchor.values[column.field] ?? "");
          included[column.field] = false;
        }
        setBulkDraft(initial);
        setBulkIncluded(included);
        setBulkErrors({});
      }
    }
  };

  const changeDraft = (field: string, value: string) => {
    setDraft((p) => ({ ...p, [field]: value }));
    // re-validate the touched field for instant feedback after first attempt
    setErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      const error = validateField(columnByField[field], value);
      if (error) next[field] = error;
      else delete next[field];
      return next;
    });
  };

  const changeBulk = (field: string, value: string) => {
    setBulkDraft((p) => ({ ...p, [field]: value }));
    setBulkErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      const error = validateField(columnByField[field], value);
      if (error) next[field] = error;
      else delete next[field];
      return next;
    });
  };

  const toggleBulkField = (field: string, included: boolean) => {
    setBulkIncluded((p) => ({ ...p, [field]: included }));
    setBulkErrors((prev) => {
      if (!included) {
        const next = { ...prev };
        delete next[field];
        return next;
      }
      return prev;
    });
  };

  const save = async () => {
    setBusy(true);
    try {
      const values: Record<string, unknown> = {};
      for (const column of cols) values[column.field] = draft[column.field] ?? "";
      const found = validateValues(cols, values);
      if (Object.keys(found).length > 0) {
        setErrors(found);
        return; // never submit an invalid form; the server would reject anyway
      }
      if (creating) {
        await onCreateRow?.(values);
        setCreating(false);
        setErrors({});
      } else if (selected) {
        await onUpdateRow?.(selected.id, values);
        setErrors({});
      }
    } finally {
      setBusy(false);
    }
  };

  const applyBulk = async () => {
    if (!onUpdateRow || bulkRows.length === 0) return;
    setBusy(true);
    try {
      const changed: Record<string, unknown> = {};
      const found: Record<string, string> = {};
      for (const column of cols) {
        if (!bulkIncluded[column.field]) continue;
        const value = bulkDraft[column.field] ?? "";
        changed[column.field] = value;
        const error = validateField(column, value);
        if (error) found[column.field] = error;
      }
      if (Object.keys(found).length > 0) {
        setBulkErrors(found);
        return;
      }
      if (Object.keys(changed).length === 0) {
        setBulkNotice("Tick a field to include it in the bulk update.");
        return;
      }
      await Promise.all(bulkRows.map((row) => onUpdateRow(row.id, changed)));
      setBulkNotice(
        `Updated ${bulkRows.length} records (${Object.keys(changed)
          .map((field) => columnByField[field]?.label ?? field)
          .join(", ")}).`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid h-full grid-cols-[240px_1fr]">
      {/* ---------------- record list ---------------- */}
      <div className="flex flex-col overflow-y-auto border-r p-2">
        {canCreate && (
          <Button size="sm" variant="outline" className="mb-2 w-full" onClick={startNew}>
            + New {rootLabel}
          </Button>
        )}
        {selectable && selectedIds.size > 0 && (
          <div className="mb-2 flex items-center justify-between rounded-md border border-primary/40 bg-primary/5 px-2 py-1.5 text-xs">
            <span className="font-medium">{selectedIds.size} selected</span>
            <button
              onClick={() => {
                setSelectedIds(new Set());
                setSelectedId(null);
                setBulkNotice(null);
              }}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Clear selection"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className="space-y-1">
          {rows.map((row) => {
            const checked = selectedIds.has(row.id);
            return (
              <div
                key={row.id}
                className={cn(
                  "group flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted",
                  selectedId === row.id && !bulkMode ? "border-primary bg-muted" : "border-border",
                )}
              >
                {selectable && (
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(c) => toggleSelected(row.id, Boolean(c))}
                    aria-label={`Select ${formatCell(primary ? row.values[primary] : null)}`}
                    className="shrink-0"
                  />
                )}
                <button
                  onClick={() => openRow(row.id)}
                  className="block min-w-0 flex-1 text-left"
                  title="Edit this record"
                >
                  <span className="block truncate font-medium">
                    {formatCell(primary ? row.values[primary] : null)}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {cols.slice(1, 3).map((c) => formatCell(row.values[c.field])).join(" · ")}
                  </span>
                </button>
              </div>
            );
          })}
          {rows.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">No {rootLabel} records.</p>
          )}
        </div>
      </div>

      {/* ---------------- editor / bulk editor ---------------- */}
      <div className="overflow-y-auto p-4">
        {bulkMode ? (
          <>
            <div className="mb-1 flex items-center gap-2">
              <h3 className="text-sm font-semibold">Bulk edit · {bulkRows.length} records</h3>
              <Badge variant="outline" className="font-mono text-[10px]">
                {bulkRows.map((r) => String(r.values[primary ?? ""] ?? "")).join(", ").slice(0, 60)}
              </Badge>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Tick a field, then type the new value — it is applied to every selected record.
              Unticked fields are left untouched.
            </p>
            {bulkNotice && <p className="mb-3 rounded-md border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs">{bulkNotice}</p>}
            <div className="max-w-md space-y-2">
              {cols.map((column) => {
                const included = Boolean(bulkIncluded[column.field]);
                const error = bulkErrors[column.field];
                return (
                  <div
                    key={column.field}
                    className={cn(
                      "grid grid-cols-[24px_1fr] items-start gap-2 rounded-md border p-2",
                      included ? "border-primary/50 bg-primary/5" : "border-border",
                    )}
                  >
                    <Checkbox
                      checked={included}
                      onCheckedChange={(c) => toggleBulkField(column.field, Boolean(c))}
                      aria-label={`Include ${column.label} in bulk update`}
                      className="mt-2"
                    />
                    <div className="grid gap-1">
                      <Label htmlFor={`bulk-${column.field}`} className="text-xs">
                        {column.label}
                        {column.required && <span className="ml-1 text-destructive">*</span>}
                        <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                          {column.source ?? column.field}
                          {column.options?.length ? ` · ${column.options.join("/")}` : ""}
                        </span>
                      </Label>
                      <TypedInput
                        id={`bulk-${column.field}`}
                        type={column.type}
                        value={bulkDraft[column.field] ?? ""}
                        onChange={(v) => changeBulk(column.field, v)}
                        onCommit={() => undefined}
                        suggestions={suggestions[column.field]}
                        options={column.options}
                        error={error}
                        className={cn(!included && "opacity-50")}
                      />
                      {!included && (
                        <p className="text-[10px] text-muted-foreground">
                          will not change · current: {formatCell(anchorRow?.values[column.field])}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex justify-end">
              <Button onClick={() => void applyBulk()} disabled={busy}>
                {busy ? "Applying…" : `Update ${bulkRows.length} records`}
              </Button>
            </div>
          </>
        ) : creating ? (
          <>
            <h3 className="mb-3 text-sm font-semibold">New {rootLabel}</h3>
            <div className="max-w-md space-y-3">
              {cols.map((column) => (
                <div key={column.field} className="grid gap-1.5">
                  <Label htmlFor={`create-${column.field}`}>
                    {column.label}
                    {column.required && <span className="ml-1 text-destructive">*</span>}
                    <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                      {column.source ?? column.field}
                    </span>
                  </Label>
                  <TypedInput
                    id={`create-${column.field}`}
                    type={column.type}
                    value={draft[column.field] ?? ""}
                    onChange={(v) => changeDraft(column.field, v)}
                    onCommit={() => undefined}
                    suggestions={suggestions[column.field]}
                    options={column.options}
                    error={errors[column.field] ?? null}
                  />
                </div>
              ))}
              {canCreate && (
                <div className="flex justify-end">
                  <Button onClick={() => void save()} disabled={busy}>
                    {busy ? "Saving…" : "Create"}
                  </Button>
                </div>
              )}
            </div>
          </>
        ) : selected ? (
          <>
            <h3 className="mb-3 text-sm font-semibold">
              {formatCell(primary ? selected.values[primary] : null)}
            </h3>
            <div className="max-w-md space-y-3">
              {cols.map((column) => (
                <div key={column.field} className="grid gap-1.5">
                  <Label htmlFor={`edit-${column.field}`}>
                    {column.label}
                    {column.required && <span className="ml-1 text-destructive">*</span>}
                    <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                      {column.source ?? column.field}
                    </span>
                  </Label>
                  <TypedInput
                    id={`edit-${column.field}`}
                    type={column.type}
                    value={draft[column.field] ?? ""}
                    onChange={(v) => changeDraft(column.field, v)}
                    onCommit={() => undefined}
                    suggestions={suggestions[column.field]}
                    options={column.options}
                    error={errors[column.field] ?? null}
                  />
                </div>
              ))}
              {canUpdate && (
                <div className="flex justify-end">
                  <Button onClick={() => void save()} disabled={busy}>
                    {busy ? "Saving…" : "Save"}
                  </Button>
                </div>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {selectable
              ? `Select a ${rootLabel} to edit — or tick several to bulk-edit them.`
              : `Select a ${rootLabel} to view it.`}
          </p>
        )}
      </div>
    </div>
  );
}
