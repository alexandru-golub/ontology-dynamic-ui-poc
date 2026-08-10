"use client";

import { gql, useApolloClient, useMutation, useQuery } from "@apollo/client";
import { Download, Plus, Settings2, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { DataTable, type TableColumn, type TableRowData } from "@/components/data-table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ---------------------------------------------------------------------------
// GraphQL
// ---------------------------------------------------------------------------
const GET_SURFACE = gql`
  query GetSurface($surfaceId: ID!) {
    getSurface(surfaceId: $surfaceId) {
      id
      title
      renderer
      rootLabel
      columns {
        id
        field
        label
        order
        source
      }
      permissions {
        view
        create
        update
        delete
        export
        manage
      }
      rows {
        id
        values
      }
    }
  }
`;

const CREATE_ROW = gql`
  mutation CreateRow($surfaceId: ID!, $values: JSON!) {
    createRow(surfaceId: $surfaceId, values: $values) {
      id
      values
    }
  }
`;

const UPDATE_ROW = gql`
  mutation UpdateRow($surfaceId: ID!, $id: ID!, $values: JSON!) {
    updateRow(surfaceId: $surfaceId, id: $id, values: $values) {
      id
      values
    }
  }
`;

const DELETE_ROWS = gql`
  mutation DeleteRows($surfaceId: ID!, $ids: [ID!]!) {
    deleteRows(surfaceId: $surfaceId, ids: $ids)
  }
`;

const UPDATE_SURFACE = gql`
  mutation UpdateSurface($surfaceId: ID!, $input: SurfaceUpdateInput!) {
    updateSurface(surfaceId: $surfaceId, input: $input) {
      id
      title
      rootLabel
    }
  }
`;

const ADD_COLUMN = gql`
  mutation AddColumn($surfaceId: ID!, $input: ColumnInput!) {
    addColumn(surfaceId: $surfaceId, input: $input) {
      id
    }
  }
`;

const DELETE_COLUMN = gql`
  mutation DeleteColumn($surfaceId: ID!, $columnId: ID!) {
    deleteColumn(surfaceId: $surfaceId, columnId: $columnId) {
      id
    }
  }
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Permissions = {
  view: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
  export: boolean;
  manage: boolean;
};
type SurfacePayload = {
  id: string;
  title: string;
  renderer: string;
  rootLabel: string;
  columns: TableColumn[];
  permissions: Permissions;
  rows: TableRowData[];
};

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function exportCsv(title: string, columns: TableColumn[], rows: TableRowData[]) {
  const header = columns.map((c) => csvEscape(c.label)).join(",");
  const lines = rows.map((row) => columns.map((c) => csvEscape(row.values[c.field])).join(","));
  const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${title.replace(/\W+/g, "-").toLowerCase()}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function DynamicSurface({ surfaceId }: { surfaceId: string }) {
  const { data, loading, error, refetch } = useQuery<{ getSurface: SurfacePayload }>(GET_SURFACE, {
    variables: { surfaceId },
    fetchPolicy: "no-cache",
  });
  const client = useApolloClient();
  const [createRow] = useMutation(CREATE_ROW);
  const [updateRow] = useMutation(UPDATE_ROW);
  const [deleteRows] = useMutation(DELETE_ROWS);
  const [updateSurface] = useMutation(UPDATE_SURFACE);
  const [addColumn] = useMutation(ADD_COLUMN);
  const [deleteColumn] = useMutation(DELETE_COLUMN);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [createValues, setCreateValues] = useState<Record<string, string>>({});
  const [titleDraft, setTitleDraft] = useState("");
  const [rootDraft, setRootDraft] = useState("");
  const [columnDraft, setColumnDraft] = useState({ field: "", label: "", source: "", order: "" });

  const surface = data?.getSurface;

  const suggestions = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const column of surface?.columns ?? []) {
      const values = new Set<string>();
      for (const row of surface?.rows ?? []) {
        const v = row.values[column.field];
        if (typeof v === "string" && v) values.add(v);
      }
      if (values.size) map[column.field] = [...values].sort();
    }
    return map;
  }, [surface]);

  if (loading) return <p className="state">Loading GraphQL surface…</p>;
  if (error) return <Alert variant="destructive"><AlertDescription>{error.message}</AlertDescription></Alert>;
  if (!surface) return <Alert variant="destructive"><AlertDescription>Surface unavailable.</AlertDescription></Alert>;

  const { permissions } = surface;
  const canUpdate = permissions.update;
  const canDelete = permissions.delete;

  const openCreateDialog = () => {
    const initial: Record<string, string> = {};
    for (const column of surface.columns) initial[column.field] = "";
    setCreateValues(initial);
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    const values: Record<string, unknown> = {};
    for (const column of surface.columns) values[column.field] = createValues[column.field] ?? "";
    try {
      await createRow({ variables: { surfaceId, values } });
      setCreateOpen(false);
      setNotice(`Created row.`);
      await refetch();
    } catch (err) {
      setNotice(`Create failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const submitDelete = async () => {
    try {
      const result = await deleteRows({ variables: { surfaceId, ids: [...selected] } });
      setSelected(new Set());
      setNotice(`Deleted ${result.data?.deleteRows ?? selected.size} row(s).`);
      await refetch();
    } catch (err) {
      setNotice(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleUpdate = async (id: string, values: Record<string, unknown>) => {
    try {
      await updateRow({ variables: { surfaceId, id, values } });
      await refetch();
    } catch (err) {
      setNotice(`Update failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const submitRename = async () => {
    try {
      await updateSurface({
        variables: { surfaceId, input: { title: titleDraft, rootLabel: rootDraft || undefined } },
      });
      setManageOpen(false);
      setNotice(`Surface renamed to "${titleDraft}".`);
      await Promise.all([refetch(), client.refetchQueries({ include: ["ListSurfaces"] })]);
      window.dispatchEvent(new CustomEvent("surface-renamed", { detail: { title: titleDraft } }));
    } catch (err) {
      setNotice(`Rename failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const submitAddColumn = async () => {
    if (!columnDraft.field.trim() || !columnDraft.label.trim()) {
      setNotice("Field and label are required for a new column.");
      return;
    }
    try {
      await addColumn({
        variables: {
          surfaceId,
          input: {
            field: columnDraft.field.trim(),
            label: columnDraft.label.trim(),
            source: columnDraft.source.trim() || undefined,
            order: columnDraft.order ? Number(columnDraft.order) : null,
          },
        },
      });
      setColumnDraft({ field: "", label: "", source: "", order: "" });
      setNotice(`Column "${columnDraft.field}" added.`);
      await refetch();
    } catch (err) {
      setNotice(`Add column failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const submitDeleteColumn = async (columnId: string, field: string) => {
    try {
      await deleteColumn({ variables: { surfaceId, columnId } });
      setNotice(`Column "${field}" removed.`);
      await refetch();
    } catch (err) {
      setNotice(`Delete column failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="panel flex h-[560px] flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <Badge variant="outline" className="font-mono">
          root: {surface.rootLabel}
        </Badge>
        <div className="flex-1" />
        {permissions.create && (
          <Button size="sm" onClick={openCreateDialog}>
            <Plus /> Add row
          </Button>
        )}
        {permissions.manage && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setTitleDraft(surface.title);
              setRootDraft(surface.rootLabel);
              setManageOpen(true);
            }}
          >
            <Settings2 /> Manage surface
          </Button>
        )}
        {permissions.export && (
          <Button size="sm" variant="outline" onClick={() => exportCsv(surface.title, surface.columns, surface.rows)}>
            <Download /> Export CSV
          </Button>
        )}
        {canDelete && (
          <Button
            size="sm"
            variant="destructive"
            disabled={selected.size === 0}
            onClick={() => void submitDelete()}
          >
            <Trash2 /> Delete ({selected.size})
          </Button>
        )}
      </div>

      {notice && (
        <div className="px-4 pt-2">
          <Alert variant="info">
            <AlertDescription className="flex items-center justify-between">
              {notice}
              <button onClick={() => setNotice(null)} aria-label="Dismiss" className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </AlertDescription>
          </Alert>
        </div>
      )}

      <div className="min-h-0 flex-1">
        <DataTable
          columns={surface.columns}
          rows={surface.rows}
          editable={canUpdate}
          selectable={canUpdate || canDelete}
          selectedIds={selected}
          onSelectionChange={setSelected}
          onUpdate={handleUpdate}
          suggestions={suggestions}
          emptyMessage={surface.columns.length === 0 ? "No columns defined yet — open Manage surface to add one." : "No rows."}
        />
      </div>

      {/* ---------------- Create row dialog ---------------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add {surface.rootLabel}</DialogTitle>
            <DialogDescription>
              Fields come from the surface columns. Blank neighbor fields are skipped.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {[...surface.columns]
              .sort((a, b) => a.order - b.order)
              .map((column) => (
                <div key={column.field} className="grid gap-1.5">
                  <Label htmlFor={`create-${column.field}`}>
                    {column.label}
                    <span className="ml-2 font-mono text-[10px] text-muted-foreground">{column.source ?? column.field}</span>
                  </Label>
                  <Input
                    id={`create-${column.field}`}
                    value={createValues[column.field] ?? ""}
                    onChange={(event) => setCreateValues((prev) => ({ ...prev, [column.field]: event.target.value }))}
                    list={suggestions[column.field] ? `create-dl-${column.field}` : undefined}
                  />
                  {suggestions[column.field] && (
                    <datalist id={`create-dl-${column.field}`}>
                      {suggestions[column.field].map((s) => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                  )}
                </div>
              ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submitCreate()} disabled={!createValues.project?.trim() && surface.rootLabel === "Project"}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------- Manage surface dialog ---------------- */}
      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Manage surface · {surface.title}</DialogTitle>
            <DialogDescription>
              Definitions live in Neo4j — the UI re-renders from these. Sources:{" "}
              <code className="text-xs">self.prop</code>, <code className="text-xs">Label.prop</code>,{" "}
              <code className="text-xs">Label.count</code>.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="surface-title">Surface title</Label>
                <Input id="surface-title" value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="surface-root">Root node label</Label>
                <Input id="surface-root" value={rootDraft} onChange={(e) => setRootDraft(e.target.value)} placeholder="Project" />
              </div>
            </div>

            <div>
              <Label className="mb-1.5 block">Columns</Label>
              <div className="max-h-44 space-y-1 overflow-auto rounded-md border p-2">
                {[...surface.columns]
                  .sort((a, b) => a.order - b.order)
                  .map((column) => (
                    <div key={column.id ?? column.field} className="flex items-center justify-between rounded px-2 py-1 text-sm hover:bg-muted">
                      <span>
                        {column.label}{" "}
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {column.field} · {column.source ?? "self." + column.field} · #{column.order}
                        </span>
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        onClick={() => column.id && void submitDeleteColumn(column.id, column.field)}
                        aria-label={`Delete column ${column.label}`}
                      >
                        <X />
                      </Button>
                    </div>
                  ))}
                {surface.columns.length === 0 && <p className="px-2 py-1 text-sm text-muted-foreground">No columns yet.</p>}
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label className="mb-1 block">Add column</Label>
              <div className="grid grid-cols-[1fr_1fr_1fr_64px] gap-2">
                <Input
                  placeholder="field"
                  value={columnDraft.field}
                  onChange={(e) => setColumnDraft((p) => ({ ...p, field: e.target.value }))}
                />
                <Input
                  placeholder="label"
                  value={columnDraft.label}
                  onChange={(e) => setColumnDraft((p) => ({ ...p, label: e.target.value }))}
                />
                <Input
                  placeholder="source (e.g. Status.name)"
                  value={columnDraft.source}
                  onChange={(e) => setColumnDraft((p) => ({ ...p, source: e.target.value }))}
                />
                <Input
                  placeholder="#"
                  type="number"
                  value={columnDraft.order}
                  onChange={(e) => setColumnDraft((p) => ({ ...p, order: e.target.value }))}
                />
              </div>
              <div className="mt-1 flex justify-end">
                <Button size="sm" variant="secondary" onClick={() => void submitAddColumn()}>
                  <Plus /> Add column
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManageOpen(false)}>
              Close
            </Button>
            <Button onClick={() => void submitRename()} disabled={!titleDraft.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
