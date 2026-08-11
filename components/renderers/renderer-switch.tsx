"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { BoardRenderer } from "./board-renderer";
import { CardsRenderer } from "./cards-renderer";
import { DataTableRenderer } from "./table-renderer";
import { FormRenderer } from "./form-renderer";
import { GanttRenderer } from "./gantt-renderer";
import { PivotRenderer } from "./pivot-renderer";
import { TimelineRenderer } from "./timeline-renderer";
import type { RendererProps } from "./types";

/** Registry: `Surface.renderer` is graph data; unknown values fall back to table. */
export function RendererSwitch({ renderer, ...props }: RendererProps & { renderer: string }) {
  switch (renderer) {
    case "cards":
      return <CardsRenderer {...props} />;
    case "form":
      return <FormRenderer {...props} />;
    case "board":
      return <BoardRenderer {...props} />;
    case "timeline":
      return <TimelineRenderer {...props} />;
    case "pivot":
      return <PivotRenderer {...props} />;
    case "gantt":
      return <GanttRenderer {...props} />;
    case "table":
      return <DataTableRenderer {...props} />;
    default:
      return (
        <div className="flex h-full flex-col">
          <Alert variant="info" className="m-2">
            <AlertDescription>
              Unknown renderer <code>{renderer}</code> — falling back to table.
            </AlertDescription>
          </Alert>
          <div className="min-h-0 flex-1">
            <DataTableRenderer {...props} />
          </div>
        </div>
      );
  }
}
