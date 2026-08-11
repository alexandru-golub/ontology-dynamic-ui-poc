# Graph Surfaces

An always-evolving UI driven by a Neo4j graph. Surfaces (what the UI renders),
their columns, row data, and per-user/role permissions are all graph data; the
Next.js frontend renders whatever the graph defines for the signed-in user.

```
React surface renderer (shadcn/ui + Tailwind) → Apollo Client → /api/graphql → Neo4j
```

The browser never receives Neo4j credentials — every query/mutation goes
through the server-side GraphQL route, and every mutation is re-checked against
the permission graph on the server.

## Run

```bash
cp .env.example .env.local
docker compose up -d neo4j
npm install
npm run seed
npm run dev
```

Open http://localhost:3000. Neo4j Browser: http://localhost:7477 (neo4j / local-dev-password).

## Demo users (switch top-right)

| User | Role | Capabilities |
| ---- | ---- | ------------ |
| Ada Admin (`admin_001`) | Super admin (`isAdmin: true`) | Everything + **Admin console** (users, roles, grants, overrides, surfaces, **audit trail**) |
| John Doe (`user_101`) | Sales | Row CRUD on Project Overview (delete via override), manage on Customer Portfolio, **drag cards between lanes on Project Board** |
| Jane Smith (`user_202`) | Analyst | Read-only + export everywhere |

## The ideas

### 1. Admin console
A super-privileged user (`User.isAdmin = true`) bypasses all permission checks
and gets an **Admin console** in the sidebar with three tabs:
- **Users** — create/delete users, toggle admin, assign/remove roles
- **Roles** — create/delete roles, edit per-surface grants (view/create/update/delete/export/manage)
- **Surfaces** — create surfaces (root label + columns), open/delete them

All `admin*` GraphQL mutations are guarded by `requireAdmin` server-side — the
UI hiding is not the security boundary.

### 2. shadcn/ui
MUI was removed entirely (page bundle: 249 kB → ~73 kB). Components live
in `components/ui/*` (button, dialog, select, tabs, checkbox, table, badge,
alert, card, input, label, textarea) built on Radix primitives + Tailwind v4.

### 3. Multi-source surfaces
A surface is rooted at a node label (`Surface.rootLabel`) and each column
carries a `source` that tells the projector where to pull the value from:

| Source | Meaning | Example |
| ------ | ------- | ------- |
| `self.<prop>` | property on the row's root node | `self.budget` |
| `<Label>.<prop>` | property of a *neighboring* node of that label (any relationship) | `Customer.name`, `Status.name`, `Role.name` |
| `<Label>.count` | number of neighboring nodes of that label | `Project.count` |
| `>Rel:Label.<prop>` | property of a node reached via an **outgoing** typed relationship | `>HAS_STATUS:Status.name` |
| `<Rel:Label.<prop>` | property of a node reached via an **incoming** typed relationship | `<HAS_PROJECT:Customer.name` |
| `>Rel:Label.count` / `<Rel:Label.count` | count over a typed relationship | `<HAS_PROJECT:Project.count` |

Typed sources make the relationship explicit, so **row writes** can create/relink
those neighbors generically (any `Label.prop` column with a known relationship
is writable — not just the hardcoded Customer/Status/Role set).

Seeded examples of one surface mixing many node types:
- **Project Overview** — rows are `Project` nodes; columns come from the
  project itself (`name`, `owner`, `budget`), its `Customer` and its `Status`.
- **Customer Portfolio** — rows are `Customer` nodes; columns show the
  customer's own name, the *count* of their projects, the name of one linked
  project and the largest project budget.
- **People & Roles** — rows are `User` nodes; columns come from the user
  (`name`, `isAdmin`) and their linked `Role`.
- **Project Board** — same rows as Project Overview but rendered as a kanban
  board grouped by `Status`; Sales can drag projects between Active / Draft / Done.
- **Project Pivot** — `pivot` renderer: customers × statuses, cells sum budgets.
- **Project Schedule** — `gantt` renderer: projects as date bars (Start → Due).

Adding a column with a new source is a graph write — no frontend code needed.

### 4. Per-field value suggestions
Every column can turn **existing-value suggestions** on or off
(`Column.suggest`), independently for each field — set it when creating the
surface, or toggle it any time from the **Manage surface** dialog.

When enabled, editing that field (inline in the table or in the Add-row dialog)
opens a combobox that **recommends existing values as you type**: e.g. typing
`Ac` in *Customer Name* on Project Overview suggests `Acme Corp`. Suggestions
are pulled from the underlying node label (all `Customer` nodes — not just the
rows visible in the current surface), so the same field on different surfaces
shares one source of options. New values are still allowed.

