import { flagColor, type Flag } from "@ams/shared";
import { CircleCheck, OctagonAlert, TriangleAlert } from "lucide-react";
import { FLAG_TEXT } from "@/lib/flags";
import { cn } from "@/lib/utils";

/**
 * Flag shown with colour and shape (octagon = red, triangle = amber, circle = green) plus
 * screen-reader text, so it never relies on colour alone.
 */
export function FlagIcon({ flag, className }: { flag: Flag | undefined; className?: string }) {
  const c = flagColor(flag);
  if (c === "none") return null;
  const Icon = c === "red" ? OctagonAlert : c === "amber" ? TriangleAlert : CircleCheck;
  return (
    <span className={cn("inline-flex shrink-0", className)} data-flag={c}>
      <Icon
        aria-hidden
        className={cn(
          "size-3.5",
          c === "red" && "text-flag-red",
          c === "amber" && "text-flag-amber",
          c === "green" && "text-flag-green opacity-70",
        )}
        strokeWidth={2.25}
      />
      <span className="sr-only">{FLAG_TEXT[c]} flag</span>
    </span>
  );
}
