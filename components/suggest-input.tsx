"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Text input that recommends existing options while typing.
 * Filters the given suggestions as the user types; ArrowUp/Down + Enter to
 * pick, Escape to close/cancel, click to select. `onCommit(value)` is called
 * when a suggestion is picked or Enter is pressed.
 */
export function SuggestInput({
  value,
  onChange,
  onCommit,
  onCancel,
  suggestions,
  autoFocus = false,
  placeholder,
  id,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
  onCancel?: () => void;
  suggestions: string[];
  autoFocus?: boolean;
  placeholder?: string;
  id?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return suggestions.slice(0, 50);
    return suggestions.filter((s) => s.toLowerCase().includes(q)).slice(0, 50);
  }, [suggestions, value]);

  const updateRect = () => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ top: r.bottom + 2, left: r.left, width: r.width });
  };

  // autoFocus can fire the focus event before refs are attached, so measure
  // once the layout is ready (and again on every focus, deferred one frame).
  useLayoutEffect(() => {
    if (autoFocus) updateRect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const select = (suggestion: string) => {
    onChange(suggestion);
    setOpen(false);
    setActive(-1);
    onCommit(suggestion);
  };

  return (
    <div className="relative w-full">
      <input
        ref={inputRef}
        id={id}
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setActive(-1);
          requestAnimationFrame(updateRect);
        }}
        onFocus={() => {
          setOpen(true);
          setActive(-1);
          requestAnimationFrame(updateRect);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, filtered.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((a) => Math.max(a - 1, -1));
          } else if (event.key === "Enter") {
            if (open && active >= 0 && filtered[active]) {
              event.preventDefault();
              select(filtered[active]);
            } else {
              onCommit(value);
            }
          } else if (event.key === "Escape") {
            if (open) {
              event.preventDefault();
              setOpen(false);
              setActive(-1);
            } else {
              onCancel?.();
            }
          }
        }}
        className={cn(
          "flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          className,
        )}
      />
      {open && rect && filtered.length > 0 && (
        <div
          style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width, zIndex: 60 }}
          data-testid="suggest-dropdown"
          className="max-h-48 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          onMouseDown={(event) => event.preventDefault()}
        >
          {filtered.map((suggestion, index) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => select(suggestion)}
              className={cn(
                "block w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                index === active && "bg-accent text-accent-foreground",
              )}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
