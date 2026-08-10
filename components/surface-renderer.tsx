"use client";

import { gql, useQuery } from "@apollo/client";

type Surface = {
  id: string;
  name: string;
  renderer: string;
  entity: string;
  config: { columns: string[]; search: string[]; defaultSort: string; actions: string[] };
  permissions: { read: boolean; create: boolean; update: boolean; delete: boolean };
};

const CUSTOMERS = gql`
  query Customers {
    customers(sort: [{ name: ASC }]) {
      id name email status
      projects { id }
    }
  }
`;

const INVOICES = gql`
  query Invoices {
    invoices(sort: [{ number: ASC }]) {
      id number total status
      customer { id name }
    }
  }
`;

const entityQueries: Record<string, { query: typeof CUSTOMERS; root: string; relatedLabel: string }> = {
  Customer: { query: CUSTOMERS, root: "customers", relatedLabel: "projects" },
  Invoice: { query: INVOICES, root: "invoices", relatedLabel: "customer" },
};

export function SurfaceRenderer({ surface }: { surface: Surface }) {
  if (surface.renderer !== "table") return <div className="state">No renderer is registered for <code>{surface.renderer}</code>.</div>;
  return <TableSurface surface={surface} source={entityQueries[surface.entity]} />;
}

function TableSurface({ surface, source }: { surface: Surface; source?: { query: typeof CUSTOMERS; root: string; relatedLabel: string } }) {
  const { data, loading, error } = useQuery(source?.query ?? CUSTOMERS, { skip: !source });
  const rows = (data?.[source?.root ?? "customers"] ?? []) as Array<Record<string, unknown>>;
  return (
    <div className="panel" id={surface.id}>
      <div className="toolbar">
        <label><span>⌕</span><input placeholder={`Search ${surface.name.toLowerCase()}…`} /></label>
        <div className="actions">
          {surface.permissions.create && surface.config.actions.includes("create") && <button className="primary">+ New {surface.entity.toLowerCase()}</button>}
          {!surface.permissions.delete && <span className="locked">Delete restricted</span>}
        </div>
      </div>
      {loading && <div className="state">Loading records…</div>}
      {error && <div className="state error">{error.message}</div>}
      {!loading && !error && <table>
        <thead><tr>{surface.config.columns.map((column) => <th key={column}>{column}</th>)}<th>{source?.relatedLabel ?? "related"}</th><th /></tr></thead>
        <tbody>{rows.map((row) => (
          <tr key={String(row.id)}>
            {surface.config.columns.map((column) => <td key={column}>{column === "status" ? <span className={["badge", String(row.status).toLowerCase()].join(" ")}>{String(row.status)}</span> : column === "total" ? "USD " + Number(row.total).toLocaleString(undefined, { minimumFractionDigits: 2 }) : String(row[column] ?? "")}</td>)}
            <td>{Array.isArray(row.projects) ? row.projects.length : typeof row.customer === "object" && row.customer ? (row.customer as { name: string }).name : "—"}</td>
            <td>{surface.permissions.update && <button className="text-button">Edit</button>}</td>
          </tr>
        ))}</tbody>
      </table>}
    </div>
  );
}
