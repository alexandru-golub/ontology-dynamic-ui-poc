import { GraphQLError } from "graphql";
import { isInt } from "neo4j-driver";
import { randomUUID } from "node:crypto";
import { driver } from "./neo4j";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type Permissions = Record<"view" | "create" | "update" | "delete" | "export" | "manage", boolean>;
export const COLUMN_TYPES = ["string", "number", "boolean", "date", "money"] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];
export type Column = {
  id: string;
  field: string;
  label: string;
  order: number;
  source: string | null;
  suggest: boolean;
  suggestSource: string | null;
  type: ColumnType;
  // ---- per-field validation rules (graph data, enforced on every write) ----
  required: boolean;
  min: number | null;
  max: number | null;
  minLength: number | null;
  maxLength: number | null;
  pattern: string | null;
  options: string[] | null;
  validationMessage: string | null;
};
export type SurfaceMeta = { id: string; title: string; renderer: string; rootLabel: string; columns: Column[] };
export type SurfaceRow = { id: string; values: Record<string, unknown> };

const ALL_TRUE: Permissions = { view: true, create: true, update: true, delete: true, export: true, manage: true };
const ALL_FALSE: Permissions = { view: false, create: false, update: false, delete: false, export: false, manage: false };
const PERMISSION_KEYS = ["view", "create", "update", "delete", "export", "manage"] as const;

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

export function sanitizeLabel(label: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(label)) {
    throw new GraphQLError(`Invalid label "${label}"`, { extensions: { code: "BAD_INPUT" } });
  }
  return label;
}

/** Renderers implemented in the frontend; `Surface.renderer` must be one of these. */
export const RENDERERS = ["table", "cards", "form", "board", "timeline", "pivot", "gantt"] as const;

export function sanitizeColumnType(type: string | null | undefined, fallback: ColumnType = "string"): ColumnType {
  const value = (type ?? fallback).toLowerCase();
  if (!(COLUMN_TYPES as readonly string[]).includes(value)) {
    throw new GraphQLError(`Invalid column type "${type}". Supported: ${COLUMN_TYPES.join(", ")}.`, {
      extensions: { code: "BAD_INPUT" },
    });
  }
  return value as ColumnType;
}

/**
 * Coerce a raw write value to the column's declared type. Throws a friendly
 * GraphQL error for unparseable values (e.g. "abc" for a number column).
 * Dates are normalized to `yyyy-mm-dd` (or full ISO when a time is given).
 */
export function coerceValue(type: ColumnType, value: unknown): unknown {
  if (value === null || value === undefined || value === "") return value;
  if (type === "string") return String(value);
  if (type === "number" || type === "money") {
    const num = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
    if (Number.isNaN(num)) throw new GraphQLError(`Invalid ${type} value "${value}"`, { extensions: { code: "BAD_INPUT" } });
    return type === "money" ? Math.round(num * 100) / 100 : num;
  }
  if (type === "boolean") {
    if (typeof value === "boolean") return value;
    const text = String(value).trim().toLowerCase();
    if (["true", "yes", "1", "on"].includes(text)) return true;
    if (["false", "no", "0", "off"].includes(text)) return false;
    throw new GraphQLError(`Invalid boolean value "${value}"`, { extensions: { code: "BAD_INPUT" } });
  }
  if (type === "date") {
    const text = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const time = Date.parse(text);
    if (Number.isNaN(time)) throw new GraphQLError(`Invalid date value "${value}"`, { extensions: { code: "BAD_INPUT" } });
    return new Date(time).toISOString();
  }
  return value;
}

// ---------------------------------------------------------------------------
// Per-field validation rules
// ---------------------------------------------------------------------------
export type ValidationRules = Pick<
  Column,
  "required" | "min" | "max" | "minLength" | "maxLength" | "pattern" | "options" | "validationMessage"
>;

/**
 * Sanitize user-supplied validation rules before they hit the graph.
 * Unknown keys are ignored, wrong shapes throw a friendly BAD_INPUT error.
 */
export function sanitizeValidationRules(input: Record<string, unknown> | null | undefined): ValidationRules {
  if (!input) return emptyValidationRules();
  const rules: ValidationRules = emptyValidationRules();

  if (input.required !== undefined && input.required !== null) {
    if (typeof input.required !== "boolean") {
      throw new GraphQLError("Validation rule `required` must be a boolean", { extensions: { code: "BAD_INPUT" } });
    }
    rules.required = input.required;
  }
  for (const key of ["min", "max"] as const) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    const num = Number(value);
    if (!Number.isFinite(num)) {
      throw new GraphQLError(`Validation rule \`${key}\` must be a number`, { extensions: { code: "BAD_INPUT" } });
    }
    rules[key] = num;
  }
  for (const key of ["minLength", "maxLength"] as const) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    const num = Number(value);
    if (!Number.isInteger(num) || num < 0) {
      throw new GraphQLError(`Validation rule \`${key}\` must be a non-negative integer`, { extensions: { code: "BAD_INPUT" } });
    }
    rules[key] = num;
  }
  if (input.pattern !== undefined && input.pattern !== null) {
    if (typeof input.pattern !== "string") {
      throw new GraphQLError("Validation rule `pattern` must be a string", { extensions: { code: "BAD_INPUT" } });
    }
    try {
      new RegExp(input.pattern);
    } catch {
      throw new GraphQLError(`Validation rule \`pattern\` is not a valid regular expression: "${input.pattern}"`, {
        extensions: { code: "BAD_INPUT" },
      });
    }
    rules.pattern = input.pattern;
  }
  if (input.options !== undefined && input.options !== null) {
    if (!Array.isArray(input.options) || input.options.some((o) => typeof o !== "string" || !o.trim())) {
      throw new GraphQLError("Validation rule `options` must be a list of non-empty strings", {
        extensions: { code: "BAD_INPUT" },
      });
    }
    if (input.options.length > 200) {
      throw new GraphQLError("Validation rule `options` supports at most 200 values", { extensions: { code: "BAD_INPUT" } });
    }
    rules.options = [...new Set(input.options.map((o: string) => o.trim()))];
  }
  if (input.validationMessage !== undefined && input.validationMessage !== null) {
    if (typeof input.validationMessage !== "string") {
      throw new GraphQLError("Validation rule `validationMessage` must be a string", { extensions: { code: "BAD_INPUT" } });
    }
    rules.validationMessage = input.validationMessage.trim() || null;
  }
  if (rules.min !== null && rules.max !== null && rules.min > rules.max) {
    throw new GraphQLError("Validation rule `min` cannot be greater than `max`", { extensions: { code: "BAD_INPUT" } });
  }
  if (rules.minLength !== null && rules.maxLength !== null && rules.minLength > rules.maxLength) {
    throw new GraphQLError("Validation rule `minLength` cannot be greater than `maxLength`", {
      extensions: { code: "BAD_INPUT" },
    });
  }
  return rules;
}

