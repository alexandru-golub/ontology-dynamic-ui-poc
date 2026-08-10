import { GraphQLError } from "graphql";
import { isInt } from "neo4j-driver";
import { randomUUID } from "node:crypto";
import { driver } from "./neo4j";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type Permissions = Record<"view" | "create" | "update" | "delete" | "export" | "manage", boolean>;
export type Column = { id: string; field: string; label: string; order: number; source: string | null };
export type SurfaceMeta = { id: string; title: string; renderer: string; rootLabel: string; columns: Column[] };
export type SurfaceRow = { id: string; values: Record<string, unknown> };

const ALL_TRUE: Permissions = { view: true, create: true, update: true, delete: true, export: true, manage: true };
const PERMISSION_KEYS = ["view", "create", "update", "delete", "export", "manage"] as const;

/** Relationship map used by generic row writes: neighbor label -> how to link it. */
const NEIGHBOR_LINKS: Record<string, { rel: string; dir: "in" | "out" }> = {
  Customer: { rel: "HAS_PROJECT", dir: "in" },
  Status: { rel: "HAS_STATUS", dir: "out" },
  Role: { rel: "HAS_ROLE", dir: "out" },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function toPlain(value: unknown): unknown {
  if (isInt(value)) return value.toNumber();
  if (Array.isArray(value)) return value.map(toPlain);
  if (value !== null && typeof value === "object") {
    const obj: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) obj[key] = toPlain(item);
    return obj;
  }
  return value;
}

function sanitizeLabel(label: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(label)) {
    throw new GraphQLError(`Invalid label "${label}"`, { extensions: { code: "BAD_INPUT" } });
  }
  return label;
}

export type ColumnSource =
  | { kind: "self"; prop: string }
  | { kind: "neighbor"; label: string; prop: string }
  | { kind: "count"; label: string };

/** Resolve a column's `source` spec into a read/write route. */
export function parseSource(source: string | null | undefined, field: string): ColumnSource {
  const src = (source ?? "").trim();
  if (src.startsWith("self.")) return { kind: "self", prop: src.slice(5) || field };
  // Label.count must be checked before Label.prop (count would match as a prop name)
  const countMatch = src.match(/^([A-Za-z_][A-Za-z0-9_]*)\.count$/);
  if (countMatch) return { kind: "count", label: countMatch[1] };
  const match = src.match(/^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/);
  if (match) return { kind: "neighbor", label: match[1], prop: match[2] };
  // legacy inference by field name
  if (field === "customer") return { kind: "neighbor", label: "Customer", prop: "name" };
  if (field === "status") return { kind: "neighbor", label: "Status", prop: "name" };
  if (field === "project") return { kind: "self", prop: "name" };
  return { kind: "self", prop: field };
}

// ---------------------------------------------------------------------------
// Surface metadata + multi-source row projection
// ---------------------------------------------------------------------------
const surfaceMetaCypher = `
MATCH (s:Surface {id: $surfaceId})
OPTIONAL MATCH (s)-[:HAS_COLUMN]->(column:Column)
WITH s, column ORDER BY column.order
RETURN s.id AS id,
       coalesce(s.title, s.name) AS title,
       s.renderer AS renderer,
       coalesce(s.rootLabel, 'Project') AS rootLabel,
       [c IN collect(column) WHERE c IS NOT NULL | { id: elementId(c), field: c.field, label: c.label, order: toInteger(c.order), source: c.source }] AS columns`;

export async function getSurfaceMeta(surfaceId: string): Promise<SurfaceMeta> {
  const session = driver.session({ defaultAccessMode: "READ" });
  try {
    const result = await session.run(surfaceMetaCypher, { surfaceId });
    if (!result.records.length) throw new GraphQLError("Surface not found", { extensions: { code: "NOT_FOUND" } });
    const record = result.records[0].toObject() as {
      id: string;
      title: string;
      renderer: string;
      rootLabel: string;
      columns: Column[];
    };
    return {
      ...record,
      columns: record.columns.map((c) => ({ ...c, order: Number(c.order) })),
    };
  } finally {
    await session.close();
  }
}

/**
 * Build a projection query for a surface rooted at `rootLabel`.
 * Each column pulls from its own source (self property, neighbor property,
 * neighbor count), so a single surface can mix data from many node types.
 */
