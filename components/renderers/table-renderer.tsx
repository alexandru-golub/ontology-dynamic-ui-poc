"use client";

import { DataTable } from "@/components/data-table";
import type { RendererProps } from "./types";

export function DataTableRenderer({
  columns,
  rows,
  suggestions,
  canUpdate,
  canDelete,
  selectedIds,
  onSelectionChange,
  onUpdateRow,
  hasNextPage,
  totalCount,
  onLoadMore,
}: RendererProps) {
  return (
    <div className="h-full">
      <DataTable
        columns={columns}
        rows={rows}
        editable={canUpdate}
        selectable={canUpdate || canDelete}
        selectedIds={selectedIds}
        onSelectionChange={onSelectionChange}
        onUpdate={onUpdateRow}
        suggestions={suggestions}
        hasNextPage={hasNextPage}
        totalCount={totalCount}
        onLoadMore={onLoadMore}
      />
    </div>
  );
}
