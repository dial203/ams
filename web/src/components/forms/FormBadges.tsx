import type { FormKind, Sensitivity } from "@ams/shared";
import { FlaskConical, HeartPulse } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { FORM_KIND_LABELS, SENSITIVITY_LABELS } from "@/lib/labels";

export function SensitivityBadge({ sensitivity }: { sensitivity: Sensitivity }) {
  if (sensitivity === "general") return <Badge variant="muted">{SENSITIVITY_LABELS.general}</Badge>;
  if (sensitivity === "medical")
    return (
      <Badge variant="destructive">
        <HeartPulse aria-hidden /> {SENSITIVITY_LABELS.medical}
      </Badge>
    );
  return (
    <Badge className="border-transparent bg-violet-500/10 text-violet-700 dark:text-violet-300">
      <FlaskConical aria-hidden /> {SENSITIVITY_LABELS.research}
    </Badge>
  );
}

export function KindBadge({ kind }: { kind: FormKind }) {
  return <Badge variant="outline">{FORM_KIND_LABELS[kind]}</Badge>;
}