| Control | Meaning |
| ------- | ------- |
| `Column.suggest` | on/off for the field |
| `Column.suggestSource` | optional node label to draw options from (defaults to the column's neighbor label, or the surface root label for `self.*` sources) |
| Admin surface creator | columns line format `field|label|source|order|suggest`, e.g. `customer|Customer Name|Customer.name|2|yes` |

`getSurface` returns `suggestions { field values }` for suggest-enabled columns.

### 5. Renderer registry
`Surface.renderer` is graph data; the frontend resolves it through a registry in
`components/renderers/`:

| renderer | what it shows |
| -------- | ------------- |
| `table` | editable DataTable (sorting, filter, inline edit, selection, Load more) |
| `cards` | card grid with per-card selection |
| `form` | record list + editable form (create/update) |
| `board` | kanban lanes grouped by a status-like column; **drag cards between lanes** to re-group (writes the grouping field) |
| `timeline` | vertical feed of records |
| `pivot` | aggregate grid (row dim, col dim, value) with totals |
| `gantt` | date bars across a shared timeline (name, start, due) |

Switch renderers from the **Manage surface** dialog or the admin surface
creator; unknown renderer values fall back to the table with a notice. Pivot and
gantt use the surface's columns positionally (row dim, col dim, value — and
name, start, due), so they're configured entirely in the graph.

### 6. Paged rows, server-side search & filters
`getSurface` returns metadata (columns/permissions/suggestions); rows come from
`surfaceRows(surfaceId, first, after, search, filters, orderBy)` — a cursor
connection (`edges { cursor node }`, `pageInfo`, `totalCount`).

- **search** — free text across every projected column (`contains`, case-insensitive)
- **filters** — per-column `{ field, op, value }` with `eq` / `neq` / `contains` /
  `gt` / `lt`; numeric values compare numerically, empty value matches blank cells
- **orderBy** — `{ field, direction }` over any projected column (nulls last)

Filters/search/order run **inside the row connection**, so `totalCount`, paging,
Load more, the board lanes and CSV export all apply to the filtered set. The
toolbar search box (debounced) and the *Filters* dialog drive them; clicking a
column header sorts. Cursor = base64 offset into the filtered/ordered result.

### 7. Field typing on columns
Every column carries a `type` (`string | number | boolean | date | money`,
default `string`) — graph data, like everything else. Writes are coerced and
validated server-side: `"$12,345.67"` → `12345.67` for money, `"true"`/`yes`/`1`
→ boolean, dates are normalized to `yyyy-mm-dd`, and unparseable values return a
friendly error instead of corrupting the graph. The UI renders type-appropriate
editors: number/date inputs, a yes/no select for booleans, suggestion comboboxes
where enabled. Set the type in the surface creator (`field|label|source|order|suggest|type`)
or the Manage-surface dialog.

### 8. Audit trail
Every row create/update/delete and every surface/column definition change writes
an `AuditEvent` node (`(User)-[:PERFORMED]->(AuditEvent)`) in the same
transaction as the change: actor, action, surface, target and a JSON `changes`
diff (`{ field: { from, to } }` for updates, full values for create/delete).
The admin console's **Audit** tab lists the trail newest-first with Load more;
`auditEvents` is admin-only.

### 9. Guardrails
- **Unique constraints** (created by `npm run seed`) on `User.id`, `Surface.id`,
  `Column.id`, `Role.name`, `Customer.name`, `Status.name`, `Project.id`;
  duplicate creates return friendly errors.
- **Validation** at write time: `rootLabel` must be a valid label, `source` must
  match one of the documented syntaxes, `renderer` must be in the registry.
- **Soft delete** for surfaces: `adminDeleteSurface` archives (`deleted: true`),
  `adminRestoreSurface` brings it back, `adminPurgeSurface` hard-deletes.
  Archived surfaces are hidden from `getSurface`/`listSurfaces` and flagged in
  the admin console.

## API surface