export function emptyValidationRules(): ValidationRules {
  return {
    required: false,
    min: null,
    max: null,
    minLength: null,
    maxLength: null,
    pattern: null,
    options: null,
    validationMessage: null,
  };
}

/** Pull the rule fields off a Column (used to persist only the rule subset). */
export function validationRulesOf(column: Column): ValidationRules {
  return {
    required: column.required,
    min: column.min,
    max: column.max,
    minLength: column.minLength,
    maxLength: column.maxLength,
    pattern: column.pattern,
    options: column.options,
    validationMessage: column.validationMessage,
  };
}

function blank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  const text = typeof value === "string" ? value.trim() : String(value);
  return text === "";
}

/**
 * Validate one raw write value against a column's rules. Returns a friendly
 * message (or the column's custom `validationMessage`) or null when valid.
 * Pure function — mirrors client-side `lib/validate.ts`.
 */
export function validateValue(column: Pick<Column, "label" | "field" | "type" | keyof ValidationRules>, raw: unknown): string | null {
  const label = column.label || column.field;
  const fail = (message: string) => column.validationMessage || message;
  if (blank(raw)) {
    return column.required ? fail(`${label} is required`) : null;
  }
  const text = typeof raw === "string" ? raw.trim() : String(raw);
  if (column.options?.length && !column.options.includes(text)) {
    return fail(`${label} must be one of: ${column.options.join(", ")}`);
  }
  if (column.type === "number" || column.type === "money") {
    const num = Number(text.replace(/[$,\s]/g, ""));
    if (!Number.isNaN(num)) {
      if (column.min !== null && num < column.min) return fail(`${label} must be at least ${column.min}`);
      if (column.max !== null && num > column.max) return fail(`${label} must be at most ${column.max}`);
    }
  }
  if (column.minLength !== null && text.length < column.minLength) {
    return fail(`${label} must be at least ${column.minLength} characters`);
  }
  if (column.maxLength !== null && text.length > column.maxLength) {
    return fail(`${label} must be at most ${column.maxLength} characters`);
  }
  if (column.pattern) {
    try {
      if (!new RegExp(column.pattern).test(text)) return fail(`${label} must match ${column.pattern}`);
    } catch {
      // invalid regex stored in the graph — ignore rather than break writes
    }
  }
  return null;
}

/** Validate a values map against the surface's columns (used on every write). */
export function validateColumnValues(columns: Column[], values: Record<string, unknown>): void {
  const errors: Array<{ field: string; message: string }> = [];
  for (const column of columns) {
    if (!(column.field in values)) continue;
    const error = validateValue(column, values[column.field]);
    if (error) errors.push({ field: column.field, message: error });
  }
  if (errors.length > 0) {
    throw new GraphQLError(errors.map((e) => e.message).join("; "), {
      extensions: { code: "BAD_INPUT", fields: errors.map((e) => e.field) },
    });
  }
}

export function validateRenderer(renderer: string | null | undefined): void {
  if (renderer && !(RENDERERS as readonly string[]).includes(renderer)) {
    throw new GraphQLError(
      `Unknown renderer "${renderer}". Supported: ${RENDERERS.join(", ")}.`,
      { extensions: { code: "BAD_INPUT" } },
    );
  }
}

export type ColumnSource =
  | { kind: "self"; prop: string }
  | { kind: "neighbor"; label: string; prop: string; rel: string | null; dir: "in" | "out" | null }
  | { kind: "count"; label: string; rel: string | null; dir: "in" | "out" | null }
  | { kind: "aggregate"; agg: "sum" | "avg" | "min" | "max"; label: string; prop: string; rel: string | null; dir: "in" | "out" | null };

const LABEL_RE = "[A-Za-z_][A-Za-z0-9_]*";

/**
 * Resolve a column's `source` spec into a read/write route.
 *
 * Supported syntax:
 *   self.<prop>                       property on the row root node
 *   <Label>.<prop>                    legacy: neighbor by label (any relationship)
 *   <Label>.count                     legacy: count of neighbors by label
 *   >Rel:Label.<prop>                 outgoing relationship: (root)-[:Rel]->(:Label)
 *   <Rel:Label.<prop>                 incoming relationship: (root)<-[:Rel]-(:Label)
 *   >Rel:Label.count / <Rel:Label.count   counts over a typed relationship
 */
