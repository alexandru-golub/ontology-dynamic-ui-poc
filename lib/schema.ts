import { randomUUID } from "node:crypto";
import { sanitizeColumnType, sanitizeLabel as validateRootLabel } from "./db";
import { GraphQLError, GraphQLScalarType, Kind, buildSchema } from "graphql";
import { driver } from "./neo4j";
import {
  type Column,
  type ColumnFilter,
  type ColumnOrder,
  type Permissions,
  type SurfaceRow,
  auditEventsPage,
  writeAudit,
  adminAssignRole,
  adminClearOverride,
  adminCreateRole,
  adminCreateSurface,
  adminCreateUser,
  adminDeleteRole,
  adminDeleteSurface,
  adminDeleteUser,
  adminPurgeSurface,
  adminRestoreSurface,
  adminGrant,
  adminRemoveRole,
  adminRevoke,
  adminRoles,
  adminSetPassword,
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
  surfaceRowsPage,
  updateRow,
  validateRenderer,
  validateSource,
  sanitizeValidationRules,
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
  suggest: Boolean!
  suggestSource: String
  type: String!
  # ---- per-field validation rules (enforced server-side on every write) ----
  required: Boolean!
  min: Float
  max: Float
  minLength: Int
  maxLength: Int
  pattern: String
  options: [String!]
  validationMessage: String
}

enum FilterOp {
  eq
  neq
  contains
  gt
  lt
}

input ColumnFilterInput {
  field: String!
  op: FilterOp!
  value: String
}

enum OrderDirection {
  ASC
  DESC
}

input ColumnOrderInput {
  field: String!
  direction: OrderDirection!
}

type AuditEvent {
  id: ID!
  at: String!
  actorId: String!
  actorName: String!
  action: String!
  surfaceId: String
  surfaceTitle: String
  targetId: String
  targetLabel: String
  changes: JSON
}

type AuditEventEdge {
  cursor: String!
  node: AuditEvent!
}

type AuditEventConnection {
  edges: [AuditEventEdge!]!
  pageInfo: PageInfo!
  totalCount: Int!
}