`Query`: `me`, `getSurface` (incl. `suggestions` + column `type`), `surfaceRows(surfaceId, first, after, search, filters, orderBy)` (paged connection), `listSurfaces`, `auditEvents` (admin), `adminUsers`, `adminRoles`, `adminSurfaces`
`Mutation`:
- rows: `createRow`, `updateRow`, `deleteRows` (generic over the surface's root label)
- surface definitions: `updateSurface`, `addColumn`, `updateColumn`, `deleteColumn`
- admin: `adminCreateUser`, `adminUpdateUser`, `adminDeleteUser`, `adminCreateRole`,
  `adminDeleteRole`, `adminAssignRole`, `adminRemoveRole`, `adminGrant`, `adminRevoke`,
  `adminSetOverride`, `adminClearOverride`, `adminCreateSurface`, `adminUpdateSurface`,
  `adminDeleteSurface`, `adminRestoreSurface`, `adminPurgeSurface`

## Graph model

```
(User)-[:HAS_ROLE]->(Role)-[:CAN_ACCESS {view,create,update,delete,export,manage}]->(Surface)
(User)-[:SURFACE_OVERRIDE {view?,create?,...}]->(Surface)   // per-user boolean override
(Surface)-[:HAS_COLUMN]->(Column {field,label,order,source,suggest,suggestSource})  // source: self.prop | >Rel:Label.prop | <Rel:Label.prop | Label.count
(Any root node, e.g. Project)-[:HAS_STATUS]->(Status)        // whatever the sources point at
```

## Roadmap / next steps

Status legend: ✅ implemented · 🔜 next · 💭 later.

### Auth & security
- 🔜 **Real authentication** — replace the demo `x-user-id` header in
  `app/api/graphql/route.ts` with verified JWT claims (Clerk/Auth0/Supabase) so
  `me` and the permission graph map to real sessions instead of a header.
- 🔜 **Row-level security** — surfaces are permission-gated per node type; add
  tenant/owner scoping (`WHERE` clauses derived from the user context) when
  multiple organizations share the graph.

### Surfaces & renderers
- ✅ **Renderer registry** — `table`, `cards`, `form`, `board`, `timeline`,
  `pivot`, `gantt` renderers resolved from `Surface.renderer`; unknown values
  fall back to table.
- ✅ **Board drag-between-lanes** — cards drag between lanes via HTML5 DnD; the
  drop is an `updateRow` on the grouping field (empty = Unassigned), so it works
  for every board surface with a relationship-backed grouping column.
- ✅ **New renderers** — `pivot` (aggregate grid with totals) and `gantt`
  (date bars over a shared timeline), both configured positionally from the
  surface's columns. Seeded surfaces: Project Pivot, Project Schedule.
- 🔜 **Form renderer v2** — multi-record editing, per-field validation rules.
- 💭 **More renderers** — calendar, nested-detail tables; each new renderer is
  one more entry in the registry.

### Data & sources
- ✅ **Typed relationship writes** — `>Rel:Label.prop` / `<Rel:Label.prop`
  sources are read *and* written generically (create/relink neighbors).
- ✅ **Cursor paging** — `surfaceRows(first, after)` connection with
  `totalCount`; the table shows N of M + Load more.
- ✅ **Search & filters server-side** — `surfaceRows(search, filters, orderBy)`
  filters/orders inside the connection; count, paging, board lanes and CSV
  export all respect the filtered set.
- 💭 **Computed/aggregate sources** — e.g. `sum`, `avg`, `max` over typed
  relationships (`>HAS_LINE_ITEM:LineItem.total.sum`), stored as column sources.

### Schema evolution & guardrails
- ✅ **Unique constraints** on node ids/names; friendly duplicate errors.
- ✅ **Write-time validation** of `rootLabel`, column `source`, `renderer`,
  column `type` (and typed value coercion on create/update).
- ✅ **Soft delete** for surfaces (archive / restore / purge).
- ✅ **Field typing on columns** — `string | number | boolean | date | money`
  with per-column validation; type-aware editors in table/form/create dialogs.
- ✅ **Audit trail** — `AuditEvent` nodes on row CRUD and surface/column
  definition changes (actor, action, diff), browsable from the admin console.
- 💭 **Versioned surface definitions** — snapshot a surface's columns on change
  so the "always-evolving UI" can be diffed, rolled back, or A/B-tested.

### Quality & operations
- 🔜 **Row-level permissions demo** — the machinery exists (roles/overrides);
  add row-owner properties and a `rowAccess` hook so surfaces can filter rows.
- 💭 **Integration/webhooks** — emit change events (create/update/delete) so
  other systems can react to graph changes.
- 💭 **Export options** — per-renderer export (cards → PDF, board → markdown),
  column selection, and full-column-set CSV (already exports all pages).

## Production notes

Replace the demo `x-user-id` header context in `app/api/graphql/route.ts` with
verified JWT claims from Clerk/Auth0/Supabase. The server already enforces
permissions on every mutation; add row-level data filtering when multiple
tenants share surfaces.
