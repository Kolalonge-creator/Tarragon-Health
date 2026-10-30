"use client";

import * as React from "react";
import { Button, type ButtonProps } from "./button";
import { Sheet } from "./sheet";

/**
 * A button that opens its content in a Sheet. The children are a function that receives `close`, so a form can close the sheet
 * once it has saved. This is the "Log" and "Set a goal" pattern of the tracker pages: the page opens on the current value and the
 * trend, and the input form only appears when asked for (design audit P4).
 */
export function SheetButton({
  label,
  title,
  variant = "outline",
  size,
  icon,
  children,
}: {
  label: string;
  title?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  icon?: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const close = React.useCallback(() => setOpen(false), []);
  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={() => setOpen(true)} aria-haspopup="dialog">
        {icon}
        {label}
      </Button>
      <Sheet open={open} onClose={close} title={title ?? label}>
        {children(close)}
      </Sheet>
    </>
  );
}