export function parseSource(source: string | null | undefined, field: string): ColumnSource {
  const src = (source ?? "").trim();
  if (src.startsWith("self.")) return { kind: "self", prop: src.slice(5) || field };
  // typed relationship syntax (check before legacy Label.prop)
  const typedCount = src.match(new RegExp(`^([<>])(${LABEL_RE}):(${LABEL_RE})\.count$`));
  if (typedCount) {
    return { kind: "count", label: typedCount[3], rel: typedCount[2], dir: typedCount[1] === ">" ? "out" : "in" };
  }
  const typedAgg = src.match(new RegExp(`^([<>])(${LABEL_RE}):(${LABEL_RE})\.(${LABEL_RE})\.(sum|avg|min|max)$`));
  if (typedAgg) {
    return {
      kind: "aggregate",
      agg: typedAgg[5] as "sum" | "avg" | "min" | "max",
      label: typedAgg[3],
      prop: typedAgg[4],
      rel: typedAgg[2],
      dir: typedAgg[1] === ">" ? "out" : "in",
    };
  }
  const typed = src.match(new RegExp(`^([<>])(${LABEL_RE}):(${LABEL_RE})\.(${LABEL_RE})$`));
  if (typed) {
    return { kind: "neighbor", label: typed[3], prop: typed[4], rel: typed[2], dir: typed[1] === ">" ? "out" : "in" };
  }
  // legacy Label.count
  const countMatch = src.match(new RegExp(`^(${LABEL_RE})\.count$`));
  if (countMatch) return { kind: "count", label: countMatch[1], rel: null, dir: null };
  // legacy Label.prop.agg (any relationship)
  const legacyAgg = src.match(new RegExp(`^(${LABEL_RE})\.(${LABEL_RE})\.(sum|avg|min|max)$`));
  if (legacyAgg) {
    return {
      kind: "aggregate",
      agg: legacyAgg[3] as "sum" | "avg" | "min" | "max",
      label: legacyAgg[1],
      prop: legacyAgg[2],
      rel: null,
      dir: null,
    };
  }
  // legacy Label.prop
  const match = src.match(new RegExp(`^(${LABEL_RE})\.(${LABEL_RE})$`));
  if (match) return { kind: "neighbor", label: match[1], prop: match[2], rel: null, dir: null };
  // legacy inference by field name
  if (field === "customer") return { kind: "neighbor", label: "Customer", prop: "name", rel: null, dir: null };
  if (field === "status") return { kind: "neighbor", label: "Status", prop: "name", rel: null, dir: null };
  if (field === "project") return { kind: "self", prop: "name" };
  return { kind: "self", prop: field };
}

/** Throw a GraphQL error if a column source is not one of the supported shapes. */
export function validateSource(source: string | null | undefined, field: string): void {
  const src = (source ?? "").trim();
  if (!src) return; // legacy inference by field name applies
  const propOrCount = `(${LABEL_RE}|count)`;
  const agg = `(${LABEL_RE})\.(sum|avg|min|max)`;
  const known =
    src.startsWith("self.") ||
    new RegExp(`^[<>]${LABEL_RE}:${LABEL_RE}\.(${LABEL_RE}|count|${LABEL_RE}\.(sum|avg|min|max))$`).test(src) ||
    new RegExp(`^${LABEL_RE}\.(${LABEL_RE}|count|${LABEL_RE}\.(sum|avg|min|max))$`).test(src);
  if (!known) {
    throw new GraphQLError(
      `Invalid column source "${src}" for field "${field}". Use self.prop, Label.prop, Label.count, Label.prop.sum|avg|min|max, >Rel:Label.prop, <Rel:Label.prop, >Rel:Label.count, >Rel:Label.prop.sum|avg|min|max or <Rel:Label.prop.sum|avg|min|max.`,
      { extensions: { code: "BAD_INPUT" } },
    );
  }
}

// ---------------------------------------------------------------------------
// Surface metadata + multi-source row projection
// ---------------------------------------------------------------------------
const surfaceMetaCypher = `
MATCH (s:Surface {id: $surfaceId}) WHERE coalesce(s.deleted, false) = false
OPTIONAL MATCH (s)-[:HAS_COLUMN]->(column:Column)
WITH s, column ORDER BY column.order
RETURN s.id AS id,
       coalesce(s.title, s.name) AS title,
       s.renderer AS renderer,
       coalesce(s.rootLabel, 'Project') AS rootLabel,
       [c IN collect(column) WHERE c IS NOT NULL | {
         id: elementId(c),
         field: c.field,
         label: c.label,
         order: toInteger(c.order),
         source: c.source,
         suggest: coalesce(c.suggest, false),
         suggestSource: c.suggestSource,
         type: coalesce(c.type, 'string'),
         required: coalesce(c.required, false),
         min: c.min,
         max: c.max,
         minLength: c.minLength,
         maxLength: c.maxLength,
         pattern: c.pattern,
         options: c.options,
         validationMessage: c.validationMessage
       }] AS columns`;

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
      columns: record.columns.map((c) => ({
        ...c,
        order: Number(c.order),
        type: sanitizeColumnType(c.type),
        required: Boolean(c.required),
        min: c.min === null || c.min === undefined ? null : Number(c.min),
        max: c.max === null || c.max === undefined ? null : Number(c.max),
        minLength: c.minLength === null || c.minLength === undefined ? null : Number(c.minLength),
        maxLength: c.maxLength === null || c.maxLength === undefined ? null : Number(c.maxLength),
        pattern: c.pattern ?? null,
        options: Array.isArray(c.options) ? c.options.map(String) : null,
        validationMessage: c.validationMessage ?? null,
      })),
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
export type ColumnFilter = { field: string; op: "eq" | "neq" | "contains" | "gt" | "lt"; value: string };
export type ColumnOrder = { field: string; direction: "ASC" | "DESC" };
export type ProjectionOpts = { rowId?: string; filters?: ColumnFilter[]; search?: string; orderBy?: ColumnOrder | null };

/** Property names are embedded in backticks, so restrict them to safe identifiers. */
function sanitizeProp(prop: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(prop)) {
    throw new GraphQLError(`Invalid property "${prop}"`, { extensions: { code: "BAD_INPUT" } });
  }
  return prop;
}

const NUMERIC = /^-?\d+(\.\d+)?$/;

/**
 * Build one filter condition for a projected column alias. `value` is the raw
 * string from the UI; numeric-looking values compare numerically, everything
 * else as text. An empty value means "blank" for eq/neq.
 */
function buildFilterCondition(filter: ColumnFilter, alias: string, params: Record<string, unknown>): string {
  const value = filter.value ?? "";
  const key = `f_${alias}`;
  const blank = `(${alias} IS NULL OR toString(${alias}) = '')`;
  if (filter.op === "eq") {
    if (value === "") return blank;
    if (NUMERIC.test(value.trim())) {
      params[key] = Number(value.trim());
      return `${alias} = $${key}`;
    }
    params[key] = value;
    return `toString(${alias}) = $${key}`;
  }
  if (filter.op === "neq") {
    if (value === "") return `NOT (${blank})`;
    if (NUMERIC.test(value.trim())) {
      params[key] = Number(value.trim());
      return `${alias} <> $${key}`;
    }
    params[key] = value;
    return `toString(${alias}) <> $${key}`;
  }
  if (filter.op === "contains") {
    if (value === "") return "true";
    params[key] = value.toLowerCase();
    return `toLower(toString(${alias})) CONTAINS $${key}`;
  }
  // gt / lt
  if (value === "") return "true";
  const symbol = filter.op === "gt" ? ">" : "<";
  if (NUMERIC.test(value.trim())) {
    params[key] = Number(value.trim());
    return `${alias} ${symbol} $${key}`;
  }
  params[key] = value;
  return `toString(${alias}) ${symbol} $${key}`;
}

