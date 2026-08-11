"use client";

import { gql, useApolloClient, useMutation, useQuery } from "@apollo/client";
import { Plus, Shield, Trash2, UserCog } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDemoUser } from "@/components/apollo-provider";

// ---------------------------------------------------------------------------
// GraphQL
// ---------------------------------------------------------------------------
const ADMIN_USERS = gql`
  query AdminUsers {
    adminUsers {
      id
      name
      isAdmin
      roles
    }
  }
`;

const ADMIN_ROLES = gql`
  query AdminRoles {
    adminRoles {
      id
      name
      grants {
        surfaceId
        surfaceTitle
        permissions {
          view
          create
          update
          delete
          export
          manage
        }
      }
    }
  }
`;

const ADMIN_SURFACES = gql`
  query AdminSurfaces {
    adminSurfaces {
      id
      title
      renderer
      rootLabel
      columnCount
      deleted
    }
  }
`;

const CREATE_USER = gql`
  mutation AdminCreateUser($input: AdminUserInput!) {
    adminCreateUser(input: $input) {
      id
      name
      isAdmin
      roles
    }
  }
`;

const UPDATE_USER = gql`
  mutation AdminUpdateUser($id: ID!, $input: AdminUserPatch!) {
    adminUpdateUser(id: $id, input: $input) {
      id
      name
      isAdmin
      roles
    }
  }
`;

const DELETE_USER = gql`
  mutation AdminDeleteUser($id: ID!) {
    adminDeleteUser(id: $id)
  }
`;

const ASSIGN_ROLE = gql`
  mutation AdminAssignRole($userId: ID!, $roleName: String!) {
    adminAssignRole(userId: $userId, roleName: $roleName) {
      id
      roles
    }
  }
`;

const REMOVE_ROLE = gql`
  mutation AdminRemoveRole($userId: ID!, $roleName: String!) {
    adminRemoveRole(userId: $userId, roleName: $roleName) {
      id
      roles
    }
  }
`;

const CREATE_ROLE = gql`
  mutation AdminCreateRole($name: String!) {
    adminCreateRole(name: $name) {
      id
      name
    }
  }
`;

const DELETE_ROLE = gql`
  mutation AdminDeleteRole($name: String!) {
    adminDeleteRole(name: $name)
  }
`;

const GRANT = gql`
  mutation AdminGrant($roleName: String!, $surfaceId: ID!, $permissions: PermissionInput!) {
    adminGrant(roleName: $roleName, surfaceId: $surfaceId, permissions: $permissions) {
      id
      name
    }
  }
`;

const REVOKE = gql`
  mutation AdminRevoke($roleName: String!, $surfaceId: ID!) {
    adminRevoke(roleName: $roleName, surfaceId: $surfaceId) {
      id
      name
    }
  }
`;

const CREATE_SURFACE = gql`
  mutation AdminCreateSurface($input: AdminSurfaceInput!) {
    adminCreateSurface(input: $input) {
      id
      title
      rootLabel
    }
  }
`;

const DELETE_SURFACE = gql`
  mutation AdminDeleteSurface($id: ID!) {
    adminDeleteSurface(id: $id)
  }
`;

const RESTORE_SURFACE = gql`
  mutation AdminRestoreSurface($id: ID!) {
    adminRestoreSurface(id: $id)
  }
`;

const PURGE_SURFACE = gql`
  mutation AdminPurgeSurface($id: ID!) {
    adminPurgeSurface(id: $id)
  }
`;

