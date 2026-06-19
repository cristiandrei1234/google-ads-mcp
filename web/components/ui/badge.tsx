import * as React from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: "default" | "muted" | "destructive" }) {
  const styles = {
    default: "bg-[var(--primary)] text-[var(--primary-foreground)]",
    muted: "bg-[var(--secondary)] text-[var(--secondary-foreground)]",
    destructive: "bg-[var(--destructive)] text-[var(--destructive-foreground)]",
  }[variant];
  return (
    <span
      className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium", styles, className)}
      {...props}
    />
  );
}
