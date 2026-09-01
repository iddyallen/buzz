import * as React from "react";

import { MAX_COLUMN_LABEL_LEN } from "@/features/kanban/lib/position";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";

type ColumnNameDialogProps = {
  open: boolean;
  title: string;
  initialValue: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (label: string) => void;
};

/** Prompt for a column label — reused by the add-column and rename flows. */
export function ColumnNameDialog({
  open,
  title,
  initialValue,
  onOpenChange,
  onSubmit,
}: ColumnNameDialogProps) {
  const [value, setValue] = React.useState(initialValue);

  React.useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  const trimmed = value.trim();
  const canSave = trimmed.length > 0 && trimmed.length <= MAX_COLUMN_LABEL_LEN;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="kanban-column-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <label
          className="flex flex-col gap-1 text-sm"
          htmlFor="kanban-column-name"
        >
          <span className="text-muted-foreground">Column name</span>
          <Input
            autoFocus
            data-testid="kanban-column-name"
            id="kanban-column-name"
            maxLength={MAX_COLUMN_LABEL_LEN}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSave) onSubmit(trimmed);
            }}
            placeholder="e.g. In review"
            value={value}
          />
        </label>
        <DialogFooter>
          <Button
            onClick={() => onOpenChange(false)}
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            data-testid="kanban-column-save"
            disabled={!canSave}
            onClick={() => onSubmit(trimmed)}
            type="button"
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