/**
 * Build a projection query for a surface rooted at `rootLabel`.
 * Each column pulls from its own source (self property, neighbor property,
 * neighbor count), so a single surface can mix data from many node types.
 * Every column gets a `vN` alias (self props too) so filters, search and
 * ordering can be applied server-side over the *projected* values.
 */
function buildProjectionQuery(rootLabel: string, columns: Column[], opts: ProjectionOpts = {}) {
  const label = sanitizeLabel(rootLabel);
  // OPTIONAL MATCHes for neighbor/count columns run in the main query scope;
  // aggregates run in isolated CALL { } subqueries. Multiple OPTIONAL MATCHes
  // in one scope multiply result rows (cartesian product), which corrupts
  // sum() (avg/min/max and count(DISTINCT) happen to be duplication-invariant);
  // a subquery per aggregate column keeps every value exact.
  const matchClauses: string[] = [];
  const callClauses: string[] = [];
  const callAliases: string[] = [];
  const returns: string[] = [];
  const aliases: Record<string, string> = {};
  const params: Record<string, unknown> = {};
  columns.forEach((column, index) => {
    const source = parseSource(column.source, column.field);
    const alias = `v${index}`;
    if (source.kind === "self") {
      returns.push(`root.\`${sanitizeProp(source.prop)}\` AS ${alias}`);
    } else if (source.kind === "neighbor") {
      const pattern =
        source.rel && source.dir === "in"
          ? `(root)<-[n${index}_r:${source.rel}]-(n${index}:${source.label})`
          : source.rel && source.dir === "out"
            ? `(root)-[n${index}_r:${source.rel}]->(n${index}:${source.label})`
            : `(root)--(n${index}:${source.label})`;
      matchClauses.push(`OPTIONAL MATCH ${pattern}`);
      returns.push(`collect(DISTINCT n${index}.${source.prop})[0] AS ${alias}`);
    } else if (source.kind === "count") {
      const pattern =
        source.rel && source.dir === "in"
          ? `(root)<-[n${index}_r:${source.rel}]-(n${index}:${source.label})`
          : source.rel && source.dir === "out"
            ? `(root)-[n${index}_r:${source.rel}]->(n${index}:${source.label})`
            : `(root)--(n${index}:${source.label})`;
      matchClauses.push(`OPTIONAL MATCH ${pattern}`);
      returns.push(`count(DISTINCT n${index}) AS ${alias}`);
    } else if (source.kind === "aggregate") {
      // Numeric aggregation over a typed (or any) relationship. toFloat keeps
      // string-stored numbers working; non-numeric values are ignored, and
      // empty sets yield 0 for sum (null for avg/min/max) — matching SQL.
      const pattern =
        source.rel && source.dir === "in"
          ? `(root)<-[n${index}_r:${source.rel}]-(n${index}:${source.label})`
          : source.rel && source.dir === "out"
            ? `(root)-[n${index}_r:${source.rel}]->(n${index}:${source.label})`
            : `(root)--(n${index}:${source.label})`;
      callClauses.push(
        `CALL { WITH root\nOPTIONAL MATCH ${pattern}\nRETURN ${source.agg}(toFloat(n${index}.${source.prop})) AS ${alias} }`,
      );
      callAliases.push(alias);
    }
    aliases[column.field] = alias;
  });

  const whereParts: string[] = [];
  if (opts.rowId) {
    whereParts.push("elementId(root) = $rowId");
    params.rowId = opts.rowId;
  }
  for (const filter of opts.filters ?? []) {
    const alias = aliases[filter.field];
    if (!alias) {
      throw new GraphQLError(`Unknown filter field "${filter.field}".`, { extensions: { code: "BAD_INPUT" } });
    }
    const condition = buildFilterCondition(filter, alias, params);
    if (condition !== "true") whereParts.push(condition);
  }
  const search = opts.search?.trim();
  if (search) {
    params.search = search.toLowerCase();
    whereParts.push(
      `(${columns.map((_, index) => `toLower(toString(v${index})) CONTAINS toLower($search)`).join(" OR ")})`,
    );
  }
  const where = whereParts.length ? `WHERE ${whereParts.join("\nAND ")}` : "";
  const projected = returns.length ? ", " + returns.join(", ") : "";
  const returnAliases = columns.length ? ", " + columns.map((_, index) => `v${index}`).join(", ") : "";
  // 1) MATCH roots; 2) aggregate CALLs (one row per root); 3) carry root +
  //    aggregate aliases; 4) neighbor/count OPTIONAL MATCHes; 5) project all
  //    aliases (collect/count collapse the multiplied rows back to one/root);
  //    the RETURN may only reference aliases bound in that final WITH.
  const core =
    `MATCH (root:\`${label}\`)\n` +
    (callClauses.length ? callClauses.join("\n") + "\n" : "") +
    `WITH root${callAliases.length ? ", " + callAliases.join(", ") : ""}\n` +
    (matchClauses.length ? matchClauses.join("\n") + "\n" : "") +
    `WITH root, elementId(root) AS id, properties(root) AS rootProps${projected}${callAliases.length ? ", " + callAliases.join(", ") : ""}\n` +
    where;
  const query = `${core}\nRETURN id, rootProps${returnAliases}`;
  return { query, core, aliases, params };
}