function buildProjectionQuery(rootLabel: string, columns: Column[], rowId?: string) {
  const label = sanitizeLabel(rootLabel);
  const clauses: string[] = [];
  const returns: string[] = ["elementId(root) AS id", "properties(root) AS rootProps"];
  const aliases: Record<string, string> = {};
  columns.forEach((column, index) => {
    const source = parseSource(column.source, column.field);
    if (source.kind === "neighbor") {
      clauses.push(`OPTIONAL MATCH (root)--(n${index}:${source.label})`);
      returns.push(`collect(DISTINCT n${index}.${source.prop})[0] AS v${index}`);
      aliases[column.field] = `v${index}`;
    } else if (source.kind === "count") {
      clauses.push(`OPTIONAL MATCH (root)--(n${index}:${source.label})`);
      returns.push(`count(DISTINCT n${index}) AS v${index}`);
      aliases[column.field] = `v${index}`;
    }
  });
  const where = rowId ? "WHERE elementId(root) = $rowId\n" : "";
  const query = `MATCH (root:\`${label}\`)\n${where}${clauses.join("\n")}\nRETURN ${returns.join(", ")}`;
  return { query, aliases };
}

function assembleRows(records: unknown[], columns: Column[], aliases: Record<string, string>): SurfaceRow[] {
  return records.map((record) => {
    const obj = (record as { toObject(): Record<string, unknown> }).toObject();
    const rootProps = (obj.rootProps ?? {}) as Record<string, unknown>;
    const values: Record<string, unknown> = {};
    for (const column of columns) {
      const source = parseSource(column.source, column.field);
      if (source.kind === "self") values[column.field] = toPlain(rootProps[source.prop]) ?? null;
      else values[column.field] = toPlain(obj[aliases[column.field]]) ?? null;
    }
    return { id: String(obj.id), values };
  });
}

export async function runSurfaceRows(surface: SurfaceMeta, rowId?: string): Promise<SurfaceRow[]> {
  const { query, aliases } = buildProjectionQuery(surface.rootLabel, surface.columns, rowId);
  const session = driver.session({ defaultAccessMode: "READ" });
  try {
    const params: Record<string, unknown> = {};
    if (rowId) params.rowId = rowId;
    const result = await session.run(query, params);
    return assembleRows(result.records, surface.columns, aliases);
  } finally {
    await session.close();
  }
}

// ---------------------------------------------------------------------------
// Permissions / identity
// ---------------------------------------------------------------------------
export type UserInfo = { id: string; name: string; isAdmin: boolean };

export async function getUser(userId: string): Promise<UserInfo | null> {
  const session = driver.session({ defaultAccessMode: "READ" });
  try {
    const result = await session.run(
      `MATCH (u:User {id: $userId}) RETURN u.id AS id, u.name AS name, coalesce(u.isAdmin, false) AS isAdmin`,
      { userId },
    );
    if (!result.records.length) return null;
    const record = result.records[0].toObject();
    return { id: record.id as string, name: (record.name as string) ?? userId, isAdmin: Boolean(record.isAdmin) };
  } finally {
    await session.close();
  }
}

async function fetchPermissions(userId: string, surfaceId: string): Promise<Permissions | null> {
  const session = driver.session({ defaultAccessMode: "READ" });
  try {
    const result = await session.run(
      `
MATCH (u:User {id: $userId}), (s:Surface {id: $surfaceId})
OPTIONAL MATCH (u)-[:HAS_ROLE]->(:Role)-[rolePermission:CAN_ACCESS]->(s)
WITH u, s, [permission IN collect(properties(rolePermission)) WHERE permission IS NOT NULL] AS rolePermissions
OPTIONAL MATCH (u)-[userOverride:SURFACE_OVERRIDE]->(s)
WITH rolePermissions, head(collect(properties(userOverride))) AS override
RETURN {
  view: CASE WHEN override.view = false THEN false WHEN override.view = true THEN true ELSE any(p IN rolePermissions WHERE p.view = true) END,
  create: CASE WHEN override.create = false THEN false WHEN override.create = true THEN true ELSE any(p IN rolePermissions WHERE p.create = true) END,
  update: CASE WHEN override.update = false THEN false WHEN override.update = true THEN true ELSE any(p IN rolePermissions WHERE p.update = true) END,
  delete: CASE WHEN override.delete = false THEN false WHEN override.delete = true THEN true ELSE any(p IN rolePermissions WHERE p.delete = true) END,
  export: CASE WHEN override.export = false THEN false WHEN override.export = true THEN true ELSE any(p IN rolePermissions WHERE p.export = true) END,
  manage: CASE WHEN override.manage = false THEN false WHEN override.manage = true THEN true ELSE any(p IN rolePermissions WHERE p.manage = true) END
} AS permissions`,
      { userId, surfaceId },
    );
    if (!result.records.length) return null;
    return result.records[0].get("permissions") as Permissions;
  } finally {
    await session.close();
  }
}