type SuggestionGroup {
  field: String!
  values: [String!]!
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

type SurfaceRowEdge {
  cursor: String!
  node: SurfaceRow!
}

type PageInfo {
  hasNextPage: Boolean!
  endCursor: String
}

type SurfaceRowConnection {
  edges: [SurfaceRowEdge!]!
  pageInfo: PageInfo!
  totalCount: Int!
}

type SurfacePayload {
  id: ID!
  title: String!
  renderer: String!
  rootLabel: String!
  columns: [ColumnMetadata!]!
  permissions: SurfacePermissions!
  rows: [SurfaceRow!]!
  suggestions: [SuggestionGroup!]!
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
  hasPassword: Boolean!
  roles: [String!]!
}

type AdminSurfaceSummary {
  id: ID!
  title: String!
  renderer: String!
  rootLabel: String!
  columnCount: Int!
  deleted: Boolean!
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
  suggest: Boolean
  suggestSource: String
  type: String
  required: Boolean
  min: Float
  max: Float
  minLength: Int
  maxLength: Int
  pattern: String
  options: [String!]
  validationMessage: String
}

input ColumnPatchInput {
  field: String
  label: String
  order: Int
  source: String
  suggest: Boolean
  suggestSource: String
  type: String
  required: Boolean
  min: Float
  max: Float
  minLength: Int
  maxLength: Int
  pattern: String
  options: [String!]
  validationMessage: String
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
  surfaceRows(
    surfaceId: ID!
    first: Int
    after: String
    search: String
    filters: [ColumnFilterInput!]
    orderBy: ColumnOrderInput
  ): SurfaceRowConnection!
  auditEvents(first: Int, after: String): AuditEventConnection!
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
  adminSetPassword(id: ID!, password: String!): Boolean!
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
  adminRestoreSurface(id: ID!): Boolean!
  adminPurgeSurface(id: ID!): Boolean!
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
export type SessionContext = { userId: string; roleName: string | null };

export function getSchema(session: SessionContext) {
  const userId = session.userId;
  const roleName = session.roleName;
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
    getSurfacePayload(userId, surfaceId, roleName);

  queryType.getFields().surfaceRows.resolve = async (
    _source,
    args: { surfaceId: string; first?: number; after?: string; search?: string; filters?: ColumnFilter[]; orderBy?: ColumnOrder | null },
  ) => {
    await requirePermission(userId, args.surfaceId, "view", roleName);
    const surface = await getSurfaceMeta(args.surfaceId);
    return surfaceRowsPage(surface, args.first ?? 50, args.after ?? undefined, {
      filters: args.filters,
      search: args.search,
      orderBy: args.orderBy,
    });
  };

  queryType.getFields().auditEvents.resolve = async (
    _source,
    { first, after }: { first?: number; after?: string },
  ) => {
    await requireAdmin(userId);
    return auditEventsPage(first ?? 50, after ?? undefined);
  };

  queryType.getFields().listSurfaces.resolve = async () => listSurfaces(userId, roleName);

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
    await requirePermission(userId, surfaceId, "create", roleName);
    return createRow(surfaceId, values, userId);
  };

  mutationType.getFields().updateRow.resolve = async (
    _source,
    { surfaceId, id, values }: { surfaceId: string; id: string; values: Record<string, unknown> },
  ) => {
    await requirePermission(userId, surfaceId, "update", roleName);
    return updateRow(surfaceId, id, values, userId);
  };

  mutationType.getFields().deleteRows.resolve = async (
    _source,
    { surfaceId, ids }: { surfaceId: string; ids: string[] },
  ) => {
    await requirePermission(userId, surfaceId, "delete", roleName);
    return deleteRows(surfaceId, ids, userId);
  };

  // ---------------- Surface definition CRUD ----------------
  const refreshSurfacePayload = async (surfaceId: string) => getSurfacePayload(userId, surfaceId, roleName);

  mutationType.getFields().updateSurface.resolve = async (
    _source,
    { surfaceId, input }: { surfaceId: string; input: { title?: string; renderer?: string; rootLabel?: string } },
  ) => {
    await requirePermission(userId, surfaceId, "manage", roleName);
    if (input.rootLabel) validateRootLabel(input.rootLabel);
    validateRenderer(input.renderer);
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
    await writeAudit({ actorId: userId, action: "UPDATE", surfaceId, targetId: surfaceId, targetLabel: "Surface", changes: input });
    return refreshSurfacePayload(surfaceId);
  };

  mutationType.getFields().addColumn.resolve = async (
    _source,
    { surfaceId, input }: { surfaceId: string; input: { field: string; label: string; order?: number; source?: string; suggest?: boolean; suggestSource?: string; type?: string; required?: boolean; min?: number | null; max?: number | null; minLength?: number | null; maxLength?: number | null; pattern?: string | null; options?: string[] | null; validationMessage?: string | null } },
  ) => {
    await requirePermission(userId, surfaceId, "manage", roleName);
    validateSource(input.source, input.field);
    const columnType = sanitizeColumnType(input.type);
    const rules = sanitizeValidationRules(input);
    const surface = await getSurfaceMeta(surfaceId);
    const order = input.order ?? Math.max(0, ...surface.columns.map((c) => c.order)) + 1;
    const columnId = `column_${randomUUID()}`;
    const session = driver.session({ defaultAccessMode: "WRITE" });
    try {
      await session.run(
        `MATCH (s:Surface {id: $surfaceId})
         CREATE (c:Column {
           id: $columnId,
           field: $field,
           label: $label,
           order: toInteger($order),
           source: $source,
           suggest: $suggest,
           suggestSource: $suggestSource,
           type: $type,
           required: $required,
           min: $min,
           max: $max,
           minLength: $minLength,
           maxLength: $maxLength,
           pattern: $pattern,
           options: $options,
           validationMessage: $validationMessage
         })
         CREATE (s)-[:HAS_COLUMN]->(c)`,
        {
          surfaceId,
          columnId,
          field: input.field,
          label: input.label,
          order,
          source: input.source ?? null,
          suggest: input.suggest ?? false,
          suggestSource: input.suggestSource ?? null,
          type: columnType,
          required: rules.required,
          min: rules.min,
          max: rules.max,
          minLength: rules.minLength,
          maxLength: rules.maxLength,
          pattern: rules.pattern,
          options: rules.options,
          validationMessage: rules.validationMessage,
        },
      );
    } finally {
      await session.close();
    }
    await writeAudit({ actorId: userId, action: "CREATE", surfaceId, targetId: columnId, targetLabel: "Column", changes: input });
    return refreshSurfacePayload(surfaceId);
  };

  mutationType.getFields().updateColumn.resolve = async (
    _source,
    { surfaceId, columnId, input }: {
      surfaceId: string;
      columnId: string;
      input: { field?: string; label?: string; order?: number; source?: string | null; suggest?: boolean; suggestSource?: string | null; type?: string; required?: boolean; min?: number | null; max?: number | null; minLength?: number | null; maxLength?: number | null; pattern?: string | null; options?: string[] | null; validationMessage?: string | null };
    },
  ) => {
    await requirePermission(userId, surfaceId, "manage", roleName);
    if (input.source != null) validateSource(input.source, input.field ?? "field");
    const columnType = input.type === undefined ? undefined : sanitizeColumnType(input.type);
    const surface = await getSurfaceMeta(surfaceId);
    const existing = surface.columns.find((c) => c.id === columnId);
    if (!existing) {
      throw new GraphQLError("Column not found on this surface", { extensions: { code: "NOT_FOUND" } });
    }
    // Merge in JS so explicit nulls can *clear* a rule (coalesce cannot).
    const merged = {
      ...existing,
      field: input.field ?? existing.field,
      label: input.label ?? existing.label,
      order: input.order ?? existing.order,
      source: input.source !== undefined ? input.source ?? null : existing.source,
      suggest: input.suggest ?? existing.suggest,
      suggestSource: input.suggestSource !== undefined ? input.suggestSource ?? null : existing.suggestSource,
      type: columnType ?? existing.type,
      required: input.required ?? existing.required,
      min: input.min !== undefined ? input.min ?? null : existing.min,
      max: input.max !== undefined ? input.max ?? null : existing.max,
      minLength: input.minLength !== undefined ? input.minLength ?? null : existing.minLength,
      maxLength: input.maxLength !== undefined ? input.maxLength ?? null : existing.maxLength,
      pattern: input.pattern !== undefined ? (input.pattern?.trim() || null) : existing.pattern,
      options: input.options !== undefined ? input.options ?? null : existing.options,
      validationMessage: input.validationMessage !== undefined ? (input.validationMessage?.trim() || null) : existing.validationMessage,
    };
    const rules = sanitizeValidationRules(merged);
    const session = driver.session({ defaultAccessMode: "WRITE" });
    try {
      await session.run(
        `MATCH (c:Column) WHERE elementId(c) = $columnId
         SET c.field = $field, c.label = $label, c.order = toInteger($order), c.source = $source,
             c.suggest = $suggest, c.suggestSource = $suggestSource, c.type = $type,
             c.required = $required, c.min = $min, c.max = $max,
             c.minLength = $minLength, c.maxLength = $maxLength,
             c.pattern = $pattern, c.options = $options, c.validationMessage = $validationMessage`,
        {
          columnId,
          field: merged.field,
          label: merged.label,
          order: merged.order,
          source: merged.source,
          suggest: merged.suggest,
          suggestSource: merged.suggestSource,
          type: merged.type,
          required: rules.required,
          min: rules.min,
          max: rules.max,
          minLength: rules.minLength,
          maxLength: rules.maxLength,
          pattern: rules.pattern,
          options: rules.options,
          validationMessage: rules.validationMessage,
        },
      );
    } finally {
      await session.close();
    }
    await writeAudit({ actorId: userId, action: "UPDATE", surfaceId, targetId: columnId, targetLabel: "Column", changes: input });
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
    await writeAudit({ actorId: userId, action: "DELETE", surfaceId, targetId: columnId, targetLabel: "Column", changes: null });
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

  mutationType.getFields().adminSetPassword.resolve = async (
    _source,
    { id, password }: { id: string; password: string },
  ) => {
    await requireAdmin(userId);
    if (typeof password !== "string" || password.length < 6) {
      throw new GraphQLError("Password must be at least 6 characters", { extensions: { code: "BAD_INPUT" } });
    }
    return adminSetPassword(id, password);
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
    { input }: {
      input: {
        id: string;
        title: string;
        renderer?: string;
        rootLabel?: string;
        columns?: Array<{
          field: string;
          label: string;
          order?: number;
          source?: string;
          suggest?: boolean;
          suggestSource?: string;
          type?: string;
          required?: boolean;
          min?: number | null;
          max?: number | null;
          minLength?: number | null;
          maxLength?: number | null;
          pattern?: string | null;
          options?: string[] | null;
          validationMessage?: string | null;
        }>;
      };
    },
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

  mutationType.getFields().adminRestoreSurface.resolve = async (_source, { id }: { id: string }) => {
    await requireAdmin(userId);
    return adminRestoreSurface(id);
  };

  mutationType.getFields().adminPurgeSurface.resolve = async (_source, { id }: { id: string }) => {
    await requireAdmin(userId);
    return adminPurgeSurface(id);
  };

  return schema;
}