const AUDIT_EVENTS = gql`
  query AuditEvents($first: Int, $after: String) {
    auditEvents(first: $first, after: $after) {
      totalCount
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        cursor
        node {
          id
          at
          actorId
          actorName
          action
          surfaceId
          surfaceTitle
          targetId
          targetLabel
          changes
        }
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type AuditEvent = {
  id: string;
  at: string;
  actorId: string;
  actorName: string;
  action: string;
  surfaceId: string | null;
  surfaceTitle: string | null;
  targetId: string | null;
  targetLabel: string | null;
  changes: unknown;
};
type Permissions = { view: boolean; create: boolean; update: boolean; delete: boolean; export: boolean; manage: boolean };
type AdminUser = { id: string; name: string; isAdmin: boolean; roles: string[] };
type RoleGrant = { surfaceId: string; surfaceTitle: string; permissions: Permissions };
type RoleInfo = { id: string; name: string; grants: RoleGrant[] };
type AdminSurface = { id: string; title: string; renderer: string; rootLabel: string; columnCount: number; deleted: boolean };

const RENDERERS = ["table", "cards", "form", "board", "timeline", "pivot", "gantt", "calendar"];

const PERMISSION_LABELS: Array<[keyof Permissions, string]> = [
  ["view", "View"],
  ["create", "Create"],
  ["update", "Update"],
  ["delete", "Delete"],
  ["export", "Export"],
  ["manage", "Manage"],
];

const EMPTY_PERMS: Permissions = { view: false, create: false, update: false, delete: false, export: false, manage: false };

/** Extract only the six permission keys (query results carry Apollo __typename). */
function pickPerms(source?: Partial<Permissions> | null): Permissions {
  const out = { ...EMPTY_PERMS };
  for (const [key] of PERMISSION_LABELS) {
    const value = source?.[key];
    if (typeof value === "boolean") out[key] = value;
  }
  return out;
}

function grantSummary(grants: RoleGrant[]) {
  if (grants.length === 0) return <span className="text-muted-foreground">no grants</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {grants.map((grant) => (
        <Badge key={grant.surfaceId} variant="secondary" className="font-mono text-[10px]">
          {grant.surfaceTitle}:{" "}
          {(["view", "create", "update", "delete", "export", "manage"] as const)
            .filter((key) => grant.permissions[key])
            .map((key) => key[0])
            .join("")}
        </Badge>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Admin panel
// ---------------------------------------------------------------------------
export function AdminPanel({ onOpenSurface }: { onOpenSurface: (surfaceId: string, title: string) => void }) {
  const { user: me } = useDemoUser();
  const usersQuery = useQuery<{ adminUsers: AdminUser[] }>(ADMIN_USERS, { fetchPolicy: "no-cache" });
  const rolesQuery = useQuery<{ adminRoles: RoleInfo[] }>(ADMIN_ROLES, { fetchPolicy: "no-cache" });
  const surfacesQuery = useQuery<{ adminSurfaces: AdminSurface[] }>(ADMIN_SURFACES, { fetchPolicy: "no-cache" });

  const [createUser] = useMutation(CREATE_USER);
  const [updateUser] = useMutation(UPDATE_USER);
  const [deleteUser] = useMutation(DELETE_USER);
  const [assignRole] = useMutation(ASSIGN_ROLE);
  const [removeRole] = useMutation(REMOVE_ROLE);
  const [createRole] = useMutation(CREATE_ROLE);
  const [deleteRole] = useMutation(DELETE_ROLE);
  const [grant] = useMutation(GRANT);
  const [revoke] = useMutation(REVOKE);
  const [createSurface] = useMutation(CREATE_SURFACE);
  const [deleteSurface] = useMutation(DELETE_SURFACE);
  const [restoreSurface] = useMutation(RESTORE_SURFACE);
  const [purgeSurface] = useMutation(PURGE_SURFACE);

  const [notice, setNotice] = useState<string | null>(null);
  // dialogs
  const [newUserOpen, setNewUserOpen] = useState(false);
  const [newUser, setNewUser] = useState({ id: "", name: "", isAdmin: false });
  const [rolesFor, setRolesFor] = useState<AdminUser | null>(null);
  const [newRoleOpen, setNewRoleOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [grantsFor, setGrantsFor] = useState<RoleInfo | null>(null);
  const [grantSurface, setGrantSurface] = useState("");
  const [grantPerms, setGrantPerms] = useState<Permissions>(EMPTY_PERMS);
  const [newSurfaceOpen, setNewSurfaceOpen] = useState(false);
  const [newSurface, setNewSurface] = useState({ id: "", title: "", rootLabel: "Project", renderer: "table", columns: "" });

  // ---- audit trail (paged, newest first) ----
  const client = useApolloClient();
  const [audit, setAudit] = useState<{ events: AuditEvent[]; hasNextPage: boolean; endCursor: string | null; totalCount: number }>({
    events: [],
    hasNextPage: false,
    endCursor: null,
    totalCount: 0,
  });
  const loadAudit = useCallback(async (after?: string | null, append = false) => {
    const { data } = await client.query<{
      auditEvents: {
        totalCount: number;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        edges: Array<{ node: AuditEvent }>;
      };
    }>({ query: AUDIT_EVENTS, variables: { first: 50, after: after ?? undefined }, fetchPolicy: "no-cache" });
    const conn = data.auditEvents;
    setAudit((prev) => ({
      events: append ? [...prev.events, ...conn.edges.map((e) => e.node)] : conn.edges.map((e) => e.node),
      hasNextPage: conn.pageInfo.hasNextPage,
      endCursor: conn.pageInfo.endCursor,
      totalCount: conn.totalCount,
    }));
  }, [client]);

  useEffect(() => {
    void loadAudit(null);
  }, [loadAudit]);

  const refetchAll = async () => {
    await Promise.all([usersQuery.refetch(), rolesQuery.refetch(), surfacesQuery.refetch(), loadAudit(null)]);
  };

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setNotice(ok);
      await refetchAll();
    } catch (err) {
      setNotice(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const openGrantDialog = (role: RoleInfo) => {
    setGrantsFor(role);
    const first = role.grants[0];
    setGrantSurface(first?.surfaceId ?? "");
    setGrantPerms(pickPerms(first?.permissions));
  };

  const saveGrant = async () => {
    if (!grantsFor || !grantSurface) return;
    await run(() => grant({ variables: { roleName: grantsFor.name, surfaceId: grantSurface, permissions: pickPerms(grantPerms) } }), "Grant saved.");
    setGrantsFor(null);
  };

  const saveRevoke = async () => {
    if (!grantsFor || !grantSurface) return;
    await run(() => revoke({ variables: { roleName: grantsFor.name, surfaceId: grantSurface } }), "Grant revoked.");
    setGrantsFor(null);
  };

  const toggleRole = async (target: AdminUser, roleName: string, checked: boolean) => {
    await run(
      () =>
        checked
          ? assignRole({ variables: { userId: target.id, roleName } })
          : removeRole({ variables: { userId: target.id, roleName } }),
      checked ? `Assigned ${roleName} to ${target.name}.` : `Removed ${roleName} from ${target.name}.`,
    );
    if (rolesFor?.id === target.id) {
      const fresh = usersQuery.data?.adminUsers.find((u) => u.id === target.id);
      if (fresh) setRolesFor(fresh);
    }
  };

  const submitNewUser = async () => {
    if (!newUser.id.trim() || !newUser.name.trim()) return setNotice("User id and name are required.");
    await run(
      () => createUser({ variables: { input: { id: newUser.id.trim(), name: newUser.name.trim(), isAdmin: newUser.isAdmin } } }),
      `Created user ${newUser.name}.`,
    );
    setNewUserOpen(false);
    setNewUser({ id: "", name: "", isAdmin: false });
  };

  const submitNewRole = async () => {
    if (!newRoleName.trim()) return setNotice("Role name is required.");
    await run(() => createRole({ variables: { name: newRoleName.trim() } }), `Created role ${newRoleName}.`);
    setNewRoleOpen(false);
    setNewRoleName("");
  };

  const submitNewSurface = async () => {
    const columns = newSurface.columns
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        // field|label|source|order|suggest|type|required|min|max|minLength|maxLength|pattern|options
        const parts = line.split("|").map((s) => s?.trim());
        const [field, label, source, order, suggest, type, required, min, max, minLength, maxLength, pattern, options] = parts;
        const num = (value: string | undefined) => (value === undefined || value === "" ? undefined : Number(value));
        return {
          field,
          label,
          source: source || undefined,
          order: num(order),
          suggest: ["yes", "1", "true"].includes((suggest ?? "").toLowerCase()),
          type: type || undefined,
          required: ["yes", "1", "true"].includes((required ?? "").toLowerCase()),
          min: num(min),
          max: num(max),
          minLength: num(minLength),
          maxLength: num(maxLength),
          pattern: pattern || undefined,
          options: options ? options.split(",").map((o) => o.trim()).filter(Boolean) : undefined,
        };
      })
      .filter((c) => c.field && c.label);
    if (!newSurface.id.trim() || !newSurface.title.trim()) return setNotice("Surface id and title are required.");
    await run(
      () =>
        createSurface({
          variables: {
            input: {
              id: newSurface.id.trim(),
              title: newSurface.title.trim(),
              rootLabel: newSurface.rootLabel.trim() || "Project",
              renderer: newSurface.renderer.trim() || "table",
              columns,
            },
          },
        }),
      `Created surface ${newSurface.title}.`,
    );
    setNewSurfaceOpen(false);
    setNewSurface({ id: "", title: "", rootLabel: "Project", renderer: "table", columns: "" });
  };

  const users = usersQuery.data?.adminUsers ?? [];
  const roles = rolesQuery.data?.adminRoles ?? [];
  const surfaces = surfacesQuery.data?.adminSurfaces ?? [];

  return (
    <div className="space-y-4">
      {notice && (
        <div className="rounded-md border border-primary/40 bg-card px-4 py-2 text-sm">
          <span className="flex items-center justify-between">
            {notice}
            <button onClick={() => setNotice(null)} className="text-muted-foreground hover:text-foreground" aria-label="Dismiss">
              ✕
            </button>
          </span>
        </div>
      )}

      <Tabs defaultValue="users">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="roles">Roles</TabsTrigger>
            <TabsTrigger value="surfaces">Surfaces</TabsTrigger>
            <TabsTrigger value="audit">Audit</TabsTrigger>
          </TabsList>
          <Button size="sm" onClick={() => setNewUserOpen(true)}>
            <Plus /> New user
          </Button>

        </div>

        {/* ---------------- Users ---------------- */}
        <TabsContent value="users">
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead>Admin</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead className="w-40 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{u.id}</TableCell>
                    <TableCell>{u.isAdmin ? <Badge variant="success"><Shield className="h-3 w-3" /> admin</Badge> : <Badge variant="secondary">no</Badge>}</TableCell>
                    <TableCell>
                      <span className="flex flex-wrap gap-1">
                        {u.roles.length === 0 && <span className="text-muted-foreground">—</span>}
                        {u.roles.map((r) => (
                          <Badge key={r} variant="secondary">{r}</Badge>
                        ))}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="inline-flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => setRolesFor(u)}>
                          <UserCog /> Roles
                        </Button>
                        {!u.isAdmin && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              run(() => updateUser({ variables: { id: u.id, input: { isAdmin: true } } }), `${u.name} is now admin.`)
                            }
                          >
                            Make admin
                          </Button>
                        )}
                        {u.id !== me.id && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() =>
                              run(() => deleteUser({ variables: { id: u.id } }), `Deleted user ${u.name}.`)
                            }
                            aria-label={`Delete user ${u.name}`}
                          >
                            <Trash2 />
                          </Button>
                        )}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ---------------- Roles ---------------- */}
        <TabsContent value="roles">
          <div className="mb-2 flex justify-end">
            <Button size="sm" onClick={() => setNewRoleOpen(true)}>
              <Plus /> New role
            </Button>
          </div>
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead>Grants (surface: permissions)</TableHead>
                  <TableHead className="w-40 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roles.map((role) => (
                  <TableRow key={role.name}>
                    <TableCell className="font-medium">{role.name}</TableCell>
                    <TableCell>{grantSummary(role.grants)}</TableCell>
                    <TableCell className="text-right">
                      <span className="inline-flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => openGrantDialog(role)}>
                          Grants
                        </Button>
                        {role.name !== "Admin" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() => run(() => deleteRole({ variables: { name: role.name } }), `Deleted role ${role.name}.`)}
                            aria-label={`Delete role ${role.name}`}
                          >
                            <Trash2 />
                          </Button>
                        )}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ---------------- Surfaces ---------------- */}
        <TabsContent value="surfaces">
          <div className="mb-2 flex justify-end">
            <Button size="sm" onClick={() => setNewSurfaceOpen(true)}>
              <Plus /> New surface
            </Button>
          </div>
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Surface</TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead>Root label</TableHead>
                  <TableHead>Renderer</TableHead>
                  <TableHead>Columns</TableHead>
                  <TableHead className="w-40 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {surfaces.map((s) => (
                  <TableRow key={s.id} className={s.deleted ? "opacity-60" : ""}>
                    <TableCell className="font-medium">
                      {s.title}
                      {s.deleted && <Badge variant="warning" className="ml-2">archived</Badge>}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{s.id}</TableCell>
                    <TableCell><Badge variant="outline" className="font-mono">{s.rootLabel}</Badge></TableCell>
                    <TableCell>{s.renderer}</TableCell>
                    <TableCell>{s.columnCount}</TableCell>
                    <TableCell className="text-right">
                      <span className="inline-flex gap-1">
                        {!s.deleted && (
                          <Button size="sm" variant="outline" onClick={() => onOpenSurface(s.id, s.title)}>
                            Open
                          </Button>
                        )}
                        {!s.deleted ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() => run(() => deleteSurface({ variables: { id: s.id } }), `Archived ${s.title} (soft delete).`)}
                            aria-label={`Archive surface ${s.title}`}
                          >
                            Archive
                          </Button>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => run(() => restoreSurface({ variables: { id: s.id } }), `Restored ${s.title}.`)}
                            >
                              Restore
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => run(() => purgeSurface({ variables: { id: s.id } }), `Permanently deleted ${s.title}.`)}
                              aria-label={`Permanently delete ${s.title}`}
                            >
                              <Trash2 />
                            </Button>
                          </>
                        )}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ---------------- Audit ---------------- */}
        <TabsContent value="audit">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {audit.totalCount} event{audit.totalCount === 1 ? "" : "s"} — who changed which row/surface/column and when.
            </p>
            <Button size="sm" variant="outline" onClick={() => void loadAudit(null)}>Refresh</Button>
          </div>
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">When</TableHead>
                  <TableHead className="w-36">Who</TableHead>
                  <TableHead className="w-24">Action</TableHead>
                  <TableHead>Surface</TableHead>
                  <TableHead className="w-24">Target</TableHead>
                  <TableHead>Changes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {audit.events.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      No audit events yet — mutations on rows/surfaces/columns are logged here.
                    </TableCell>
                  </TableRow>
                )}
                {audit.events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">
                      {new Date(event.at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{event.actorName}</span>
                      <span className="ml-1 font-mono text-[10px] text-muted-foreground">{event.actorId}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={event.action === "DELETE" ? "destructive" : event.action === "CREATE" ? "success" : "secondary"}>
                        {event.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{event.surfaceTitle ?? event.surfaceId ?? "—"}</TableCell>
                    <TableCell>
                      <span className="font-mono text-[10px] text-muted-foreground">{event.targetLabel ?? ""}</span>
                    </TableCell>
                    <TableCell className="max-w-md">
                      <code className="block truncate font-mono text-[10px] text-muted-foreground" title={JSON.stringify(event.changes)}>
                        {JSON.stringify(event.changes)?.slice(0, 160) || "—"}
                      </code>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Showing {audit.events.length} of {audit.totalCount}
            </span>
            {audit.hasNextPage && (
              <Button size="sm" variant="outline" onClick={() => void loadAudit(audit.endCursor, true)}>
                Load more
              </Button>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* ---------------- New user dialog ---------------- */}
      <Dialog open={newUserOpen} onOpenChange={setNewUserOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create user</DialogTitle>
            <DialogDescription>Users authenticate elsewhere; here you define identity + admin flag.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="nu-id">User id</Label>
              <Input id="nu-id" placeholder="user_303" value={newUser.id} onChange={(e) => setNewUser((p) => ({ ...p, id: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="nu-name">Name</Label>
              <Input id="nu-name" placeholder="Sam Rivera" value={newUser.name} onChange={(e) => setNewUser((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={newUser.isAdmin} onCheckedChange={(c) => setNewUser((p) => ({ ...p, isAdmin: Boolean(c) }))} />
              Super admin (bypasses all permission checks)
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewUserOpen(false)}>Cancel</Button>
            <Button onClick={() => void submitNewUser()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------- Assign roles dialog ---------------- */}
      <Dialog open={rolesFor !== null} onOpenChange={(open) => { if (!open) setRolesFor(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Roles for {rolesFor?.name}</DialogTitle>
            <DialogDescription>Check a role to assign it, uncheck to remove it.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {roles.map((role) => (
              <label key={role.name} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted">
                <Checkbox
                  checked={rolesFor?.roles.includes(role.name) ?? false}
                  onCheckedChange={(c) => rolesFor && void toggleRole(rolesFor, role.name, Boolean(c))}
                />
                {role.name}
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRolesFor(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------- New role dialog ---------------- */}
      <Dialog open={newRoleOpen} onOpenChange={setNewRoleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create role</DialogTitle>
            <DialogDescription>Then grant it permissions per surface.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="nr-name">Role name</Label>
            <Input id="nr-name" placeholder="e.g. Support" value={newRoleName} onChange={(e) => setNewRoleName(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewRoleOpen(false)}>Cancel</Button>
            <Button onClick={() => void submitNewRole()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------- Edit grants dialog ---------------- */}
      <Dialog open={grantsFor !== null} onOpenChange={(open) => { if (!open) setGrantsFor(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Grants for role “{grantsFor?.name}”</DialogTitle>
            <DialogDescription>Permissions this role gets on the selected surface.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Surface</Label>
              <Select
                value={grantSurface}
                onValueChange={(value) => {
                  setGrantSurface(value);
                  const existing = grantsFor?.grants.find((g) => g.surfaceId === value);
                  setGrantPerms(pickPerms(existing?.permissions));
                }}
              >
                <SelectTrigger><SelectValue placeholder="Choose a surface" /></SelectTrigger>
                <SelectContent>
                  {surfaces.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.title} ({s.id})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {PERMISSION_LABELS.map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted">
                  <Checkbox
                    checked={grantPerms[key]}
                    onCheckedChange={(c) => setGrantPerms((p) => ({ ...p, [key]: Boolean(c) }))}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <DialogFooter className="sm:justify-between">
            <Button variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => void saveRevoke()} disabled={!grantSurface}>
              Revoke all
            </Button>
            <span className="flex gap-2">
              <Button variant="outline" onClick={() => setGrantsFor(null)}>Close</Button>
              <Button onClick={() => void saveGrant()} disabled={!grantSurface}>Save grant</Button>
            </span>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------- New surface dialog ---------------- */}
      <Dialog open={newSurfaceOpen} onOpenChange={setNewSurfaceOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Create surface</DialogTitle>
            <DialogDescription>
              Rows are rooted at a node label. Columns pull from any source: <code className="text-xs">self.prop</code>,{" "}
              <code className="text-xs">Label.prop</code>, <code className="text-xs">Label.count</code>, aggregates{" "}
              <code className="text-xs">Label.prop.sum|avg|min|max</code>.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="ns-id">Surface id</Label>
                <Input id="ns-id" placeholder="sales_pipeline" value={newSurface.id} onChange={(e) => setNewSurface((p) => ({ ...p, id: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ns-title">Title</Label>
                <Input id="ns-title" placeholder="Sales Pipeline" value={newSurface.title} onChange={(e) => setNewSurface((p) => ({ ...p, title: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ns-root">Root node label</Label>
                <Input id="ns-root" placeholder="Project" value={newSurface.rootLabel} onChange={(e) => setNewSurface((p) => ({ ...p, rootLabel: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label>Renderer</Label>
                <Select value={newSurface.renderer} onValueChange={(v) => setNewSurface((p) => ({ ...p, renderer: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RENDERERS.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ns-columns">
                Columns — one per line:{" "}
                <code className="text-xs">field|label|source|order|suggest|type|required|min|max|minLength|maxLength|pattern|options</code>
              </Label>
              <textarea
                id="ns-columns"
                className="flex min-h-[110px] w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder={
                  "customer|Customer Name|Customer.name|1|yes|string|yes\nproject|Project Title|self.name|2|no|string|yes|0|||120\npriority|Priority|self.priority|3|no|string|yes|Low,Medium,High\nbudget|Budget (USD)|self.budget|4|no|money|no|0|1000000"
                }
                value={newSurface.columns}
                onChange={(e) => setNewSurface((p) => ({ ...p, columns: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewSurfaceOpen(false)}>Cancel</Button>
            <Button onClick={() => void submitNewSurface()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