function forbid(permission: string): never {
  throw new GraphQLError(`Missing '${permission}' permission for this surface`, { extensions: { code: "FORBIDDEN" } });
}

export async function requirePermission(userId: string, surfaceId: string, permission: keyof Permissions): Promise<Permissions> {
  const user = await getUser(userId);
  if (user?.isAdmin) return { ...ALL_TRUE };
  const permissions = await fetchPermissions(userId, surfaceId);
  if (!permissions) throw new GraphQLError("Surface not found", { extensions: { code: "NOT_FOUND" } });
  if (!permissions.view) forbid("view");
  if (!permissions[permission]) forbid(permission);
  return permissions;
}

export async function requireAdmin(userId: string): Promise<UserInfo> {
  const user = await getUser(userId);
  if (!user) throw new GraphQLError("User not found", { extensions: { code: "NOT_FOUND" } });
  if (!user.isAdmin) {
    throw new GraphQLError("Admin privileges required", { extensions: { code: "FORBIDDEN" } });
  }
  return user;
}

// ---------------------------------------------------------------------------
// Row CRUD (generic over the surface's root label)
// ---------------------------------------------------------------------------
function routeValues(columns: Column[], values: Record<string, unknown>) {
  const props: Record<string, unknown> = {};
  const neighbors: Record<string, { rel: string; dir: "in" | "out"; name: string }> = {};
  for (const column of columns) {
    const raw = values[column.field];
    if (raw === undefined || raw === null) continue;
    const text = typeof raw === "string" ? raw.trim() : String(raw);
    const source = parseSource(column.source, column.field);
    if (source.kind === "self") {
      props[source.prop] = toPlain(raw);
    } else if (source.kind === "neighbor") {
      const link = NEIGHBOR_LINKS[source.label];
      if (link && text !== "") neighbors[source.label] = { ...link, name: text };
    }
  }
  return { props, neighbors };
}

/** Build the mutation response values from what was actually written. */
function valuesFromWrite(
  surface: SurfaceMeta,
  rootProps: Record<string, unknown>,
  neighbors: Record<string, { rel: string; dir: "in" | "out"; name: string }>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const column of surface.columns) {
    const source = parseSource(column.source, column.field);
    if (source.kind === "self") values[column.field] = toPlain(rootProps[source.prop]) ?? null;
    else if (source.kind === "neighbor") values[column.field] = neighbors[source.label]?.name ?? null;
    else values[column.field] = null;
  }
  return values;
}

export async function createRow(surfaceId: string, values: Record<string, unknown>): Promise<SurfaceRow> {
  const surface = await getSurfaceMeta(surfaceId);
  const { props, neighbors } = routeValues(surface.columns, values);
  const label = sanitizeLabel(surface.rootLabel);
  const mergeParts = Object.keys(neighbors).map((n) => `MERGE (n_${n}:${n} {name: $name_${n}})`);
  const linkParts: string[] = [];
  for (const [n, info] of Object.entries(neighbors)) {
    linkParts.push(info.dir === "in" ? `CREATE (n_${n})-[:${info.rel}]->(root)` : `CREATE (root)-[:${info.rel}]->(n_${n})`);
  }
  const query = `
CREATE (root:\`${label}\` {id: $rowId})
SET root += $props
${mergeParts.join("\n")}
${linkParts.join("\n")}
RETURN elementId(root) AS id, properties(root) AS rootProps`;
  const params: Record<string, unknown> = { rowId: `row_${randomUUID()}`, props };
  for (const [n, info] of Object.entries(neighbors)) params[`name_${n}`] = info.name;
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    const result = await session.run(query, params);
    const obj = result.records[0].toObject() as { id: string; rootProps: Record<string, unknown> };
    return { id: String(obj.id), values: valuesFromWrite(surface, obj.rootProps, neighbors) };
  } finally {
    await session.close();
  }
}