function assembleRows(records: unknown[], columns: Column[], aliases: Record<string, string>): SurfaceRow[] {
  return records.map((record) => {
    const obj = (record as { toObject(): Record<string, unknown> }).toObject();
    const rootProps = (obj.rootProps ?? {}) as Record<string, unknown>;
    const values: Record<string, unknown> = {};
    for (const column of columns) {
      const source = parseSource(column.source, column.field);
      if (source.kind === "self") values[column.field] = toPlain(rootProps[source.prop]) ?? null;
      else {
        let value = toPlain(obj[aliases[column.field]]);
        // money aggregates can accumulate float error (0.1 + 0.2); round to cents
        if (source.kind === "aggregate" && column.type === "money" && typeof value === "number") {
          value = Math.round(value * 100) / 100;
        }
        values[column.field] = value ?? null;
      }
    }
    return { id: String(obj.id), values };
  });
}

export async function runSurfaceRows(surface: SurfaceMeta, rowId?: string): Promise<SurfaceRow[]> {
  const { query, aliases, params } = buildProjectionQuery(surface.rootLabel, surface.columns, { rowId });
  const session = driver.session({ defaultAccessMode: "READ" });
  try {
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
// Row CRUD (generic over the surface's root label + typed relationship sources)
// ---------------------------------------------------------------------------
type LinkSpec = { rel: string; dir: "in" | "out"; label: string; prop: string; name: string };

/** Relationship map used by legacy (untyped) neighbor sources for writes. */
const LEGACY_LINKS: Record<string, { rel: string; dir: "in" | "out" }> = {
  Customer: { rel: "HAS_PROJECT", dir: "in" },
  Status: { rel: "HAS_STATUS", dir: "out" },
  Role: { rel: "HAS_ROLE", dir: "out" },
};

/**
 * Route an incoming `values` map onto root properties and typed-relationship
 * neighbors. Neighbors are keyed by column field so mutation responses can be
 * assembled per column. Untyped (`Label.prop`) sources fall back to the legacy
 * link map; unknown labels are read-only (no write). Self-property values are
 * coerced to the column's declared type (number/boolean/date/money/string).
 */
function routeValues(columns: Column[], values: Record<string, unknown>) {
  validateColumnValues(columns, values);
  const props: Record<string, unknown> = {};
  const neighbors: Record<string, LinkSpec> = {};
  for (const column of columns) {
    const raw = values[column.field];
    if (raw === undefined || raw === null) continue;
    const text = typeof raw === "string" ? raw.trim() : String(raw);
    const source = parseSource(column.source, column.field);
    if (source.kind === "self") {
      props[source.prop] = coerceValue(column.type ?? "string", toPlain(raw));
    } else if (source.kind === "neighbor") {
      let rel = source.rel;
      let dir = source.dir;
      if (!rel || !dir) {
        const legacy = LEGACY_LINKS[source.label];
        if (!legacy) continue; // read-only column
        rel = legacy.rel;
        dir = legacy.dir;
      }
      if (text !== "") {
        neighbors[column.field] = { rel, dir, label: source.label, prop: source.prop, name: text };
      }
    }
  }
  return { props, neighbors };
}

/** Build the mutation response values from what was actually written. */
function valuesFromWrite(
  surface: SurfaceMeta,
  rootProps: Record<string, unknown>,
  neighbors: Record<string, LinkSpec>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const column of surface.columns) {
    const source = parseSource(column.source, column.field);
    if (source.kind === "self") values[column.field] = toPlain(rootProps[source.prop]) ?? null;
    else if (source.kind === "neighbor") values[column.field] = neighbors[column.field]?.name ?? null;
    else values[column.field] = null;
  }
  return values;
}

/** The (rel, dir) pairs a surface can write to — used to detach stale links on update. */
function writableLinkKinds(surface: SurfaceMeta): Array<{ rel: string; dir: "in" | "out" }> {
  const kinds = new Map<string, { rel: string; dir: "in" | "out" }>();
  for (const column of surface.columns) {
    const source = parseSource(column.source, column.field);
    if (source.kind !== "neighbor") continue;
    let rel = source.rel;
    let dir = source.dir;
    if (!rel || !dir) {
      const legacy = LEGACY_LINKS[source.label];
      if (!legacy) continue;
      rel = legacy.rel;
      dir = legacy.dir;
    }
    kinds.set(`${dir}:${rel}`, { rel, dir });
  }
  return [...kinds.values()];
}

type AuditInput = {
  actorId: string;
  action: "CREATE" | "UPDATE" | "DELETE";
  surfaceId: string;
  surfaceTitle?: string | null;
  targetId?: string | null;
  targetLabel?: string | null;
  changes?: unknown;
};

/** Shared Cypher tail: create an AuditEvent node and link the actor to it. */
function auditTail(): string {
  return `
CREATE (a:AuditEvent {id: $auditId, action: $auditAction, actorId: $actorId, surfaceId: $surfaceId, surfaceTitle: $surfaceTitle, targetId: $targetId, targetLabel: $targetLabel, changes: $changes, at: toString(datetime())})
WITH a, root
OPTIONAL MATCH (u:User {id: $actorId})
SET a.actorName = coalesce(u.name, $actorId)
FOREACH (_ IN CASE WHEN u IS NULL THEN [] ELSE [1] END | CREATE (u)-[:PERFORMED]->(a))`;
}

function auditParams(audit: AuditInput, surface: SurfaceMeta): Record<string, unknown> {
  return {
    auditId: `audit_${randomUUID()}`,
    auditAction: audit.action,
    actorId: audit.actorId,
    surfaceId: audit.surfaceId,
    surfaceTitle: audit.surfaceTitle ?? surface.title,
    targetId: audit.targetId ?? null,
    targetLabel: audit.targetLabel ?? "Row",
    changes: audit.changes === undefined ? null : JSON.stringify(audit.changes),
  };
}

export async function createRow(surfaceId: string, values: Record<string, unknown>, actorId: string): Promise<SurfaceRow> {
  const surface = await getSurfaceMeta(surfaceId);
  const { props, neighbors } = routeValues(surface.columns, values);
  const label = sanitizeLabel(surface.rootLabel);
  const specs = Object.values(neighbors);
  const mergeParts = specs.map((spec, i) => `MERGE (n_${i}:${spec.label} {${spec.prop}: $prop_${i}})`);
  const linkParts = specs.map((spec, i) =>
    spec.dir === "in" ? `CREATE (n_${i})-[:${spec.rel}]->(root)` : `CREATE (root)-[:${spec.rel}]->(n_${i})`,
  );
  const written: Record<string, unknown> = { ...props };
  for (const [field, spec] of Object.entries(neighbors)) written[field] = spec.name;
  const query = `
CREATE (root:\`${label}\` {id: $rowId})
SET root += $props
${mergeParts.join("\n")}
${linkParts.join("\n")}
${auditTail()}
RETURN elementId(root) AS id, properties(root) AS rootProps`;
  const params: Record<string, unknown> = {
    rowId: `row_${randomUUID()}`,
    props,
    ...auditParams({ actorId, action: "CREATE", surfaceId, changes: written }, surface),
  };
  specs.forEach((spec, i) => {
    params[`prop_${i}`] = spec.name;
  });
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    const result = await session.run(query, params);
    const obj = result.records[0].toObject() as { id: string; rootProps: Record<string, unknown> };
    return { id: String(obj.id), values: valuesFromWrite(surface, obj.rootProps, neighbors) };
  } finally {
    await session.close();
  }
}

