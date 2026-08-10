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
| Ada Admin (`admin_001`) | Super admin (`isAdmin: true`) | Everything + **Admin console** (users, roles, grants, overrides, surfaces) |
| John Doe (`user_101`) | Sales | Row CRUD on Project Overview (delete via override), manage on Customer Portfolio |
| Jane Smith (`user_202`) | Analyst | Read-only + export everywhere |

## The three ideas

### 1. Admin console
A super-privileged user (`User.isAdmin = true`) bypasses all permission checks
and gets an **Admin console** in the sidebar with three tabs:
- **Users** — create/delete users, toggle admin, assign/remove roles
- **Roles** — create/delete roles, edit per-surface grants (view/create/update/delete/export/manage)
- **Surfaces** — create surfaces (root label + columns), open/delete them

All `admin*` GraphQL mutations are guarded by `requireAdmin` server-side — the
UI hiding is not the security boundary.

### 2. shadcn/ui
MUI was removed entirely (bundle: 249 kB → 69 kB for the page). Components live
in `components/ui/*` (button, dialog, select, tabs, checkbox, table, badge,
alert, card, input, label, textarea) built on Radix primitives + Tailwind v4.

### 3. Multi-source surfaces
A surface is rooted at a node label (`Surface.rootLabel`) and each column
carries a `source` that tells the projector where to pull the value from:

| Source | Meaning | Example |
| ------ | ------- | ------- |
| `self.<prop>` | property on the row's root node | `self.budget` |
| `<Label>.<prop>` | property of a *neighboring* node of that label | `Customer.name`, `Status.name`, `Role.name` |
| `<Label>.count` | number of neighboring nodes of that label | `Project.count` |

Seeded examples of one surface mixing many node types:
- **Project Overview** — rows are `Project` nodes; columns come from the
  project itself (`name`, `owner`, `budget`), its `Customer` and its `Status`.
- **Customer Portfolio** — rows are `Customer` nodes; columns show the
  customer's own name, the *count* of their projects, the name of one linked
  project and the largest project budget.
- **People & Roles** — rows are `User` nodes; columns come from the user
  (`name`, `isAdmin`) and their linked `Role`.

Adding a column with a new source is a graph write — no frontend code needed.

## API surface

`Query`: `me`, `getSurface`, `listSurfaces`, `adminUsers`, `adminRoles`, `adminSurfaces`
`Mutation`:
- rows: `createRow`, `updateRow`, `deleteRows` (generic over the surface's root label)
- surface definitions: `updateSurface`, `addColumn`, `updateColumn`, `deleteColumn`
- admin: `adminCreateUser`, `adminUpdateUser`, `adminDeleteUser`, `adminCreateRole`,
  `adminDeleteRole`, `adminAssignRole`, `adminRemoveRole`, `adminGrant`, `adminRevoke`,
  `adminSetOverride`, `adminClearOverride`, `adminCreateSurface`, `adminUpdateSurface`,
  `adminDeleteSurface`

## Graph model

```
(User)-[:HAS_ROLE]->(Role)-[:CAN_ACCESS {view,create,update,delete,export,manage}]->(Surface)
(User)-[:SURFACE_OVERRIDE {view?,create?,...}]->(Surface)   // per-user boolean override
(Surface)-[:HAS_COLUMN]->(Column {field,label,order,source})
(Any root node, e.g. Project)-[:HAS_STATUS]->(Status)        // whatever the sources point at
```

## Production notes

Replace the demo `x-user-id` header context in `app/api/graphql/route.ts` with
verified JWT claims from Clerk/Auth0/Supabase. The server already enforces
permissions on every mutation; add row-level data filtering when multiple
tenants share surfaces.