export async function updateRow(surfaceId: string, rowId: string, values: Record<string, unknown>): Promise<SurfaceRow> {
  const surface = await getSurfaceMeta(surfaceId);
  const current = (await runSurfaceRows(surface, rowId))[0];
  if (!current) throw new GraphQLError("Row not found", { extensions: { code: "NOT_FOUND" } });
  const merged = { ...current.values, ...values };
  const { props, neighbors } = routeValues(surface.columns, merged);
  const label = sanitizeLabel(surface.rootLabel);
  void label;

  // For every neighbor kind present in the surface, detach existing links, then re-link if a value was provided.
  const neighborKinds = new Set<string>();
  for (const column of surface.columns) {
    const source = parseSource(column.source, column.field);
    if (source.kind === "neighbor" && NEIGHBOR_LINKS[source.label]) neighborKinds.add(source.label);
  }
  const params: Record<string, unknown> = { rowId, props };
  for (const [n, info] of Object.entries(neighbors)) params[`name_${n}`] = info.name;

  // Three statements, each individually valid Cypher (Cypher requires WITH between
  // MATCH and a preceding SET/CREATE/DELETE/MERGE updating clause).
  // Cypher: a MATCH may not follow an updating clause (DELETE/SET/CREATE/MERGE)
  // without an intervening WITH, so separate every delete with `WITH root`.
  const deleteRels = `
MATCH (root) WHERE elementId(root) = $rowId
${[...neighborKinds]
  .map((n) => {
    const info = NEIGHBOR_LINKS[n];
    return info.dir === "in"
      ? `OPTIONAL MATCH (root)<-[r_${n}:${info.rel}]-(:${n}) DELETE r_${n}`
      : `OPTIONAL MATCH (root)-[r_${n}:${info.rel}]->(:${n}) DELETE r_${n}`;
  })
  .join("\nWITH root\n")}`;
  const setProps = `
MATCH (root) WHERE elementId(root) = $rowId
SET root += $props`;
  const relink = `
MATCH (root) WHERE elementId(root) = $rowId
${Object.keys(neighbors)
  .map((n) => `MERGE (n_${n}:${n} {name: $name_${n}})`)
  .join("\n")}
${Object.entries(neighbors)
  .map(([n, info]) =>
    info.dir === "in" ? `CREATE (n_${n})-[:${info.rel}]->(root)` : `CREATE (root)-[:${info.rel}]->(n_${n})`,
  )
  .join("\n")}
RETURN elementId(root) AS id, properties(root) AS rootProps`;

  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    await session.run(deleteRels, params);
    await session.run(setProps, params);
    const result = await session.run(relink, params);
    const obj = result.records[0].toObject() as { id: string; rootProps: Record<string, unknown> };
    return { id: String(obj.id), values: valuesFromWrite(surface, obj.rootProps, neighbors) };
  } finally {
    await session.close();
  }
}

export async function deleteRows(ids: string[]): Promise<number> {
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    const result = await session.run(
      `
MATCH (n) WHERE elementId(n) IN $ids
WITH collect(n) AS nodes
WITH nodes, size(nodes) AS cnt
UNWIND nodes AS n
DETACH DELETE n
RETURN cnt`,
      { ids },
    );
    return result.records[0].get("cnt").toNumber();
  } finally {
    await session.close();
  }
}

// ---------------------------------------------------------------------------
// Surfaces (shared helpers)
// ---------------------------------------------------------------------------
export async function listSurfaces(userId: string) {
  const user = await getUser(userId);
  if (user?.isAdmin) {
    const session = driver.session({ defaultAccessMode: "READ" });
    try {
      const result = await session.run(
        `MATCH (s:Surface) RETURN s.id AS id, coalesce(s.title, s.name) AS title, s.renderer AS renderer, coalesce(s.rootLabel, 'Project') AS rootLabel ORDER BY s.id`,
      );
      return result.records.map((record) => record.toObject());
    } finally {
      await session.close();
    }
  }
  const session = driver.session({ defaultAccessMode: "READ" });
  try {
    const result = await session.run(
      `
MATCH (u:User {id: $userId})
OPTIONAL MATCH (u)-[:HAS_ROLE]->(:Role)-[p:CAN_ACCESS]->(s:Surface)
OPTIONAL MATCH (u)-[o:SURFACE_OVERRIDE]->(s)
WITH s, [permission IN collect(properties(p)) WHERE permission IS NOT NULL] AS rolePermissions, head(collect(properties(o))) AS override
WHERE s IS NOT NULL
WITH s, CASE WHEN override.view = false THEN false WHEN override.view = true THEN true ELSE any(permission IN rolePermissions WHERE permission.view = true) END AS canView
WHERE canView
RETURN s.id AS id, coalesce(s.title, s.name) AS title, s.renderer AS renderer, coalesce(s.rootLabel, 'Project') AS rootLabel
ORDER BY s.id`,
      { userId },
    );
    return result.records.map((record) => record.toObject());
  } finally {
    await session.close();
  }
}

