import { randomUUID } from "node:crypto";
import { GraphQLScalarType, Kind, buildSchema } from "graphql";
import { driver } from "./neo4j";
import {
  type Column,
  type Permissions,
  type SurfaceRow,
  adminAssignRole,
  adminClearOverride,
  adminCreateRole,
  adminCreateSurface,
  adminCreateUser,
  adminDeleteRole,
  adminDeleteSurface,
  adminDeleteUser,
  adminGrant,
  adminRemoveRole,
  adminRevoke,
  adminRoles,
  adminSetOverride,
  adminSurfaces,
  adminUpdateSurface,
  adminUpdateUser,
  adminUsers,
  createRow,
  deleteRows,
  getSurfaceMeta,
  getSurfacePayload,
  getUser,
  listSurfaces,
  requireAdmin,
  requirePermission,
  runSurfaceRows,
  updateRow,
} from "./db";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
const typeDefs = `
scalar JSON

type ColumnMetadata {
  id: ID!
  field: String!
  label: String!
  order: Int!
  source: String
}

type SurfacePermissions {
  view: Boolean!
  create: Boolean!
  update: Boolean!
  delete: Boolean!
  export: Boolean!
  manage: Boolean!
}

type SurfaceRow {
  id: ID!
  values: JSON!
}

type SurfacePayload {
  id: ID!
  title: String!
  renderer: String!
  rootLabel: String!
  columns: [ColumnMetadata!]!
  permissions: SurfacePermissions!
  rows: [SurfaceRow!]!
}

type SurfaceSummary {
  id: ID!
  title: String!
  renderer: String!
  rootLabel: String!
}

type UserInfo {
  id: ID!
  name: String!
  isAdmin: Boolean!
}

type RoleGrant {
  surfaceId: ID!
  surfaceTitle: String!
  permissions: SurfacePermissions!
}

type RoleInfo {
  id: ID!
  name: String!
  grants: [RoleGrant!]!
}

type AdminUser {
  id: ID!
  name: String!
  isAdmin: Boolean!
  roles: [String!]!
}

type AdminSurfaceSummary {
  id: ID!
  title: String!
  renderer: String!
  rootLabel: String!
  columnCount: Int!
}

input SurfaceUpdateInput {
  title: String
  renderer: String
  rootLabel: String
}

input ColumnInput {
  field: String!
  label: String!
  order: Int
  source: String
}

input ColumnPatchInput {
  field: String
  label: String
  order: Int
  source: String
}

input PermissionInput {
  view: Boolean
  create: Boolean
  update: Boolean
  delete: Boolean
  export: Boolean
  manage: Boolean
}

input AdminUserInput {
  id: ID!
  name: String!
  isAdmin: Boolean
}

input AdminUserPatch {
  name: String
  isAdmin: Boolean
}

input AdminSurfaceInput {
  id: ID!
  title: String!
  renderer: String
  rootLabel: String
  columns: [ColumnInput!]
}

type Query {
  me: UserInfo!
  getSurface(surfaceId: ID!): SurfacePayload!
  listSurfaces: [SurfaceSummary!]!
  adminUsers: [AdminUser!]!
  adminRoles: [RoleInfo!]!
  adminSurfaces: [AdminSurfaceSummary!]!
}

type Mutation {
  # ---- generic row CRUD (rooted at the surface's rootLabel) ----
  createRow(surfaceId: ID!, values: JSON!): SurfaceRow!
  updateRow(surfaceId: ID!, id: ID!, values: JSON!): SurfaceRow!
  deleteRows(surfaceId: ID!, ids: [ID!]!): Int!

  # ---- surface definition CRUD (manage permission) ----
  updateSurface(surfaceId: ID!, input: SurfaceUpdateInput!): SurfacePayload!
  addColumn(surfaceId: ID!, input: ColumnInput!): SurfacePayload!
  updateColumn(surfaceId: ID!, columnId: ID!, input: ColumnPatchInput!): SurfacePayload!
  deleteColumn(surfaceId: ID!, columnId: ID!): SurfacePayload!

  # ---- admin (requires isAdmin) ----
  adminCreateUser(input: AdminUserInput!): AdminUser!
  adminUpdateUser(id: ID!, input: AdminUserPatch!): AdminUser!
  adminDeleteUser(id: ID!): Boolean!
  adminCreateRole(name: String!): RoleInfo!
  adminDeleteRole(name: String!): Boolean!
  adminAssignRole(userId: ID!, roleName: String!): AdminUser!
  adminRemoveRole(userId: ID!, roleName: String!): AdminUser!
  adminGrant(roleName: String!, surfaceId: ID!, permissions: PermissionInput!): RoleInfo!
  adminRevoke(roleName: String!, surfaceId: ID!): RoleInfo!
  adminSetOverride(userId: ID!, surfaceId: ID!, permissions: PermissionInput!): Boolean!
  adminClearOverride(userId: ID!, surfaceId: ID!): Boolean!
  adminCreateSurface(input: AdminSurfaceInput!): SurfaceSummary!
  adminUpdateSurface(id: ID!, input: SurfaceUpdateInput!): SurfaceSummary!
  adminDeleteSurface(id: ID!): Boolean!
}
`;