export async function updateRow(
  surfaceId: string,
  rowId: string,
  values: Record<string, unknown>,
  actorId: string,
): Promise<SurfaceRow> {
  const surface = await getSurfaceMeta(surfaceId);
  const current = (await runSurfaceRows(surface, rowId))[0];
  if (!current) throw new GraphQLError("Row not found", { extensions: { code: "NOT_FOUND" } });
  const merged = { ...current.values, ...values };
  const { props, neighbors } = routeValues(surface.columns, merged);
  const specs = Object.values(neighbors);
  const params: Record<string, unknown> = { rowId, props };
  specs.forEach((spec, i) => {
    params[`prop_${i}`] = spec.name;
  });

  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const column of surface.columns) {
    const before = current.values[column.field];
    const after = merged[column.field];
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      diff[column.field] = { from: before ?? null, to: after ?? null };
    }
  }

  // Three statements, each individually valid Cypher (a MATCH may not follow a
  // SET/CREATE/DELETE/MERGE updating clause without an intervening WITH).
  const deleteRels = `
MATCH (root) WHERE elementId(root) = $rowId
${writableLinkKinds(surface)
  .map(
    (kind) =>
      kind.dir === "in"
        ? `OPTIONAL MATCH (root)<-[r_${kind.rel}:${kind.rel}]-() DELETE r_${kind.rel}`
        : `OPTIONAL MATCH (root)-[r_${kind.rel}:${kind.rel}]->() DELETE r_${kind.rel}`,
  )
  .join("\nWITH root\n")}`;
  const setProps = `
MATCH (root) WHERE elementId(root) = $rowId
SET root += $props`;
  const relink = `
MATCH (root) WHERE elementId(root) = $rowId
${specs.map((spec, i) => `MERGE (n_${i}:${spec.label} {${spec.prop}: $prop_${i}})`).join("\n")}
${specs
  .map((spec, i) => (spec.dir === "in" ? `CREATE (n_${i})-[:${spec.rel}]->(root)` : `CREATE (root)-[:${spec.rel}]->(n_${i})`))
  .join("\n")}
${auditTail()}
RETURN elementId(root) AS id, properties(root) AS rootProps`;

  const session = driver.session({ defaultAccessMode: "WRITE" });
  const tx = session.beginTransaction();
  try {
    // All three statements (detach, set props, relink + audit) run inside one
    // transaction: a failure in any of them rolls back the whole update.
    await tx.run(deleteRels, params);
    await tx.run(setProps, params);
    const result = await tx.run(relink, {
      ...params,
      ...auditParams({ actorId, action: "UPDATE", surfaceId, targetId: rowId, changes: diff }, surface),
    });
    const obj = result.records[0].toObject() as { id: string; rootProps: Record<string, unknown> };
    await tx.commit();
    return { id: String(obj.id), values: valuesFromWrite(surface, obj.rootProps, neighbors) };
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    await session.close();
  }
}

export async function deleteRows(surfaceId: string, ids: string[], actorId: string): Promise<number> {
  const surface = await getSurfaceMeta(surfaceId);
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    // Capture the rows' last-known state first (they are gone after the delete).
    const capture = await session.run(
      `MATCH (n) WHERE elementId(n) IN $ids RETURN elementId(n) AS id, properties(n) AS props`,
      { ids },
    );
    const auditRows = capture.records.map((record) => {
      const obj = record.toObject();
      return {
        auditId: `audit_${randomUUID()}`,
        targetId: String(obj.id),
        changes: JSON.stringify(toPlain(obj.props)),
      };
    });
    if (auditRows.length > 0) {
      await session.run(
        `
UNWIND $auditRows AS row
CREATE (a:AuditEvent {id: row.auditId, action: $auditAction, actorId: $actorId, surfaceId: $surfaceId, surfaceTitle: $surfaceTitle, targetId: row.targetId, targetLabel: $targetLabel, changes: row.changes, at: toString(datetime())})
WITH a
OPTIONAL MATCH (u:User {id: $actorId})
SET a.actorName = coalesce(u.name, $actorId)
FOREACH (_ IN CASE WHEN u IS NULL THEN [] ELSE [1] END | CREATE (u)-[:PERFORMED]->(a))`,
        {
          auditRows,
          auditAction: "DELETE",
          actorId,
          surfaceId,
          surfaceTitle: surface.title,
          targetLabel: "Row",
        },
      );
    }
    const result = await session.run(
      `MATCH (n) WHERE elementId(n) IN $ids DETACH DELETE n RETURN count(n) AS cnt`,
      { ids },
    );
    return result.records[0].get("cnt").toNumber();
  } finally {
    await session.close();
  }
}

/**
 * Write an AuditEvent in its own transaction (used for surface/column
 * definition changes, where the mutation itself lives in the resolver).
 */