export async function getSurfacePayload(userId: string, surfaceId: string) {
  const permissions = await requirePermission(userId, surfaceId, "view");
  const surface = await getSurfaceMeta(surfaceId);
  const rows = await runSurfaceRows(surface);
  return { id: surface.id, title: surface.title, renderer: surface.renderer, rootLabel: surface.rootLabel, columns: surface.columns, permissions, rows };
}

// ---------------------------------------------------------------------------
// Admin queries
// ---------------------------------------------------------------------------
export async function adminUsers(): Promise<unknown[]> {
  const session = driver.session({ defaultAccessMode: "READ" });
  try {
    const result = await session.run(
      `
MATCH (u:User)
OPTIONAL MATCH (u)-[:HAS_ROLE]->(r:Role)
RETURN u.id AS id, u.name AS name, coalesce(u.isAdmin, false) AS isAdmin, collect(DISTINCT r.name) AS roles
ORDER BY u.id`,
    );
    return result.records.map((record) => {
      const obj = record.toObject();
      return { id: obj.id, name: obj.name, isAdmin: Boolean(obj.isAdmin), roles: obj.roles as string[] };
    });
  } finally {
    await session.close();
  }
}

export async function adminRoles(): Promise<unknown[]> {
  const session = driver.session({ defaultAccessMode: "READ" });
  try {
    const result = await session.run(
      `
MATCH (r:Role)
OPTIONAL MATCH (r)-[p:CAN_ACCESS]->(s:Surface)
WITH r, [g IN collect(CASE WHEN s IS NULL THEN NULL ELSE { surfaceId: s.id, surfaceTitle: coalesce(s.title, s.name), permissions: properties(p) } END) WHERE g IS NOT NULL] AS grants
RETURN coalesce(r.id, r.name) AS id, r.name AS name, grants
ORDER BY r.name`,
    );
    return result.records.map((record) => {
      const obj = record.toObject();
      return {
        id: obj.id,
        name: obj.name,
        grants: (obj.grants as Array<Record<string, unknown>>).map((grant) => ({
          ...grant,
          permissions: { ...ALL_TRUE, ...(toPlain(grant.permissions) as Permissions) },
        })),
      };
    });
  } finally {
    await session.close();
  }
}

export async function adminSurfaces() {
  const session = driver.session({ defaultAccessMode: "READ" });
  try {
    const result = await session.run(
      `
MATCH (s:Surface)
OPTIONAL MATCH (s)-[:HAS_COLUMN]->(c:Column)
RETURN s.id AS id, coalesce(s.title, s.name) AS title, s.renderer AS renderer, coalesce(s.rootLabel, 'Project') AS rootLabel, count(c) AS columnCount
ORDER BY s.id`,
    );
    return result.records.map((record) => {
      const obj = record.toObject();
      return { id: obj.id, title: obj.title, renderer: obj.renderer, rootLabel: obj.rootLabel, columnCount: toPlain(obj.columnCount) };
    });
  } finally {
    await session.close();
  }
}

// ---------------------------------------------------------------------------
// Admin mutations
// ---------------------------------------------------------------------------
export async function adminCreateUser(input: { id: string; name: string; isAdmin?: boolean }) {
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    await session.run(
      `CREATE (u:User {id: $id, name: $name, isAdmin: coalesce($isAdmin, false)})`,
      { id: input.id, name: input.name, isAdmin: input.isAdmin ?? false },
    );
  } finally {
    await session.close();
  }
  return { id: input.id, name: input.name, isAdmin: Boolean(input.isAdmin), roles: [] };
}

