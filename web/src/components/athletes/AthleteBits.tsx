import type { Athlete, AthleteStatus } from "@ams/shared";
import { athleteLabel } from "@ams/shared";
import { EyeOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { STATUS_LABELS } from "@/lib/labels";

export function StatusBadge({ status }: { status: AthleteStatus }) {
  const variant = status === "active" ? "success" : status === "inactive" ? "warning" : "muted";
  return <Badge variant={variant}>{STATUS_LABELS[status]}</Badge>;
}

export function DeidentifiedBadge() {
  return (
    <Badge variant="outline" className="gap-1 text-muted-foreground" title="Identifiable details are hidden for your access level">
      <EyeOff aria-hidden />
      De-identified
    </Badge>
  );
}

/** Name (or code when masked) with the code in muted text. */
export function AthleteName({ athlete, showCode = true }: { athlete: Athlete; showCode?: boolean }) {
  if (athlete.masked) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="font-mono text-[13px] font-medium">{athlete.code}</span>
        <DeidentifiedBadge />
      </span>
    );
  }
  return (
    <span className="inline-flex items-baseline gap-2">
      <span className="font-medium">{athleteLabel(athlete)}</span>
      {showCode && <span className="font-mono text-xs text-muted-foreground">{athlete.code}</span>}
    </span>
  );
}
