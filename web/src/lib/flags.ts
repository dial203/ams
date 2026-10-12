import { flagColor, type Flag } from "@ams/shared";

export const FLAG_TEXT: Record<"green" | "amber" | "red", string> = {
  green: "Green",
  amber: "Amber",
  red: "Red",
};

/** Cell tint for a flag (green stays untinted to keep attention on amber/red). */
export function flagCellClass(flag: Flag | undefined): string {
  switch (flagColor(flag)) {
    case "red":
      return "bg-flag-red-bg";
    case "amber":
      return "bg-flag-amber-bg";
    default:
      return "";
  }
}