export async function adminUpdateUser(id: string, input: { name?: string; isAdmin?: boolean }) {
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    const result = await session.run(
      `MATCH (u:User {id: $id}) SET u.name = coalesce($name, u.name), u.isAdmin = coalesce($isAdmin, u.isAdmin) RETURN u.id AS id, u.name AS name, coalesce(u.isAdmin, false) AS isAdmin`,
      { id, name: input.name ?? null, isAdmin: input.isAdmin ?? null },
    );
    if (!result.records.length) throw new GraphQLError("User not found", { extensions: { code: "NOT_FOUND" } });
    const obj = result.records[0].toObject();
    return { id: obj.id, name: obj.name, isAdmin: Boolean(obj.isAdmin), roles: [] };
  } finally {
    await session.close();
  }
}

export async function adminDeleteUser(id: string): Promise<boolean> {
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    const result = await session.run(`MATCH (u:User {id: $id}) DETACH DELETE u RETURN count(u) AS cnt`, { id });
    return result.records[0].get("cnt").toNumber() > 0;
  } finally {
    await session.close();
  }
}

export async function adminCreateRole(name: string) {
  const roleId = `role_${randomUUID().slice(0, 8)}`;
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    await session.run(
      `MERGE (r:Role {name: $name}) ON CREATE SET r.id = $roleId RETURN r`,
      { name, roleId },
    );
  } finally {
    await session.close();
  }
  return { id: roleId, name, grants: [] };
}

export async function adminDeleteRole(name: string): Promise<boolean> {
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    const result = await session.run(`MATCH (r:Role {name: $name}) DETACH DELETE r RETURN count(r) AS cnt`, { name });
    return result.records[0].get("cnt").toNumber() > 0;
  } finally {
    await session.close();
  }
}

export async function adminAssignRole(userId: string, roleName: string) {
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    await session.run(
      `MATCH (u:User {id: $userId}) MERGE (r:Role {name: $roleName}) MERGE (u)-[:HAS_ROLE]->(r)`,
      { userId, roleName },
    );
  } finally {
    await session.close();
  }
  return adminUserDetail(userId);
}

export async function adminRemoveRole(userId: string, roleName: string) {
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    await session.run(
      `MATCH (u:User {id: $userId})-[rel:HAS_ROLE]->(r:Role {name: $roleName}) DELETE rel`,
      { userId, roleName },
    );
  } finally {
    await session.close();
  }
  return adminUserDetail(userId);
}

async function adminUserDetail(userId: string) {
  const session = driver.session({ defaultAccessMode: "READ" });
  try {
    const result = await session.run(
      `
MATCH (u:User {id: $userId})
OPTIONAL MATCH (u)-[:HAS_ROLE]->(r:Role)
RETURN u.id AS id, u.name AS name, coalesce(u.isAdmin, false) AS isAdmin, collect(DISTINCT r.name) AS roles`,
      { userId },
    );
    if (!result.records.length) throw new GraphQLError("User not found", { extensions: { code: "NOT_FOUND" } });
    const obj = result.records[0].toObject();
    return { id: obj.id, name: obj.name, isAdmin: Boolean(obj.isAdmin), roles: obj.roles as string[] };
  } finally {
    await session.close();
  }
}

export async function adminRoleDetail(roleName: string) {
  const session = driver.session({ defaultAccessMode: "READ" });
  try {
    const result = await session.run(
      `
MATCH (r:Role {name: $roleName})
OPTIONAL MATCH (r)-[p:CAN_ACCESS]->(s:Surface)
WITH r, [g IN collect(CASE WHEN s IS NULL THEN NULL ELSE { surfaceId: s.id, surfaceTitle: coalesce(s.title, s.name), permissions: properties(p) } END) WHERE g IS NOT NULL] AS grants
RETURN coalesce(r.id, r.name) AS id, r.name AS name, grants`,
      { roleName },
    );
    if (!result.records.length) throw new GraphQLError("Role not found", { extensions: { code: "NOT_FOUND" } });
    const obj = result.records[0].toObject();
    return {
      id: obj.id,
      name: obj.name,
      grants: (obj.grants as Array<Record<string, unknown>>).map((grant) => ({
        ...grant,
        permissions: { ...ALL_TRUE, ...(toPlain(grant.permissions) as Permissions) },
      })),
    };
  } finally {
    await session.close();
  }
}

