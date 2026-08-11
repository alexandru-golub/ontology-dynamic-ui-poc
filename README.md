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
npm run seed        # prints generated passwords unless HAT_PASSWORD is set
npm run dev
```

Open http://localhost:3000 → you are redirected to `/login`. Neo4j Browser: http://localhost:7477 (neo4j / local-dev-password).

**First login:** `npm run seed` seeds three demo accounts (all using `HAT_PASSWORD` from `.env.local`, or random passwords it prints):
`admin_001` / `user_101` / `user_202` / `user_303`. Add real people with
`npm run user:create -- --id alice --name Alice --password secret --roles "Project Manager"` or from the
Admin console → Users → *Set password*.

## Hats & demo accounts

Real people are `User` nodes; **hats are `Role` nodes** (Project Manager, Business
Development, Software Engineer…). A person can wear several hats; the session
remembers which hat is active, and permission checks resolve through *that* hat
only — so switching hats literally shows you what each hat can see. Wearing no
hat = the union of every role you hold. Invited people get their own `User`
account (admin console → *Set password*) plus the hats you assign.

| Account | Hats (roles) | Capabilities |
| ------- | ------------ | ------------ |
| Ada Admin (`admin_001`) | Admin | Super admin — everything + **Admin console** (users, passwords, roles, grants, surfaces, **audit trail**) |
| John Doe (`user_101`) | Project Manager | Row CRUD on Project Overview (delete via override), manage Customer Portfolio, drag board cards, multi-record editing on Project Intake |
| Jane Smith (`user_202`) | Business Development | Read-only + export everywhere; create/edit on Project Intake |
| Sam Rivera (`user_303`) | Software Engineer | Read-only + export; update statuses on Project Board |

## The ideas

### 1. DB-backed auth & hats
Authentication is graph-native — no external identity provider, no JWTs.

- **Passwords** are bcrypt-hashed (`bcryptjs`) and stored on the `User` node
  (`passwordHash`). Set/reset them from the Admin console (*Set password*) or
  the `user:create` CLI.
- **Sessions live in Neo4j**: login mints a random opaque token, stores only its
  SHA-256 hash on a `Session` node (`(User)-[:HAS_SESSION]->(Session {tokenHash,
  expiresAt, roleName})`), and hands the token to the browser in an httpOnly,
  SameSite=Lax cookie. Every API request resolves the user by looking the hash
  up in the graph; logout deletes the node. A leaked database cannot replay
  sessions.
- **Hats** are roles: `Session.roleName` records the hat currently worn.
  `fetchPermissions`/`listSurfaces` filter grants by that role, so wearing the
  *Project Manager* hat shows PM surfaces with PM permissions, and wearing
  *Software Engineer* shows the engineer view. The 🎩 menu in the header
  switches hats (any hat you hold) or clears back to *All hats*.
- **Audit**: login, logout and hat switches are recorded as `AuditEvent`s
  (action `LOGIN` / `LOGOUT` / `HAT`), alongside row/surface changes.
- **Enforcement**: the GraphQL route resolves the user from the cookie
  server-side (the old `x-user-id` header is gone); middleware redirects
  anonymous page loads to `/login` and answers API calls with 401 JSON. Local
  dev can set `AUTH_BYPASS_USER` to skip login entirely — never in production.

### 2. Admin console
A super-privileged user (`User.isAdmin = true`) bypasses all permission checks
and gets an **Admin console** in the sidebar with three tabs:
- **Users** — create/delete users, toggle admin, assign/remove roles
- **Roles** — create/delete roles, edit per-surface grants (view/create/update/delete/export/manage)
- **Surfaces** — create surfaces (root label + columns), open/delete them

All `admin*` GraphQL mutations are guarded by `requireAdmin` server-side — the
UI hiding is not the security boundary.

### 3. shadcn/ui
MUI was removed entirely (page bundle: 249 kB → ~73 kB). Components live
in `components/ui/*` (button, dialog, select, tabs, checkbox, table, badge,
alert, card, input, label, textarea) built on Radix primitives + Tailwind v4.

### 4. Multi-source surfaces
A surface is rooted at a node label (`Surface.rootLabel`) and each column
carries a `source` that tells the projector where to pull the value from:

| Source | Meaning | Example |
| ------ | ------- | ------- |
| `self.<prop>` | property on the row's root node | `self.budget` |
| `<Label>.<prop>` | property of a *neighboring* node of that label (any relationship) | `Customer.name`, `Status.name`, `Role.name` |
| `<Label>.count` | number of neighboring nodes of that label | `Project.count` |
| `<Label>.<prop>.sum` / `.avg` / `.min` / `.max` | numeric aggregate over neighboring nodes (any relationship) | `Project.budget.sum` |
| `>Rel:Label.<prop>.sum` / `.avg` / `.min` / `.max` | numeric aggregate over a **typed** relationship | `>HAS_PROJECT:Project.budget.avg` |
| `<Rel:Label.<prop>.sum` / `.avg` / `.min` / `.max` | same, incoming relationship | `<HAS_TASK:Task.estimate.max` |
| `>Rel:Label.<prop>` | property of a node reached via an **outgoing** typed relationship | `>HAS_STATUS:Status.name` |
| `<Rel:Label.<prop>` | property of a node reached via an **incoming** typed relationship | `<HAS_PROJECT:Customer.name` |
| `>Rel:Label.count` / `<Rel:Label.count` | count over a typed relationship | `<HAS_PROJECT:Project.count` |

Typed sources make the relationship explicit, so **row writes** can create/relink
those neighbors generically (any `Label.prop` column with a known relationship
is writable — not just the hardcoded Customer/Status/Role set).

**Aggregate sources** (`sum`/`avg`/`min`/`max`) compute numeric rollups over the
matched neighbors — e.g. a customer's total project budget. They are
**read-only** (derived values are never written back) and work with
server-side filters/search/sort like any other column. Each aggregate runs in
its own `CALL { }` subquery so the value is exact even when a surface mixes
several multi-match columns (plain `OPTIONAL MATCH` chains multiply rows, which
would corrupt `sum`).

Seeded surfaces:
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
- **Project Intake** — `form` renderer: record list + single/multi-record editor with
  per-field validation rules (required, min/max budget, enum Priority) demoed end-to-end.
- **Customer Analytics** — `table` renderer: **aggregate sources** — for every
  customer: project count, total / average / largest / smallest project budget
  computed from `>HAS_PROJECT:Project.budget.sum|avg|min|max`.
- **Project Calendar** — `calendar` renderer: month grid of projects
  (name, start, due) with multi-day bars across cells and prev/next/today
  navigation.

Adding a column with a new source is a graph write — no frontend code needed.

### 5. Per-field value suggestions
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
| Admin surface creator | columns line format `field|label|source|order|suggest|type|required|min|max|minLength|maxLength|pattern|options`, e.g. `priority|Priority|self.priority|5|no|string|yes|Low,Medium,High` |

`getSurface` returns `suggestions { field values }` for suggest-enabled columns.

### 6. Renderer registry
`Surface.renderer` is graph data; the frontend resolves it through a registry in
`components/renderers/`:

| renderer | what it shows |
| -------- | ------------- |
| `table` | editable DataTable (sorting, filter, inline edit, selection, Load more) |
| `cards` | card grid with per-card selection |
| `form` | record list + editable form — v2: **multi-record (bulk) editing** + per-field validation errors |
| `board` | kanban lanes grouped by a status-like column; **drag cards between lanes** to re-group (writes the grouping field) |
| `timeline` | vertical feed of records |
| `pivot` | aggregate grid (row dim, col dim, value) with totals |
| `gantt` | date bars across a shared timeline (name, start, due) |
| `calendar` | month grid of events (title, start, due) with prev/next navigation; multi-day events span cells as bars |

Switch renderers from the **Manage surface** dialog or the admin surface
creator; unknown renderer values fall back to the table with a notice. Pivot and
gantt use the surface's columns positionally (row dim, col dim, value — and
name, start, due), so they're configured entirely in the graph.

### 7. Paged rows, server-side search & filters
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

### 8. Field typing on columns
Every column carries a `type` (`string | number | boolean | date | money`,
default `string`) — graph data, like everything else. Writes are coerced and
validated server-side: `"$12,345.67"` → `12345.67` for money, `"true"`/`yes`/`1`
→ boolean, dates are normalized to `yyyy-mm-dd`, and unparseable values return a
friendly error instead of corrupting the graph. The UI renders type-appropriate
editors: number/date inputs, a yes/no select for booleans, suggestion comboboxes
where enabled. Set the type in the surface creator (`field|label|source|order|suggest|type`)
or the Manage-surface dialog.

### 9. Per-field validation rules + form renderer v2
Every column can carry **validation rules as graph data** — same as everything else
in this app. They are stored on the `Column` node, returned in
`ColumnMetadata`, and **enforced server-side on every write** (`createRow`,
`updateRow` — including table inline edits, board drags and the form):

| Rule | Meaning | Example |
| ---- | ------- | ------- |
| `required` | value must be non-blank | `required: true` on Customer |
| `min` / `max` | numeric lower/upper bound (number/money columns) | Budget `min: 0, max: 1000000` |
| `minLength` / `maxLength` | string length bounds | Project Title `minLength: 4, maxLength: 120` |
| `pattern` | value must match a regex | `^[A-Z]{2}\d{4}$` for a code field |
| `options` | enum — value must be one of the listed strings (renders a dropdown) | Priority `["Low","Medium","High"]` |
| `validationMessage` | optional custom error text | "Project title must be 4-120 characters" |

Validation is checked **client-side first** (instant inline errors, no wasted
round-trips) and **again server-side** on every mutation — the server is the
security boundary, so a bad value can never corrupt the graph no matter how it
is sent. Server errors aggregate all failing fields into one message
(`extensions.fields` lists them).

**Form renderer v2** builds on that:
- **Multi-record editing** — tick several records in the list to open a bulk
  editor; tick a field, type the new value, and it is applied to every selected
  record (unticked fields stay untouched). Each record still gets its own
  `updateRow` + audit event.
- **Inline validation** — required/enum/range/length/pattern errors render under
  the field with a destructive border; the form never submits an invalid record.
- Options columns render as dropdowns; enum values also feed suggestions.

Set rules when creating a surface (admin console, extended column line) or any
time from **Manage surface → Edit column**.

### 10. Audit trail
Every row create/update/delete and every surface/column definition change writes
an `AuditEvent` node (`(User)-[:PERFORMED]->(AuditEvent)`) in the same
transaction as the change: actor, action, surface, target and a JSON `changes`
diff (`{ field: { from, to } }` for updates, full values for create/delete).
The admin console's **Audit** tab lists the trail newest-first with Load more;
`auditEvents` is admin-only.

### 11. Guardrails
- **Unique constraints** (created by `npm run seed`) on `User.id`, `Surface.id`,
  `Column.id`, `Role.name`, `Customer.name`, `Status.name`, `Project.id`;
  duplicate creates return friendly errors.
- **Validation** at write time: `rootLabel` must be a valid label, `source` must
  match one of the documented syntaxes, `renderer` must be in the registry,
  column `type` must be known, and **per-column validation rules**
  (`required`/`min`/`max`/`minLength`/`maxLength`/`pattern`/`options`) are
  enforced on every row write (all renderers, all entry points).
- **Soft delete** for surfaces: `adminDeleteSurface` archives (`deleted: true`),
  `adminRestoreSurface` brings it back, `adminPurgeSurface` hard-deletes.
  Archived surfaces are hidden from `getSurface`/`listSurfaces` and flagged in
  the admin console.

## API surface

**Auth routes:** `POST /api/auth/login` (username+password → httpOnly session cookie),
`POST /api/auth/logout`, `GET /api/auth/session` (current user + hats),
`POST /api/auth/hat` (switch active hat).

`Query`: `me`, `getSurface` (incl. `suggestions`, column `type` **and validation rules**), `surfaceRows(surfaceId, first, after, search, filters, orderBy)` (paged connection), `listSurfaces`, `auditEvents` (admin), `adminUsers`, `adminRoles`, `adminSurfaces`
`Mutation`:
- rows: `createRow`, `updateRow`, `deleteRows` (generic over the surface's root label)
- surface definitions: `updateSurface`, `addColumn`, `updateColumn`, `deleteColumn`
- admin: `adminCreateUser`, `adminUpdateUser`, `adminDeleteUser`, `adminSetPassword`, `adminCreateRole`,
  `adminDeleteRole`, `adminAssignRole`, `adminRemoveRole`, `adminGrant`, `adminRevoke`,
  `adminSetOverride`, `adminClearOverride`, `adminCreateSurface`, `adminUpdateSurface`,
  `adminDeleteSurface`, `adminRestoreSurface`, `adminPurgeSurface`

## Graph model

```
(User)-[:HAS_ROLE]->(Role)-[:CAN_ACCESS {view,create,update,delete,export,manage}]->(Surface)
(User)-[:SURFACE_OVERRIDE {view?,create?,...}]->(Surface)   // per-user boolean override
(User {id,name,isAdmin,passwordHash})-[:HAS_SESSION]->(Session {tokenHash,expiresAt,roleName})  // roleName = active hat
(Surface)-[:HAS_COLUMN]->(Column {field,label,order,source,suggest,suggestSource,type,required,min,max,minLength,maxLength,pattern,options,validationMessage})  // source: self.prop | >Rel:Label.prop | <Rel:Label.prop | Label.count
(Any root node, e.g. Project)-[:HAS_STATUS]->(Status)        // whatever the sources point at
```

## Roadmap / next steps

Status legend: ✅ implemented · 🔜 next · 💭 later.

### Auth & security
- ✅ **DB-backed authentication** — bcrypt passwords on `User`, sessions stored
  in the graph (`Session` nodes, hashed tokens, httpOnly cookie), logout
  revokes, login/logout/hat-switch audited. No external identity provider.
- ✅ **Hats = roles** — real people are `User`s; hats are `Role`s; the session
  wears one hat at a time so each hat sees only its surfaces/permissions
  (plus an *All hats* mode). Invite people by creating a user + setting a
  password + assigning roles.
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
- ✅ **Form renderer v2** — multi-record (bulk) editing + per-field validation
  rules (required / min / max / minLength / maxLength / pattern / options),
  enforced server-side on every write and shown inline in the form, create
  dialog and table editor.
- ✅ **Calendar renderer** — month grid (title, start, due), prev/next/today
  navigation, multi-day events as spanning bars, "+N more" overflow per day,
  missing-date list — another entry in the renderer registry.
- 💭 **More renderers** — nested-detail tables; each new renderer is one more
  entry in the registry.

### Data & sources
- ✅ **Typed relationship writes** — `>Rel:Label.prop` / `<Rel:Label.prop`
  sources are read *and* written generically (create/relink neighbors).
- ✅ **Cursor paging** — `surfaceRows(first, after)` connection with
  `totalCount`; the table shows N of M + Load more.
- ✅ **Search & filters server-side** — `surfaceRows(search, filters, orderBy)`
  filters/orders inside the connection; count, paging, board lanes and CSV
  export all respect the filtered set.
- ✅ **Computed/aggregate sources** — `sum` / `avg` / `min` / `max` over typed
  relationships (`>HAS_PROJECT:Project.budget.sum`) or any-neighbor
  (`Project.budget.avg`); read-only columns, exact under multi-match surfaces
  (isolated `CALL` subqueries), filterable/sortable/searchable like any column.
- 💭 **More aggregate shapes** — `count` distinct props, date-bucketed rollups,
  and aggregate *writes* (recompute-on-write) are natural next steps.

### Schema evolution & guardrails
- ✅ **Unique constraints** on node ids/names; friendly duplicate errors.
- ✅ **Write-time validation** of `rootLabel`, column `source`, `renderer`,
  column `type` (and typed value coercion on create/update).
- ✅ **Soft delete** for surfaces (archive / restore / purge).
- ✅ **Field typing on columns** — `string | number | boolean | date | money`
  with per-column validation; type-aware editors in table/form/create dialogs.
- ✅ **Per-column validation rules** — `required`, `min`/`max`,
  `minLength`/`maxLength`, `pattern`, `options` (enum) and custom messages as
  graph data on `Column`; enforced on every mutation server-side with
  aggregated error reporting, and surfaced inline in the form renderer.
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

Auth is fully DB-backed (see section 1); run it behind Cloudflare Zero Trust (or
any VPN) and set `HAT_PASSWORD`/real per-user passwords. The server enforces
permissions on every mutation; add row-level data filtering when multiple
tenants share surfaces. Back up the Neo4j data directory (`neo4j/data`) — it
holds rows, definitions, sessions and the audit trail.
