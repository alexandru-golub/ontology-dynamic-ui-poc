import type { SortState, TableColumn, TableRowData } from "@/components/data-table";

export type RendererProps = {
  title: string;
  rootLabel: string;
  columns: TableColumn[];
  rows: TableRowData[];
  suggestions: Record<string, string[]>;
  canUpdate: boolean;
  canDelete: boolean;
  canCreate: boolean;
  selectedIds: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  onUpdateRow?: (id: string, values: Record<string, unknown>) => Promise<void> | void;
  onCreateRow?: (values: Record<string, unknown>) => Promise<void> | void;
  hasNextPage?: boolean;
  totalCount?: number;
  onLoadMore?: () => void;
  /** Server-side sort for the table renderer (connection re-queries on change). */
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
};

export function sortedColumns(columns: TableColumn[]): TableColumn[] {
  return [...columns].sort((a, b) => a.order - b.order);
}

export function formatCell(value: unknown): React.ReactNode {
  if (value === null || value === undefined || value === "") return <span className="text-muted-foreground/60">—</span>;
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return value.toLocaleString();
  return String(value);
}