export async function adminGrant(roleName: string, surfaceId: string, permissions: Partial<Permissions>) {
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    await session.run(
      `MATCH (r:Role {name: $roleName}), (s:Surface {id: $surfaceId}) MERGE (r)-[p:CAN_ACCESS]->(s) SET p += $permissions`,
      { roleName, surfaceId, permissions: { ...permissions } },
    );
  } finally {
    await session.close();
  }
  return adminRoleDetail(roleName);
}

export async function adminRevoke(roleName: string, surfaceId: string) {
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    await session.run(
      `MATCH (r:Role {name: $roleName})-[p:CAN_ACCESS]->(s:Surface {id: $surfaceId}) DELETE p`,
      { roleName, surfaceId },
    );
  } finally {
    await session.close();
  }
  return adminRoleDetail(roleName);
}

export async function adminSetOverride(userId: string, surfaceId: string, permissions: Partial<Permissions>) {
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    await session.run(
      `MATCH (u:User {id: $userId}), (s:Surface {id: $surfaceId}) MERGE (u)-[o:SURFACE_OVERRIDE]->(s) SET o += $permissions`,
      { userId, surfaceId, permissions: { ...permissions } },
    );
  } finally {
    await session.close();
  }
  return true;
}

export async function adminClearOverride(userId: string, surfaceId: string): Promise<boolean> {
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    const result = await session.run(
      `MATCH (u:User {id: $userId})-[o:SURFACE_OVERRIDE]->(s:Surface {id: $surfaceId}) DELETE o RETURN count(o) AS cnt`,
      { userId, surfaceId },
    );
    return result.records[0].get("cnt").toNumber() > 0;
  } finally {
    await session.close();
  }
}

export async function adminCreateSurface(input: {
  id: string;
  title: string;
  renderer?: string;
  rootLabel?: string;
  columns?: Array<{ field: string; label: string; order?: number; source?: string }>;
}) {
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    await session.run(
      `CREATE (s:Surface {id: $id, title: $title, renderer: coalesce($renderer, 'table'), rootLabel: coalesce($rootLabel, 'Project')})`,
      { id: input.id, title: input.title, renderer: input.renderer ?? null, rootLabel: input.rootLabel ?? null },
    );
    for (const [index, column] of (input.columns ?? []).entries()) {
      await session.run(
        `MATCH (s:Surface {id: $id})
         CREATE (c:Column {id: $columnId, field: $field, label: $label, order: toInteger($order), source: $source})
         CREATE (s)-[:HAS_COLUMN]->(c)`,
        {
          id: input.id,
          columnId: `column_${randomUUID()}`,
          field: column.field,
          label: column.label,
          order: column.order ?? index + 1,
          source: column.source ?? null,
        },
      );
    }
  } finally {
    await session.close();
  }
  return { id: input.id, title: input.title, renderer: input.renderer ?? "table", rootLabel: input.rootLabel ?? "Project" };
}

export async function adminUpdateSurface(id: string, input: { title?: string; renderer?: string; rootLabel?: string }) {
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    const result = await session.run(
      `MATCH (s:Surface {id: $id})
       SET s.title = coalesce($title, s.title), s.renderer = coalesce($renderer, s.renderer), s.rootLabel = coalesce($rootLabel, s.rootLabel)
       RETURN s.id AS id, coalesce(s.title, s.name) AS title, s.renderer AS renderer, coalesce(s.rootLabel, 'Project') AS rootLabel`,
      { id, title: input.title ?? null, renderer: input.renderer ?? null, rootLabel: input.rootLabel ?? null },
    );
    if (!result.records.length) throw new GraphQLError("Surface not found", { extensions: { code: "NOT_FOUND" } });
    return result.records[0].toObject();
  } finally {
    await session.close();
  }
}

export async function adminDeleteSurface(id: string): Promise<boolean> {
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    await session.run(`MATCH (s:Surface {id: $id}) OPTIONAL MATCH (s)-[:HAS_COLUMN]->(c:Column) DETACH DELETE c`, { id });
    const result = await session.run(`MATCH (s:Surface {id: $id}) DETACH DELETE s RETURN count(s) AS cnt`, { id });
    return result.records[0].get("cnt").toNumber() > 0;
  } finally {
    await session.close();
  }
}
