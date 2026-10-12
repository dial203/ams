import type { GroupKind } from "@ams/shared";
import { Boxes, FlaskConical, Folder, LayoutGrid, Shield, Users, UsersRound, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS: Record<GroupKind, LucideIcon> = {
  team: Users,
  squad: UsersRound,
  unit: Shield,
  section: LayoutGrid,
  study: FlaskConical,
  cohort: Boxes,
  other: Folder,
};

export function GroupKindIcon({ kind, className }: { kind: GroupKind; className?: string }) {
  const Icon = ICONS[kind] ?? Folder;
  return <Icon aria-hidden className={cn("size-4 text-muted-foreground", className)} />;
}