// ---------------------------------------------------------------------------
// JSON scalar
// ---------------------------------------------------------------------------
const JSONScalar = new GraphQLScalarType({
  name: "JSON",
  serialize: (value) => value,
  parseValue: (value) => value,
  parseLiteral(ast: any) {
    switch (ast.kind) {
      case Kind.STRING:
        return ast.value;
      case Kind.BOOLEAN:
        return ast.value;
      case Kind.INT:
      case Kind.FLOAT:
        return Number(ast.value);
      case Kind.NULL:
        return null;
      case Kind.LIST:
        return ast.values.map((v: any) => JSONScalar.parseLiteral(v));
      case Kind.OBJECT: {
        const obj: Record<string, unknown> = {};
        for (const field of ast.fields) obj[field.name.value] = JSONScalar.parseLiteral(field.value);
        return obj;
      }
      default:
        return undefined;
    }
  },
});

// ---------------------------------------------------------------------------
// Schema factory
// ---------------------------------------------------------------------------
export function getSchema(userId: string) {
  const schema = buildSchema(typeDefs);
  const jsonType = schema.getType("JSON") as GraphQLScalarType;
  Object.assign(jsonType, { serialize: JSONScalar.serialize, parseValue: JSONScalar.parseValue, parseLiteral: JSONScalar.parseLiteral });

  const queryType = schema.getQueryType();
  const mutationType = schema.getMutationType();
  if (!queryType || !mutationType) throw new Error("Schema missing Query/Mutation");

  // ---------------- Query ----------------
  queryType.getFields().me.resolve = async () => {
    const user = await getUser(userId);
    if (!user) throw new Error("User not found");
    return user;
  };

  queryType.getFields().getSurface.resolve = async (_source, { surfaceId }: { surfaceId: string }) =>
    getSurfacePayload(userId, surfaceId);

  queryType.getFields().listSurfaces.resolve = async () => listSurfaces(userId);

  queryType.getFields().adminUsers.resolve = async () => {
    await requireAdmin(userId);
    return adminUsers();
  };

  queryType.getFields().adminRoles.resolve = async () => {
    await requireAdmin(userId);
    return adminRoles();
  };

  queryType.getFields().adminSurfaces.resolve = async () => {
    await requireAdmin(userId);
    return adminSurfaces();
  };

  // ---------------- Row CRUD ----------------
  mutationType.getFields().createRow.resolve = async (
    _source,
    { surfaceId, values }: { surfaceId: string; values: Record<string, unknown> },
  ) => {
    await requirePermission(userId, surfaceId, "create");
    return createRow(surfaceId, values);
  };

  mutationType.getFields().updateRow.resolve = async (
    _source,
    { surfaceId, id, values }: { surfaceId: string; id: string; values: Record<string, unknown> },
  ) => {
    await requirePermission(userId, surfaceId, "update");
    return updateRow(surfaceId, id, values);
  };

  mutationType.getFields().deleteRows.resolve = async (
    _source,
    { surfaceId, ids }: { surfaceId: string; ids: string[] },
  ) => {
    await requirePermission(userId, surfaceId, "delete");
    return deleteRows(ids);
  };

  // ---------------- Surface definition CRUD ----------------
  const refreshSurfacePayload = async (surfaceId: string) => {
    const permissions = await requirePermission(userId, surfaceId, "view");
    const surface = await getSurfaceMeta(surfaceId);
    const rows = await runSurfaceRows(surface);
    return { id: surface.id, title: surface.title, renderer: surface.renderer, rootLabel: surface.rootLabel, columns: surface.columns, permissions, rows };
  };

  mutationType.getFields().updateSurface.resolve = async (
    _source,
    { surfaceId, input }: { surfaceId: string; input: { title?: string; renderer?: string; rootLabel?: string } },
  ) => {
    await requirePermission(userId, surfaceId, "manage");
    const session = driver.session({ defaultAccessMode: "WRITE" });
    try {
      await session.run(
        `MATCH (s:Surface {id: $surfaceId})
         SET s.title = coalesce($title, s.title), s.renderer = coalesce($renderer, s.renderer), s.rootLabel = coalesce($rootLabel, s.rootLabel)`,
        { surfaceId, title: input.title ?? null, renderer: input.renderer ?? null, rootLabel: input.rootLabel ?? null },
      );
    } finally {
      await session.close();
    }
    return refreshSurfacePayload(surfaceId);
  };

  mutationType.getFields().addColumn.resolve = async (
    _source,
    { surfaceId, input }: { surfaceId: string; input: { field: string; label: string; order?: number; source?: string } },
  ) => {
    await requirePermission(userId, surfaceId, "manage");
    const surface = await getSurfaceMeta(surfaceId);
    const order = input.order ?? Math.max(0, ...surface.columns.map((c) => c.order)) + 1;
    const session = driver.session({ defaultAccessMode: "WRITE" });
    try {
      await session.run(
        `MATCH (s:Surface {id: $surfaceId})
         CREATE (c:Column {id: $columnId, field: $field, label: $label, order: toInteger($order), source: $source})
         CREATE (s)-[:HAS_COLUMN]->(c)`,
        {
          surfaceId,
          columnId: `column_${randomUUID()}`,
          field: input.field,
          label: input.label,
          order,
          source: input.source ?? null,
        },
      );
    } finally {
      await session.close();
    }
    return refreshSurfacePayload(surfaceId);
  };

  mutationType.getFields().updateColumn.resolve = async (
    _source,
    { surfaceId, columnId, input }: { surfaceId: string; columnId: string; input: { field?: string; label?: string; order?: number; source?: string } },
  ) => {
    await requirePermission(userId, surfaceId, "manage");
    const session = driver.session({ defaultAccessMode: "WRITE" });
    try {
      await session.run(
        `MATCH (c:Column) WHERE elementId(c) = $columnId
         SET c.field = coalesce($field, c.field), c.label = coalesce($label, c.label), c.order = coalesce($order, c.order), c.source = coalesce($source, c.source)`,
        { columnId, field: input.field ?? null, label: input.label ?? null, order: input.order ?? null, source: input.source ?? null },
      );
    } finally {
      await session.close();
    }
    return refreshSurfacePayload(surfaceId);
  };

  mutationType.getFields().deleteColumn.resolve = async (
    _source,
    { surfaceId, columnId }: { surfaceId: string; columnId: string },
  ) => {
    await requirePermission(userId, surfaceId, "manage");
    const session = driver.session({ defaultAccessMode: "WRITE" });
    try {
      await session.run(`MATCH (c:Column) WHERE elementId(c) = $columnId DETACH DELETE c`, { columnId });
    } finally {
      await session.close();
    }
    return refreshSurfacePayload(surfaceId);
  };

  // ---------------- Admin ----------------
  mutationType.getFields().adminCreateUser.resolve = async (
    _source,
    { input }: { input: { id: string; name: string; isAdmin?: boolean } },
  ) => {
    await requireAdmin(userId);
    return adminCreateUser(input);
  };

  mutationType.getFields().adminUpdateUser.resolve = async (
    _source,
    { id, input }: { id: string; input: { name?: string; isAdmin?: boolean } },
  ) => {
    await requireAdmin(userId);
    return adminUpdateUser(id, input);
  };

  mutationType.getFields().adminDeleteUser.resolve = async (_source, { id }: { id: string }) => {
    await requireAdmin(userId);
    return adminDeleteUser(id);
  };

  mutationType.getFields().adminCreateRole.resolve = async (_source, { name }: { name: string }) => {
    await requireAdmin(userId);
    return adminCreateRole(name);
  };

  mutationType.getFields().adminDeleteRole.resolve = async (_source, { name }: { name: string }) => {
    await requireAdmin(userId);
    return adminDeleteRole(name);
  };

  mutationType.getFields().adminAssignRole.resolve = async (
    _source,
    { userId: targetUserId, roleName }: { userId: string; roleName: string },
  ) => {
    await requireAdmin(userId);
    return adminAssignRole(targetUserId, roleName);
  };

  mutationType.getFields().adminRemoveRole.resolve = async (
    _source,
    { userId: targetUserId, roleName }: { userId: string; roleName: string },
  ) => {
    await requireAdmin(userId);
    return adminRemoveRole(targetUserId, roleName);
  };

  mutationType.getFields().adminGrant.resolve = async (
    _source,
    { roleName, surfaceId, permissions }: { roleName: string; surfaceId: string; permissions: Partial<Permissions> },
  ) => {
    await requireAdmin(userId);
    return adminGrant(roleName, surfaceId, permissions);
  };

  mutationType.getFields().adminRevoke.resolve = async (
    _source,
    { roleName, surfaceId }: { roleName: string; surfaceId: string },
  ) => {
    await requireAdmin(userId);
    return adminRevoke(roleName, surfaceId);
  };

  mutationType.getFields().adminSetOverride.resolve = async (
    _source,
    { userId: targetUserId, surfaceId, permissions }: { userId: string; surfaceId: string; permissions: Partial<Permissions> },
  ) => {
    await requireAdmin(userId);
    return adminSetOverride(targetUserId, surfaceId, permissions);
  };

  mutationType.getFields().adminClearOverride.resolve = async (
    _source,
    { userId: targetUserId, surfaceId }: { userId: string; surfaceId: string },
  ) => {
    await requireAdmin(userId);
    return adminClearOverride(targetUserId, surfaceId);
  };

  mutationType.getFields().adminCreateSurface.resolve = async (
    _source,
    { input }: { input: { id: string; title: string; renderer?: string; rootLabel?: string; columns?: Array<{ field: string; label: string; order?: number; source?: string }> } },
  ) => {
    await requireAdmin(userId);
    return adminCreateSurface(input);
  };

  mutationType.getFields().adminUpdateSurface.resolve = async (
    _source,
    { id, input }: { id: string; input: { title?: string; renderer?: string; rootLabel?: string } },
  ) => {
    await requireAdmin(userId);
    return adminUpdateSurface(id, input);
  };

  mutationType.getFields().adminDeleteSurface.resolve = async (_source, { id }: { id: string }) => {
    await requireAdmin(userId);
    return adminDeleteSurface(id);
  };

  return schema;
}
