import { SquareKanban } from "lucide-react";

import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

type KanbanHeaderButtonProps = {
  active: boolean;
  onClick: () => void;
};

/** Channel-header toggle that opens the Kanban board dialog. */
export function KanbanHeaderButton({
  active,
  onClick,
}: KanbanHeaderButtonProps) {
  const label = active ? "Hide board" : "Board";
  return (
    <Tooltip disableHoverableContent>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          aria-pressed={active}
          className={cn(
            "h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground",
            active && "bg-accent text-foreground",
          )}
          data-testid="channel-kanban-toggle"
          onClick={onClick}
          size="icon"
          title={label}
          type="button"
          variant="ghost"
        >
          <SquareKanban className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
