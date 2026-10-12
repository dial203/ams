import { ChevronDownIcon } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

/** Styled native `<select>`: fast keyboard type-ahead, accessible, works everywhere. */
function NativeSelect({
  className,
  wrapperClassName,
  size = "default",
  ...props
}: Omit<React.ComponentProps<"select">, "size"> & { wrapperClassName?: string; size?: "default" | "sm" }) {
  return (
    <div className={cn("relative w-full min-w-0", wrapperClassName)}>
      <select
        data-slot="native-select"
        className={cn(
          "w-full min-w-0 appearance-none truncate rounded-md border border-input bg-background pr-7 pl-2.5 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive dark:bg-input/20 [&>option]:bg-popover [&>option]:text-popover-foreground",
          size === "sm" ? "h-7 text-xs" : "h-8",
          className,
        )}
        {...props}
      />
      <ChevronDownIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}

export { NativeSelect };
