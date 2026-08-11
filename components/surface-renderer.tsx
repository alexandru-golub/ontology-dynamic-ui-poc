"use client";

import { gql, useApolloClient, useMutation, useQuery } from "@apollo/client";
import { ChevronDown, ChevronUp, Download, Filter, GripVertical, Pencil, Plus, Search, Settings2, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { TableColumn, TableRowData } from "@/components/data-table";
import { RendererSwitch } from "@/components/renderers/renderer-switch";
import { SuggestInput } from "@/components/suggest-input";
import { TypedInput } from "@/components/typed-input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { validateField, validateValues } from "@/lib/validate";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
        suggest
        suggestSource
        type
        required
        min
        max
        minLength
        maxLength
        pattern
        options
        validationMessage
      }
      permissions {
        view
        create
        update
        delete
        export
        manage
      }
      suggestions {
        field
        values
      }
    }
  }
`;

const SURFACE_ROWS = gql`
  query SurfaceRows($surfaceId: ID!, $first: Int, $after: String, $search: String, $filters: [ColumnFilterInput!], $orderBy: ColumnOrderInput) {
    surfaceRows(surfaceId: $surfaceId, first: $first, after: $after, search: $search, filters: $filters, orderBy: $orderBy) {
      totalCount
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        cursor
        node {
          id
          values
        }
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
      renderer
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

const UPDATE_COLUMN = gql`
  mutation UpdateColumn($surfaceId: ID!, $columnId: ID!, $input: ColumnPatchInput!) {
    updateColumn(surfaceId: $surfaceId, columnId: $columnId, input: $input) {
      id
    }
  }
`;

const RENDERERS = ["table", "cards", "form", "board", "timeline", "pivot", "gantt"];
const PAGE_SIZE = 50;

type SurfaceRowsData = {
  surfaceRows: {
    totalCount: number;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ cursor: string; node: TableRowData }>;
  };
};

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
  suggestions: Array<{ field: string; values: string[] }>;
};

export type ColumnFilterState = { field: string; op: "eq" | "neq" | "contains" | "gt" | "lt"; value: string };
type ColumnOrderState = { field: string; direction: "ASC" | "DESC" } | null;
type RowPage = {
  rows: TableRowData[];
  hasNextPage: boolean;
  endCursor: string | null;
  totalCount: number;
};

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function csvLines(title: string, columns: TableColumn[], rows: TableRowData[]): string {
  const header = columns.map((c) => csvEscape(c.label)).join(",");
  const lines = rows.map((row) => columns.map((c) => csvEscape(row.values[c.field])).join(","));
  return [header, ...lines].join("\n");
}

