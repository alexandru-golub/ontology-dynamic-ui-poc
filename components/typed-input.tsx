"use client";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SuggestInput } from "@/components/suggest-input";
import type { ColumnType } from "@/components/data-table";
import { cn } from "@/lib/utils";

/**
 * Value editor for a column of a given type: text/number/date inputs,
 * a yes/no select for booleans, an options select for enum-like columns,
 * and suggestion combobox when available. Raw strings flow out; the server
 * coerces to the column's declared type. An `error` renders a destructive
 * border + message so validation feedback looks the same everywhere.
 */
export function TypedInput({
  type = "string",
  value,
  onChange,
  onCommit,
  onCancel,
  autoFocus,
  suggestions,
  options,
  error,
  id,
  className,
}: {
  type?: ColumnType;
  value: string;
  onChange: (value: string) => void;
  onCommit?: (value: string) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  suggestions?: string[];
  /** Enum-like column: render a select of the allowed values. */
  options?: string[] | null;
  error?: string | null;
  id?: string;
  className?: string;
}) {
  const errorClass = error
    ? "border-destructive focus-visible:ring-destructive"
    : "";

  let control: React.ReactNode;
  if (type === "boolean") {
    control = (
      <Select
        value={value === "" ? "false" : value}
        onValueChange={(next) => {
          onChange(next);
          onCommit?.(next);
        }}
      >
        <SelectTrigger id={id} className={cn(className, errorClass)}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">yes</SelectItem>
          <SelectItem value="false">no</SelectItem>
        </SelectContent>
      </Select>
    );
  } else if (options && options.length > 0) {
    control = (
      <Select
        value={value}
        onValueChange={(next) => {
          onChange(next);
          onCommit?.(next);
        }}
      >
        <SelectTrigger id={id} className={cn(className, errorClass)}>
          <SelectValue placeholder="— choose —" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">— blank —</SelectItem>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  } else if (suggestions && suggestions.length > 0) {
    control = (
      <SuggestInput
        id={id}
        autoFocus={autoFocus}
        value={value}
        onChange={onChange}
        onCommit={(v) => onCommit?.(v)}
        onCancel={onCancel}
        suggestions={suggestions}
        className={cn(className, errorClass)}
      />
    );
  } else {
    const inputType = type === "number" || type === "money" ? "number" : type === "date" ? "date" : "text";
    control = (
      <Input
        id={id}
        autoFocus={autoFocus}
        type={inputType}
        step={type === "money" ? "0.01" : type === "number" ? "any" : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onCommit?.(value);
          if (event.key === "Escape") onCancel?.();
        }}
        onBlur={() => onCommit?.(value)}
        className={cn(className, errorClass)}
      />
    );
  }

  return (
    <div className="w-full">
      {control}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
