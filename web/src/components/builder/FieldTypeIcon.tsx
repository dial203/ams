import type { FieldType } from "@ams/shared";
import {
  Calculator,
  Calendar,
  CalendarClock,
  CircleDot,
  Clock,
  Hash,
  Info,
  ListChecks,
  SlidersHorizontal,
  Text,
  Timer,
  ToggleLeft,
  Type,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS: Record<FieldType, LucideIcon> = {
  number: Hash,
  scale: SlidersHorizontal,
  select: CircleDot,
  multiselect: ListChecks,
  boolean: ToggleLeft,
  text: Type,
  textarea: Text,
  date: Calendar,
  time: Clock,
  datetime: CalendarClock,
  duration: Timer,
  calculated: Calculator,
  info: Info,
};

export function FieldTypeIcon({ type, className }: { type: FieldType; className?: string }) {
  const Icon = ICONS[type] ?? Type;
  return <Icon aria-hidden className={cn("size-3.5 shrink-0 text-muted-foreground", className)} />;
}
