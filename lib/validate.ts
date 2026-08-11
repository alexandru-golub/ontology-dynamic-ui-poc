/**
 * Client-side mirror of the server's per-field validation (lib/db.ts
 * `validateValue`). Kept dependency-free so it can run in the browser and
 * give instant feedback; the server re-validates on every write regardless.
 */
import type { TableColumn } from "@/components/data-table";

export type ValidatableColumn = Pick<
  TableColumn,
  "label" | "field" | "type" | "required" | "min" | "max" | "minLength" | "maxLength" | "pattern" | "options" | "validationMessage"
>;

function blank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  const text = typeof value === "string" ? value.trim() : String(value);
  return text === "";
}

/** Returns a friendly error message, or null when the value passes. */
export function validateField(column: ValidatableColumn | undefined, raw: unknown): string | null {
  if (!column) return null;
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
      if (column.min !== null && column.min !== undefined && num < column.min) return fail(`${label} must be at least ${column.min}`);
      if (column.max !== null && column.max !== undefined && num > column.max) return fail(`${label} must be at most ${column.max}`);
    }
  }
  if (column.minLength !== null && column.minLength !== undefined && text.length < column.minLength) {
    return fail(`${label} must be at least ${column.minLength} characters`);
  }
  if (column.maxLength !== null && column.maxLength !== undefined && text.length > column.maxLength) {
    return fail(`${label} must be at most ${column.maxLength} characters`);
  }
  if (column.pattern) {
    try {
      if (!new RegExp(column.pattern).test(text)) return fail(`${label} must match ${column.pattern}`);
    } catch {
      // invalid regex stored in the graph — ignore rather than block input
    }
  }
  return null;
}

/** Validate a whole values map; returns { field: error } for failing fields. */
export function validateValues(
  columns: ValidatableColumn[] | undefined,
  values: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const column of columns ?? []) {
    if (!(column.field in values)) continue;
    const error = validateField(column, values[column.field]);
    if (error) errors[column.field] = error;
  }
  return errors;
}