function downloadCsv(title: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
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
  const client = useApolloClient();
  const { data, loading, error, refetch } = useQuery<{ getSurface: SurfacePayload }>(GET_SURFACE, {
    variables: { surfaceId },
    fetchPolicy: "no-cache",
  });
  const [createRow] = useMutation(CREATE_ROW);
  const [updateRow] = useMutation(UPDATE_ROW);
  const [deleteRows] = useMutation(DELETE_ROWS);
  const [updateSurface] = useMutation(UPDATE_SURFACE);
  const [addColumn] = useMutation(ADD_COLUMN);
  const [updateColumn] = useMutation(UPDATE_COLUMN);
  const [deleteColumn] = useMutation(DELETE_COLUMN);

  // ---- paged rows ----
  const [rowPage, setRowPage] = useState<RowPage>({ rows: [], hasNextPage: false, endCursor: null, totalCount: 0 });
  const [rowsLoading, setRowsLoading] = useState(true);

  // ---- server-side search / filters / sort ----
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filters, setFilters] = useState<ColumnFilterState[]>([]);
  const [orderBy, setOrderBy] = useState<ColumnOrderState>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState<ColumnFilterState[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (filterOpen) setFilterDraft(filters);
  }, [filterOpen, filters]);

  const rowVariables = useCallback(
    (after?: string | null) => ({
      surfaceId,
      after: after ?? undefined,
      search: debouncedSearch.trim() || undefined,
      filters: filters.length ? filters : undefined,
      orderBy: orderBy ?? undefined,
    }),
    [surfaceId, debouncedSearch, filters, orderBy],
  );

  const loadPage = useCallback(
    async (after?: string | null, append = false) => {
      setRowsLoading(true);
      try {
        const { data } = await client.query<SurfaceRowsData>({
          query: SURFACE_ROWS,
          variables: { first: PAGE_SIZE, ...rowVariables(after) },
          fetchPolicy: "no-cache",
        });
        const conn = data.surfaceRows;
        setRowPage((prev) => ({
          rows: append ? [...prev.rows, ...conn.edges.map((e) => e.node)] : conn.edges.map((e) => e.node),
          hasNextPage: conn.pageInfo.hasNextPage,
          endCursor: conn.pageInfo.endCursor,
          totalCount: conn.totalCount,
        }));
      } catch {
        setRowPage((prev) => ({ ...prev }));
      } finally {
        setRowsLoading(false);
      }
    },
    [client, rowVariables],
  );

  // Any change to search/filters/order resets the cursor to the first page.
  useEffect(() => {
    void loadPage(null);
  }, [loadPage]);

  /** Fetch every page (used by CSV export and full-surface operations). */
  const fetchAllRows = useCallback(async (): Promise<TableRowData[]> => {
    let all: TableRowData[] = [];
    let after: string | null = null;
    do {
      const result = await client.query<SurfaceRowsData>({
        query: SURFACE_ROWS,
        variables: { first: 500, ...rowVariables(after) },
        fetchPolicy: "no-cache",
      });
      const conn: SurfaceRowsData["surfaceRows"] = result.data.surfaceRows;
      all = all.concat(conn.edges.map((e) => e.node));
      after = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
    } while (after);
    return all;
  }, [client, rowVariables]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});
  const [manageOpen, setManageOpen] = useState(false);
  const [createValues, setCreateValues] = useState<Record<string, string>>({});
  const [titleDraft, setTitleDraft] = useState("");
  const [rootDraft, setRootDraft] = useState("");
  const [rendererDraft, setRendererDraft] = useState("table");
  const [columnDraft, setColumnDraft] = useState({
    field: "", label: "", source: "", order: "", suggest: false, suggestSource: "", type: "string",
    required: false, min: "", max: "", minLength: "", maxLength: "", pattern: "", options: "", validationMessage: "",
  });
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  // column reorder state (manage dialog)
  const [columnsDraft, setColumnsDraft] = useState<TableColumn[] | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const surface = data?.getSurface;

  const suggestions = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const group of surface?.suggestions ?? []) map[group.field] = group.values;
    return map;
  }, [surface]);

  // keep the manage-dialog column order in sync with refetched data
  useEffect(() => {
    if (manageOpen && surface) {
      setColumnsDraft([...surface.columns].sort((a, b) => a.order - b.order));
    }
  }, [manageOpen, surface]);

  if (loading) return <p className="state">Loading GraphQL surface…</p>;
  if (error) return <Alert variant="destructive"><AlertDescription>{error.message}</AlertDescription></Alert>;
  if (!surface) return <Alert variant="destructive"><AlertDescription>Surface unavailable.</AlertDescription></Alert>;

  const { permissions } = surface;
  const canUpdate = permissions.update;
  const canDelete = permissions.delete;

  const rows = rowPage.rows;

  const openCreateDialog = () => {
    const initial: Record<string, string> = {};
    for (const column of surface.columns) initial[column.field] = "";
    setCreateValues(initial);
    setCreateErrors({});
    setCreateOpen(true);
  };

  const changeCreateValue = (field: string, value: string) => {
    setCreateValues((prev) => ({ ...prev, [field]: value }));
    setCreateErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      const column = surface.columns.find((c) => c.field === field);
      const error = validateField(column, value);
      if (error) next[field] = error;
      else delete next[field];
      return next;
    });
  };

  const submitCreate = async () => {
    const values: Record<string, unknown> = {};
    for (const column of surface.columns) values[column.field] = createValues[column.field] ?? "";
    const found = validateValues(surface.columns, values);
    if (Object.keys(found).length > 0) {
      setCreateErrors(found);
      return;
    }
    try {
      await createRow({ variables: { surfaceId, values } });
      setCreateOpen(false);
      setCreateErrors({});
      setNotice("Row created.");
      await Promise.all([refetch(), loadPage(null)]);
    } catch (err) {
      setNotice(`Create failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const submitDelete = async () => {
    try {
      const result = await deleteRows({ variables: { surfaceId, ids: [...selected] } });
      setSelected(new Set());
      setNotice(`Deleted ${result.data?.deleteRows ?? selected.size} row(s).`);
      await Promise.all([refetch(), loadPage(null)]);
    } catch (err) {
      setNotice(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleUpdateRow = async (id: string, values: Record<string, unknown>) => {
    try {
      await updateRow({ variables: { surfaceId, id, values } });
      await Promise.all([refetch(), loadPage(null)]);
    } catch (err) {
      setNotice(`Update failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleCreateRow = async (values: Record<string, unknown>) => {
    try {
      await createRow({ variables: { surfaceId, values } });
      setNotice("Row created.");
      await Promise.all([refetch(), loadPage(null)]);
    } catch (err) {
      setNotice(`Create failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const submitRename = async () => {
    try {
      await updateSurface({
        variables: { surfaceId, input: { title: titleDraft, rootLabel: rootDraft || undefined, renderer: rendererDraft } },
      });
      setManageOpen(false);
      setNotice(`Surface updated.`);
      await Promise.all([refetch(), client.refetchQueries({ include: ["ListSurfaces"] })]);
      window.dispatchEvent(new CustomEvent("surface-renamed", { detail: { title: titleDraft } }));
    } catch (err) {
      setNotice(`Update failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  /** Convert the validation-rule fields of the column draft into a GraphQL input. */
  const rulesFromDraft = (draft: typeof columnDraft) => {
    const num = (value: string) => (value.trim() === "" ? undefined : Number(value));
    return {
      required: draft.required,
      min: num(draft.min),
      max: num(draft.max),
      minLength: num(draft.minLength),
      maxLength: num(draft.maxLength),
      pattern: draft.pattern.trim() || undefined,
      options: draft.options
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean) || undefined,
      validationMessage: draft.validationMessage.trim() || undefined,
    };
  };

  const resetColumnDraft = () =>
    setColumnDraft({
      field: "", label: "", source: "", order: "", suggest: false, suggestSource: "", type: "string",
      required: false, min: "", max: "", minLength: "", maxLength: "", pattern: "", options: "", validationMessage: "",
    });

  /** Load an existing column into the add/edit form. */
  const editColumn = (column: TableColumn) => {
    setEditingColumnId(column.id ?? null);
    setColumnDraft({
      field: column.field,
      label: column.label,
      source: column.source ?? "",
      order: String(column.order),
      suggest: Boolean(column.suggest),
      suggestSource: column.suggestSource ?? "",
      type: column.type ?? "string",
      required: Boolean(column.required),
      min: column.min === null || column.min === undefined ? "" : String(column.min),
      max: column.max === null || column.max === undefined ? "" : String(column.max),
      minLength: column.minLength === null || column.minLength === undefined ? "" : String(column.minLength),
      maxLength: column.maxLength === null || column.maxLength === undefined ? "" : String(column.maxLength),
      pattern: column.pattern ?? "",
      options: column.options?.join(", ") ?? "",
      validationMessage: column.validationMessage ?? "",
    });
  };

  const cancelEditColumn = () => {
    setEditingColumnId(null);
    resetColumnDraft();
  };

  const submitColumn = async () => {
    if (!columnDraft.field.trim() || !columnDraft.label.trim()) {
      setNotice("Field and label are required for a column.");
      return;
    }
    const input = {
      field: columnDraft.field.trim(),
      label: columnDraft.label.trim(),
      source: columnDraft.source.trim() || undefined,
      order: columnDraft.order ? Number(columnDraft.order) : null,
      suggest: columnDraft.suggest,
      suggestSource: columnDraft.suggestSource.trim() || undefined,
      type: columnDraft.type,
      ...rulesFromDraft(columnDraft),
    };
    try {
      if (editingColumnId) {
        await updateColumn({ variables: { surfaceId, columnId: editingColumnId, input } });
        setNotice(`Column "${input.label}" saved.`);
        cancelEditColumn();
      } else {
        await addColumn({ variables: { surfaceId, input } });
        setNotice(`Column "${input.field}" added.`);
        resetColumnDraft();
      }
      await refetch();
    } catch (err) {
      setNotice(`${editingColumnId ? "Save" : "Add"} column failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const toggleSuggest = async (columnId: string, field: string, suggest: boolean) => {
    try {
      await updateColumn({ variables: { surfaceId, columnId, input: { suggest } } });
      setNotice(suggest ? `Suggestions enabled for "${field}".` : `Suggestions disabled for "${field}".`);
      await refetch();
    } catch (err) {
      setNotice(`Toggle failed: ${err instanceof Error ? err.message : String(err)}`);
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

  /** Reorder columns locally, then persist the new 1..N order via updateColumn. */
  const persistColumnOrder = async (ordered: TableColumn[]) => {
    const diffs = ordered
      .map((column, index) => ({ column, order: index + 1 }))
      .filter(({ column, order }) => column.order !== order);
    try {
      await Promise.all(
        diffs.map(({ column, order }) =>
          column.id ? updateColumn({ variables: { surfaceId, columnId: column.id, input: { order } } }) : Promise.resolve(),
        ),
      );
      setNotice("Column order saved.");
      await refetch();
    } catch (err) {
      setNotice(`Reorder failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const moveColumn = (index: number, delta: -1 | 1) => {
    if (!columnsDraft) return;
    const target = index + delta;
    if (target < 0 || target >= columnsDraft.length) return;
    const next = [...columnsDraft];
    [next[index], next[target]] = [next[target], next[index]];
    setColumnsDraft(next);
    void persistColumnOrder(next);
  };

  const dropColumn = () => {
    if (dragIndex === null || overIndex === null || !columnsDraft || dragIndex === overIndex) {
      setDragIndex(null);
      setOverIndex(null);
      return;
    }
    const next = [...columnsDraft];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(overIndex, 0, moved);
    setColumnsDraft(next);
    setDragIndex(null);
    setOverIndex(null);
    void persistColumnOrder(next);
  };

  const exportAll = async () => {
    const all = await fetchAllRows();
    downloadCsv(surface.title, csvLines(surface.title, surface.columns, all));
  };

  const rendererProps = {
    title: surface.title,
    rootLabel: surface.rootLabel,
    columns: surface.columns,
    rows,
    suggestions,
    canUpdate,
    canDelete,
    canCreate: permissions.create,
    selectedIds: selected,
    onSelectionChange: canUpdate || canDelete ? setSelected : undefined,
    onUpdateRow: handleUpdateRow,
    onCreateRow: handleCreateRow,
    hasNextPage: rowPage.hasNextPage,
    totalCount: rowPage.totalCount,
    onLoadMore: () => void loadPage(rowPage.endCursor, true),
    sort: orderBy ? { field: orderBy.field, dir: orderBy.direction === "ASC" ? ("asc" as const) : ("desc" as const) } : null,
    onSortChange: (next: { field: string; dir: "asc" | "desc" } | null) =>
      setOrderBy(next ? { field: next.field, direction: next.dir === "asc" ? "ASC" : "DESC" } : null),
  };

  return (
    <div className="panel flex h-[560px] flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <Badge variant="outline" className="font-mono">
          root: {surface.rootLabel}
        </Badge>
        <Badge variant="outline">{surface.renderer}</Badge>
        <div className="relative ml-auto w-56">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            className="h-8 pl-8 text-sm"
            placeholder="Search rows…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search rows"
          />
        </div>
        <Button size="sm" variant="outline" className="h-8" onClick={() => setFilterOpen(true)}>
          <Filter /> Filters{filters.length > 0 ? ` (${filters.length})` : ""}
        </Button>
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
              setRendererDraft(surface.renderer);
              setManageOpen(true);
            }}
          >
            <Settings2 /> Manage surface
          </Button>
        )}
        {permissions.export && (
          <Button size="sm" variant="outline" onClick={() => void exportAll()}>
            <Download /> Export CSV
          </Button>
        )}
        {canDelete && (
          <Button size="sm" variant="destructive" disabled={selected.size === 0} onClick={() => void submitDelete()}>
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
        <RendererSwitch renderer={surface.renderer} {...rendererProps} />
      </div>
      {rowsLoading && rows.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">Loading rows…</p>
        </div>
      )}

      {/* ---------------- Create row dialog ---------------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add {surface.rootLabel}</DialogTitle>
            <DialogDescription>Fields come from the surface columns. Blank neighbor fields are skipped.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {[...surface.columns]
              .sort((a, b) => a.order - b.order)
              .map((column) => (
                <div key={column.field} className="grid gap-1.5">
                  <Label htmlFor={`create-${column.field}`}>
                    {column.label}
                    {column.required && <span className="ml-1 text-destructive">*</span>}
                    <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                      {column.source ?? column.field}
                      {column.suggest ? " · suggest" : ""}
                      {column.options?.length ? ` · ${column.options.join("/")}` : ""}
                    </span>
                  </Label>
                  <TypedInput
                    id={`create-${column.field}`}
                    type={column.type}
                    value={createValues[column.field] ?? ""}
                    onChange={(v) => changeCreateValue(column.field, v)}
                    onCommit={() => undefined}
                    suggestions={suggestions[column.field]}
                    options={column.options}
                    error={createErrors[column.field] ?? null}
                  />
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


      {/* ---------------- Filters dialog ---------------- */}
      <Dialog open={filterOpen} onOpenChange={setFilterOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Filter rows</DialogTitle>
            <DialogDescription>
              Filters run server-side inside the row connection — the count, paging and CSV
              export all apply to the filtered set. Empty value matches blank cells.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {filterDraft.map((filter, index) => (
              <div key={index} className="grid grid-cols-[1fr_110px_1fr_32px] items-center gap-2">
                <Select
                  value={filter.field}
                  onValueChange={(field) => setFilterDraft((prev) => prev.map((f, i) => (i === index ? { ...f, field } : f)))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[...surface.columns].sort((a, b) => a.order - b.order).map((column) => (
                      <SelectItem key={column.field} value={column.field}>{column.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={filter.op}
                  onValueChange={(op) => setFilterDraft((prev) => prev.map((f, i) => (i === index ? { ...f, op: op as ColumnFilterState["op"] } : f)))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="eq">is</SelectItem>
                    <SelectItem value="neq">is not</SelectItem>
                    <SelectItem value="contains">contains</SelectItem>
                    <SelectItem value="gt">&gt;</SelectItem>
                    <SelectItem value="lt">&lt;</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  placeholder="value"
                  value={filter.value}
                  onChange={(event) => setFilterDraft((prev) => prev.map((f, i) => (i === index ? { ...f, value: event.target.value } : f)))}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setFilterDraft((prev) => prev.filter((_, i) => i !== index))}
                  aria-label="Remove filter"
                >
                  <X />
                </Button>
              </div>
            ))}
            {filterDraft.length === 0 && <p className="text-sm text-muted-foreground">No filters — showing every row.</p>}
            <Button size="sm" variant="outline" onClick={() => setFilterDraft((prev) => [...prev, { field: surface.columns[0]?.field ?? "", op: "eq", value: "" }])}>
              <Plus /> Add filter
            </Button>
          </div>
          <DialogFooter className="justify-between">
            <Button
              variant="ghost"
              onClick={() => {
                setFilters([]);
                setFilterDraft([]);
                setFilterOpen(false);
              }}
            >
              Clear all
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setFilterOpen(false)}>Cancel</Button>
              <Button
                onClick={() => {
                  setFilters(filterDraft.filter((f) => f.field));
                  setFilterOpen(false);
                }}
              >
                Apply
              </Button>
            </div>
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
              <code className="text-xs">&gt;Rel:Label.prop</code>, <code className="text-xs">&lt;Rel:Label.prop</code>,{" "}
              <code className="text-xs">Label.count</code>, plus aggregates{" "}
              <code className="text-xs">Label.prop.sum|avg|min|max</code> and{" "}
              <code className="text-xs">&gt;Rel:Label.prop.sum|avg|min|max</code>.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="surface-title">Surface title</Label>
                <Input id="surface-title" value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="surface-root">Root node label</Label>
                <Input id="surface-root" value={rootDraft} onChange={(e) => setRootDraft(e.target.value)} placeholder="Project" />
              </div>
              <div className="grid gap-1.5">
                <Label>Renderer</Label>
                <Select value={rendererDraft} onValueChange={setRendererDraft}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RENDERERS.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="mb-1.5 block">Columns (drag to reorder)</Label>
              <div className="max-h-44 space-y-1 overflow-auto rounded-md border p-2">
                {(columnsDraft ?? []).map((column, index) => (
                  <div
                    key={column.id ?? column.field}
                    draggable
                    onDragStart={() => setDragIndex(index)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setOverIndex(index);
                    }}
                    onDrop={() => dropColumn()}
                    onDragEnd={() => {
                      setDragIndex(null);
                      setOverIndex(null);
                    }}
                    className={`flex cursor-grab items-center justify-between gap-2 rounded px-2 py-1 text-sm hover:bg-muted ${
                      overIndex === index && dragIndex !== null && dragIndex !== index ? "border-t-2 border-primary" : ""
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">
                        {column.label}{" "}
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {column.field} · {column.source ?? "self." + column.field} · #{column.order}
                        </span>
                        {column.suggest && (
                          <span className="ml-1 rounded bg-primary/15 px-1 py-0.5 text-[10px] font-semibold text-primary">suggest</span>
                        )}
                        {Boolean(column.required) && (
                          <span className="ml-1 rounded bg-destructive/10 px-1 py-0.5 text-[10px] font-semibold text-destructive">required</span>
                        )}
                        {column.options?.length ? (
                          <span className="ml-1 rounded bg-muted px-1 py-0.5 text-[10px] font-semibold text-muted-foreground">
                            {column.options.length} options
                          </span>
                        ) : null}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <button
                        className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                        disabled={index === 0}
                        onClick={() => moveColumn(index, -1)}
                        aria-label={`Move ${column.label} up`}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <button
                        className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                        disabled={index === (columnsDraft?.length ?? 0) - 1}
                        onClick={() => moveColumn(index, 1)}
                        aria-label={`Move ${column.label} down`}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                      <button
                        className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                        onClick={() => editColumn(column)}
                        aria-label={`Edit column ${column.label}`}
                        title="Edit column (label, source, type, validation)"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <label className="ml-1 flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={Boolean(column.suggest)}
                          onChange={(event) => column.id && void toggleSuggest(column.id, column.field, event.target.checked)}
                          className="h-3.5 w-3.5 accent-[var(--primary)]"
                        />
                        suggest
                      </label>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        onClick={() => column.id && void submitDeleteColumn(column.id, column.field)}
                        aria-label={`Delete column ${column.label}`}
                      >
                        <X />
                      </Button>
                    </span>
                  </div>
                ))}
                {(columnsDraft ?? []).length === 0 && <p className="px-2 py-1 text-sm text-muted-foreground">No columns yet.</p>}
              </div>
            </div>

            <div className="grid gap-1.5">
              <div className="mb-1 flex items-center justify-between">
                <Label className="block">{editingColumnId ? "Edit column" : "Add column"}</Label>
                {editingColumnId && (
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={cancelEditColumn}>
                    <X className="h-3.5 w-3.5" /> Cancel edit
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-[1fr_1fr_1.2fr_0.8fr_64px_110px] gap-2">
                <Input
                  placeholder="field"
                  value={columnDraft.field}
                  disabled={Boolean(editingColumnId)}
                  onChange={(e) => setColumnDraft((p) => ({ ...p, field: e.target.value }))}
                />
                <Input placeholder="label" value={columnDraft.label} onChange={(e) => setColumnDraft((p) => ({ ...p, label: e.target.value }))} />
                <Input
                  placeholder="source (e.g. >HAS_STATUS:Status.name)"
                  value={columnDraft.source}
                  onChange={(e) => setColumnDraft((p) => ({ ...p, source: e.target.value }))}
                />
                <Input
                  placeholder="suggest from (optional)"
                  value={columnDraft.suggestSource}
                  onChange={(e) => setColumnDraft((p) => ({ ...p, suggestSource: e.target.value }))}
                />
                <Input placeholder="#" type="number" value={columnDraft.order} onChange={(e) => setColumnDraft((p) => ({ ...p, order: e.target.value }))} />
                <Select value={columnDraft.type} onValueChange={(v) => setColumnDraft((p) => ({ ...p, type: v }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["string", "number", "boolean", "date", "money"].map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={columnDraft.suggest}
                  onChange={(e) => setColumnDraft((p) => ({ ...p, suggest: e.target.checked }))}
                  className="h-3.5 w-3.5 accent-[var(--primary)]"
                />
                Recommend existing values while typing (per-field, on/off)
              </label>

              {/* ---- validation rules (enforced server-side on every write) ---- */}
              <div className="rounded-md border p-2">
                <div className="mb-2 flex items-center justify-between">
                  <Label className="text-xs">Validation rules</Label>
                  <span className="font-mono text-[10px] text-muted-foreground">required · min · max · lengths · pattern · options</span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <label className="flex items-center gap-1.5 rounded border px-2 py-1.5 text-xs hover:bg-muted">
                    <input
                      type="checkbox"
                      checked={columnDraft.required}
                      onChange={(e) => setColumnDraft((p) => ({ ...p, required: e.target.checked }))}
                      className="h-3.5 w-3.5 accent-[var(--primary)]"
                    />
                    required
                  </label>
                  <Input placeholder="min" type="number" value={columnDraft.min} onChange={(e) => setColumnDraft((p) => ({ ...p, min: e.target.value }))} className="h-8 text-xs" />
                  <Input placeholder="max" type="number" value={columnDraft.max} onChange={(e) => setColumnDraft((p) => ({ ...p, max: e.target.value }))} className="h-8 text-xs" />
                  <Input placeholder="min length" type="number" value={columnDraft.minLength} onChange={(e) => setColumnDraft((p) => ({ ...p, minLength: e.target.value }))} className="h-8 text-xs" />
                  <Input placeholder="max length" type="number" value={columnDraft.maxLength} onChange={(e) => setColumnDraft((p) => ({ ...p, maxLength: e.target.value }))} className="h-8 text-xs" />
                  <Input placeholder="regex pattern" value={columnDraft.pattern} onChange={(e) => setColumnDraft((p) => ({ ...p, pattern: e.target.value }))} className="h-8 text-xs" />
                  <Input placeholder="options (comma-separated)" value={columnDraft.options} onChange={(e) => setColumnDraft((p) => ({ ...p, options: e.target.value }))} className="h-8 text-xs" />
                  <Input placeholder="custom error message" value={columnDraft.validationMessage} onChange={(e) => setColumnDraft((p) => ({ ...p, validationMessage: e.target.value }))} className="h-8 text-xs" />
                </div>
              </div>

              <div className="mt-1 flex justify-end">
                <Button size="sm" variant="secondary" onClick={() => void submitColumn()}>
                  <Plus /> {editingColumnId ? "Save column" : "Add column"}
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
