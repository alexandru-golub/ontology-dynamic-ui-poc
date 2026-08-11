"use client";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SuggestInput } from "@/components/suggest-input";
import type { ColumnType } from "@/components/data-table";

/**
 * Value editor for a column of a given type: text/number/date inputs,
 * a yes/no select for booleans, and suggestion combobox when available.
 * Raw strings flow out; the server coerces to the column's declared type.
 */
export function TypedInput({
  type = "string",
  value,
  onChange,
  onCommit,
  onCancel,
  autoFocus,
  suggestions,
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
  id?: string;
  className?: string;
}) {
  if (type === "boolean") {
    return (
      <Select
        value={value === "" ? "false" : value}
        onValueChange={(next) => {
          onChange(next);
          onCommit?.(next);
        }}
      >
        <SelectTrigger id={id} className={className}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">yes</SelectItem>
          <SelectItem value="false">no</SelectItem>
        </SelectContent>
      </Select>
    );
  }
  if (suggestions && suggestions.length > 0) {
    return (
      <SuggestInput
        id={id}
        autoFocus={autoFocus}
        value={value}
        onChange={onChange}
        onCommit={(v) => onCommit?.(v)}
        onCancel={onCancel}
        suggestions={suggestions}
        className={className}
      />
    );
  }
  const inputType = type === "number" || type === "money" ? "number" : type === "date" ? "date" : "text";
  return (
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
      className={className}
    />
  );
}
