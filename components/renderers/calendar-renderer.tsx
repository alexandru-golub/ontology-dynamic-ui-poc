"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCell, sortedColumns, type RendererProps } from "./types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
/** How many chips a day cell shows before collapsing into "+N more". */
const MAX_CHIPS_PER_DAY = 3;

type CalEvent = {
  rowId: string;
  title: string;
  start: Date;
  end: Date;
  /** true when the event started before this cell's day (continuation). */
  continuesBefore: boolean;
  /** true when the event ends after this cell's day. */
  continuesAfter: boolean;
};

function atLocalMidnight(value: Date): Date {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Calendar renderer — positional config on the surface's columns:
 *   col[0] = event title, col[1] = start date, col[2] = end date (optional;
 *   blank/absent end = single-day event).
 * Month grid with prev/next navigation; multi-day events render as a bar
 * across the cells they span. Rows without a parseable start date are listed
 * below the grid, like the gantt renderer's "missing dates".
 */
export function CalendarRenderer({ title, columns, rows, hasNextPage, totalCount, onLoadMore }: RendererProps) {
  const cols = sortedColumns(columns);
  const nameField = cols[0]?.field;
  const startField = cols[1]?.field;
  const endField = cols[2]?.field;

  const today = useMemo(() => atLocalMidnight(new Date()), []);
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));

  const { events, undated } = useMemo(() => {
    const parsed: Array<{ row: (typeof rows)[number]; title: string; start: Date; end: Date }> = [];
    const undated: typeof rows = [];
    for (const row of rows) {
      const s = Date.parse(String(row.values[startField ?? ""] ?? ""));
      const title = String(row.values[nameField ?? ""] ?? "");
      if (Number.isNaN(s)) {
        undated.push(row);
        continue;
      }
      const e = Date.parse(String(row.values[endField ?? ""] ?? ""));
      const start = atLocalMidnight(new Date(s));
      let end = Number.isNaN(e) ? start : atLocalMidnight(new Date(e));
      if (end < start) end = start;
      parsed.push({ row, title: title || String(row.id), start, end });
    }
    parsed.sort((a, b) => a.start.getTime() - b.start.getTime());
    return { events: parsed, undated };
  }, [rows, nameField, startField, endField]);

  // 42 cells = 6 weeks covering every possible month layout (Sunday start).
  const cells = useMemo(() => {
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const gridStart = new Date(monthStart);
    gridStart.setDate(1 - monthStart.getDay());
    const out: Array<{ day: Date; inMonth: boolean; events: CalEvent[] }> = [];
    for (let i = 0; i < 42; i++) {
      const day = new Date(gridStart);
      day.setDate(gridStart.getDate() + i);
      const dayEvents: CalEvent[] = [];
      for (const event of events) {
        if (day >= event.start && day <= event.end) {
          dayEvents.push({
            rowId: event.row.id,
            title: event.title,
            start: event.start,
            end: event.end,
            continuesBefore: day > event.start,
            continuesAfter: day < event.end,
          });
        }
      }
      out.push({ day, inMonth: day.getMonth() === cursor.getMonth(), events: dayEvents });
    }
    return out;
  }, [events, cursor]);

  const nav = (delta: number) => setCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  const monthLabel = `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;
  const visible = cells.filter((c) => c.inMonth).reduce((sum, c) => sum + c.events.length, 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <h3 className="text-sm font-semibold">{title} · calendar</h3>
        <Badge variant="outline" className="font-mono text-[10px]">
          {visible} event{visible === 1 ? "" : "s"} in {monthLabel}
        </Badge>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => nav(-1)} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[130px] text-center text-sm font-medium">{monthLabel}</span>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => nav(1)} aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="ml-1 h-7 text-xs"
            onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}
          >
            Today
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        <div className="grid h-full min-w-[640px] grid-cols-7 grid-rows-[auto_repeat(6,minmax(0,1fr))] gap-px overflow-hidden rounded-md border bg-border">
          {WEEKDAYS.map((day) => (
            <div key={day} className="bg-card px-2 py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {day}
            </div>
          ))}
          {cells.map(({ day, inMonth, events: dayEvents }) => (
            <div
              key={day.toISOString()}
              className={cn(
                "flex min-h-[74px] flex-col gap-0.5 bg-card p-1",
                !inMonth && "opacity-45",
                sameDay(day, today) && "ring-1 ring-inset ring-primary/60",
              )}
            >
              <span
                className={cn(
                  "mb-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px]",
                  sameDay(day, today) ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground",
                )}
              >
                {day.getDate()}
              </span>
              {dayEvents.slice(0, MAX_CHIPS_PER_DAY).map((event) => (
                <div
                  key={event.rowId}
                  title={`${event.title} · ${event.start.toLocaleDateString()} → ${event.end.toLocaleDateString()}`}
                  className={cn(
                    "truncate rounded px-1.5 py-0.5 text-[10px] leading-tight",
                    "bg-primary/15 text-primary",
                    event.continuesBefore && "rounded-l-none border-l-2 border-primary",
                    event.continuesAfter && "rounded-r-none",
                  )}
                >
                  {event.continuesBefore ? "↦ " : ""}
                  {event.title}
                </div>
              ))}
              {dayEvents.length > MAX_CHIPS_PER_DAY && (
                <span className="px-1 text-[10px] text-muted-foreground">+{dayEvents.length - MAX_CHIPS_PER_DAY} more</span>
              )}
            </div>
          ))}
        </div>

        {undated.length > 0 && (
          <div className="mt-3 space-y-1 rounded border border-dashed p-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Missing start date ({undated.length})
            </p>
            {undated.map((row) => (
              <p key={row.id} className="text-xs text-muted-foreground">
                {formatCell(nameField ? row.values[nameField] : null)}
              </p>
            ))}
          </div>
        )}
        {events.length === 0 && undated.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No {title} events — add a date-typed column as the second column (start) to populate the calendar.
          </p>
        )}
      </div>

      {hasNextPage && (
        <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
          <span>
            Showing {rows.length} of {totalCount ?? rows.length} event row{rows.length === 1 ? "" : "s"}
          </span>
          <Button size="sm" variant="outline" onClick={onLoadMore}>
            Load more events
          </Button>
        </div>
      )}
    </div>
  );
}
