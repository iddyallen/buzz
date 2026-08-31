import { FolderOpen } from "lucide-react";

import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

type FilesHeaderButtonProps = {
  active: boolean;
  onClick: () => void;
};

/** Channel-header toggle that opens the Files auxiliary panel. */
export function FilesHeaderButton({ active, onClick }: FilesHeaderButtonProps) {
  const label = active ? "Hide files" : "Files";
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
          data-testid="channel-files-toggle"
          onClick={onClick}
          size="icon"
          title={label}
          type="button"
          variant="ghost"
        >
          <FolderOpen className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