export async function writeAudit(audit: AuditInput): Promise<void> {
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    await session.run(
      `
CREATE (a:AuditEvent {id: $auditId, action: $auditAction, actorId: $actorId, surfaceId: $surfaceId, surfaceTitle: $surfaceTitle, targetId: $targetId, targetLabel: $targetLabel, changes: $changes, at: toString(datetime())})
WITH a
OPTIONAL MATCH (u:User {id: $actorId})
SET a.actorName = coalesce(u.name, $actorId)
FOREACH (_ IN CASE WHEN u IS NULL THEN [] ELSE [1] END | CREATE (u)-[:PERFORMED]->(a))`,
      {
        auditId: `audit_${randomUUID()}`,
        auditAction: audit.action,
        actorId: audit.actorId,
        surfaceId: audit.surfaceId ?? null,
        surfaceTitle: audit.surfaceTitle ?? null,
        targetId: audit.targetId ?? null,
        targetLabel: audit.targetLabel ?? null,
        changes: audit.changes === undefined ? null : JSON.stringify(audit.changes),
      },
    );
  } finally {
    await session.close();
  }
}

export type AuditEvent = {
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

export type AuditPage = {
  edges: Array<{ cursor: string; node: AuditEvent }>;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  totalCount: number;
};

/** Offset-paged audit trail, newest first. */
export async function auditEventsPage(first = 50, after?: string): Promise<AuditPage> {
  const limit = Math.min(Math.max(first, 1), 500);
  const skip = after ? parseInt(Buffer.from(after, "base64url").toString("utf8").replace("offset:", ""), 10) || 0 : 0;
  const session = driver.session({ defaultAccessMode: "READ" });
  try {
    const countResult = await session.run(`MATCH (a:AuditEvent) RETURN count(a) AS c`);
    const totalCount = countResult.records[0].get("c").toNumber();
    const result = await session.run(
      `MATCH (a:AuditEvent)
       RETURN a.id AS id, a.at AS at, a.actorId AS actorId, a.actorName AS actorName, a.action AS action,
              a.surfaceId AS surfaceId, a.surfaceTitle AS surfaceTitle, a.targetId AS targetId, a.targetLabel AS targetLabel, a.changes AS changes
       ORDER BY a.at DESC, elementId(a) DESC
       SKIP toInteger($skip) LIMIT toInteger($limit)`,
      { skip, limit },
    );
    const nodes = result.records.map((record) => {
      const obj = record.toObject();
      return {
        id: String(obj.id),
        at: String(obj.at ?? ""),
        actorId: String(obj.actorId ?? ""),
        actorName: String(obj.actorName ?? obj.actorId ?? ""),
        action: String(obj.action ?? ""),
        surfaceId: obj.surfaceId ? String(obj.surfaceId) : null,
        surfaceTitle: obj.surfaceTitle ? String(obj.surfaceTitle) : null,
        targetId: obj.targetId ? String(obj.targetId) : null,
        targetLabel: obj.targetLabel ? String(obj.targetLabel) : null,
        changes:
          obj.changes === undefined || obj.changes === null
            ? null
            : typeof obj.changes === "string"
              ? JSON.parse(obj.changes)
              : toPlain(obj.changes),
      };
    });
    const edges = nodes.map((node, i) => ({ cursor: Buffer.from(`offset:${skip + i}`).toString("base64url"), node }));
    const endCursor = edges.length ? Buffer.from(`offset:${skip + edges.length}`).toString("base64url") : null;
    return { edges, pageInfo: { hasNextPage: skip + nodes.length < totalCount, endCursor }, totalCount };
  } finally {
    await session.close();
  }
}

// ---------------------------------------------------------------------------
// Paged row connection (cursor = base64 offset)
// Filters / search / orderBy apply server-side over the projected values, so
// the cursor (offset) always refers to the *filtered, ordered* result set.
// ---------------------------------------------------------------------------
export type RowPage = {
  edges: Array<{ cursor: string; node: SurfaceRow }>;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  totalCount: number;
};

export async function surfaceRowsPage(
  surface: SurfaceMeta,
  first = 50,
  after?: string,
  opts: { filters?: ColumnFilter[]; search?: string; orderBy?: ColumnOrder | null } = {},
): Promise<RowPage> {
  const limit = Math.min(Math.max(first, 1), 500);
  const skip = after ? parseInt(Buffer.from(after, "base64url").toString("utf8").replace("offset:", ""), 10) || 0 : 0;
  const { query, core, aliases, params } = buildProjectionQuery(surface.rootLabel, surface.columns, opts);
  const orderClause = (() => {
    if (!opts.orderBy) return "ORDER BY elementId(root)";
    const alias = aliases[opts.orderBy.field];
    if (!alias) {
      throw new GraphQLError(`Unknown orderBy field "${opts.orderBy.field}".`, { extensions: { code: "BAD_INPUT" } });
    }
    // Nulls sort last in both directions, then by elementId for a stable cursor.
    return `ORDER BY ${alias} IS NULL, ${alias} ${opts.orderBy.direction}, elementId(root)`;
  })();
  const session = driver.session({ defaultAccessMode: "READ" });
  try {
    const countResult = await session.run(`${core}\nRETURN count(root) AS c`, params);
    const totalCount = countResult.records[0].get("c").toNumber();
    const pageResult = await session.run(`${query}\n${orderClause} SKIP toInteger($skip) LIMIT toInteger($limit)`, { ...params, skip, limit });
    const rows = assembleRows(pageResult.records, surface.columns, aliases);
    const edges = rows.map((node, i) => ({ cursor: Buffer.from(`offset:${skip + i}`).toString("base64url"), node }));
    // The end cursor points one past the last returned row, so the next page
    // skips exactly what this page consumed.
    const endCursor = edges.length ? Buffer.from(`offset:${skip + edges.length}`).toString("base64url") : null;
    return { edges, pageInfo: { hasNextPage: skip + rows.length < totalCount, endCursor }, totalCount };
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
        `MATCH (s:Surface) WHERE coalesce(s.deleted, false) = false RETURN s.id AS id, coalesce(s.title, s.name) AS title, s.renderer AS renderer, coalesce(s.rootLabel, 'Project') AS rootLabel ORDER BY s.id`,
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
WHERE s IS NOT NULL AND coalesce(s.deleted, false) = false
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

/**
 * Distinct existing values for every column with `suggest` enabled.
 * For neighbor sources it pulls from the neighbor label (e.g. all Customer
 * names), for self sources from the surface's root label — so suggestions are
 * not limited to rows currently visible in this surface.
 */
export async function getSuggestions(surface: SurfaceMeta): Promise<Array<{ field: string; values: string[] }>> {
  const groups: Array<{ field: string; label: string; prop: string }> = [];
  for (const column of surface.columns) {
    if (!column.suggest) continue;
    const source = parseSource(column.source, column.field);
    if (source.kind === "count" || source.kind === "aggregate") continue;
    const label = column.suggestSource ?? (source.kind === "neighbor" ? source.label : surface.rootLabel);
    groups.push({ field: column.field, label, prop: source.prop });
  }
  if (groups.length === 0) return [];
  const session = driver.session({ defaultAccessMode: "READ" });
  try {
    const results: Array<{ field: string; values: string[] }> = [];
    for (const group of groups) {
      const label = sanitizeLabel(group.label);
      const result = await session.run(
        `MATCH (n:\`${label}\`) WHERE n[$prop] IS NOT NULL AND toString(n[$prop]) <> '' RETURN DISTINCT toString(n[$prop]) AS v ORDER BY v LIMIT 100`,
        { prop: group.prop },
      );
      results.push({ field: group.field, values: result.records.map((record) => record.get("v") as string) });
    }
    return results;
  } finally {
    await session.close();
  }
}

export async function getSurfacePayload(userId: string, surfaceId: string) {
  const permissions = await requirePermission(userId, surfaceId, "view");
  const surface = await getSurfaceMeta(surfaceId);
  const [rows, suggestions] = await Promise.all([runSurfaceRows(surface), getSuggestions(surface)]);
  return {
    id: surface.id,
    title: surface.title,
    renderer: surface.renderer,
    rootLabel: surface.rootLabel,
    columns: surface.columns,
    permissions,
    rows,
    suggestions,
  };
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
          permissions: { ...ALL_FALSE, ...(toPlain(grant.permissions) as Permissions) },
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
RETURN s.id AS id, coalesce(s.title, s.name) AS title, s.renderer AS renderer, coalesce(s.rootLabel, 'Project') AS rootLabel, count(c) AS columnCount, coalesce(s.deleted, false) AS deleted
ORDER BY s.id`,
    );
    return result.records.map((record) => {
      const obj = record.toObject();
      return { id: obj.id, title: obj.title, renderer: obj.renderer, rootLabel: obj.rootLabel, columnCount: toPlain(obj.columnCount), deleted: Boolean(obj.deleted) };
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
    try {
      await session.run(
        `CREATE (u:User {id: $id, name: $name, isAdmin: coalesce($isAdmin, false)})`,
        { id: input.id, name: input.name, isAdmin: input.isAdmin ?? false },
      );
    } catch (err) {
      if (err instanceof Error && /constraint|ConstraintValidationFailed|already exists/i.test(err.message)) {
        throw new GraphQLError(`A user with id "${input.id}" already exists`, { extensions: { code: "BAD_USER_INPUT" } });
      }
      throw err;
    }
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
        permissions: { ...ALL_FALSE, ...(toPlain(grant.permissions) as Permissions) },
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
}) {
  sanitizeLabel(input.rootLabel ?? "Project");
  validateRenderer(input.renderer);
  for (const column of input.columns ?? []) {
    if (!column.field?.trim() || !column.label?.trim()) {
      throw new GraphQLError("Column field and label are required", { extensions: { code: "BAD_INPUT" } });
    }
    validateSource(column.source, column.field);
    sanitizeColumnType(column.type);
    sanitizeValidationRules(column);
  }
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    try {
      await session.run(
        `CREATE (s:Surface {id: $id, title: $title, renderer: coalesce($renderer, 'table'), rootLabel: coalesce($rootLabel, 'Project')})`,
        { id: input.id, title: input.title, renderer: input.renderer ?? null, rootLabel: input.rootLabel ?? null },
      );
    } catch (err) {
      if (err instanceof Error && /constraint|already exists/i.test(err.message)) {
        throw new GraphQLError(`A surface with id "${input.id}" already exists`, { extensions: { code: "BAD_USER_INPUT" } });
      }
      throw err;
    }
    for (const [index, column] of (input.columns ?? []).entries()) {
      const rules = sanitizeValidationRules(column);
      await session.run(
        `MATCH (s:Surface {id: $id})
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
          id: input.id,
          columnId: `column_${randomUUID()}`,
          field: column.field,
          label: column.label,
          order: column.order ?? index + 1,
          source: column.source ?? null,
          suggest: column.suggest ?? false,
          suggestSource: column.suggestSource ?? null,
          type: sanitizeColumnType(column.type),
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
    }
  } finally {
    await session.close();
  }
  return { id: input.id, title: input.title, renderer: input.renderer ?? "table", rootLabel: input.rootLabel ?? "Project" };
}

export async function adminUpdateSurface(id: string, input: { title?: string; renderer?: string; rootLabel?: string }) {
  if (input.rootLabel) sanitizeLabel(input.rootLabel);
  if (input.renderer) validateRenderer(input.renderer);
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
  // Soft delete: keep the definition graph, hide the surface everywhere.
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    const result = await session.run(
      `MATCH (s:Surface {id: $id}) SET s.deleted = true RETURN count(s) AS cnt`,
      { id },
    );
    return result.records[0].get("cnt").toNumber() > 0;
  } finally {
    await session.close();
  }
}

export async function adminRestoreSurface(id: string): Promise<boolean> {
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    const result = await session.run(
      `MATCH (s:Surface {id: $id}) SET s.deleted = false RETURN count(s) AS cnt`,
      { id },
    );
    return result.records[0].get("cnt").toNumber() > 0;
  } finally {
    await session.close();
  }
}

export async function adminPurgeSurface(id: string): Promise<boolean> {
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    await session.run(`MATCH (s:Surface {id: $id}) OPTIONAL MATCH (s)-[:HAS_COLUMN]->(c:Column) DETACH DELETE c`, { id });
    const result = await session.run(`MATCH (s:Surface {id: $id}) DETACH DELETE s RETURN count(s) AS cnt`, { id });
    return result.records[0].get("cnt").toNumber() > 0;
  } finally {
    await session.close();
  }
}
