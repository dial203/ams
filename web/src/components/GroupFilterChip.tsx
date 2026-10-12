import { X } from "lucide-react";
import { GroupKindIcon } from "@/components/GroupKindIcon";
import { useOrg } from "@/lib/org";
import { useGroups } from "@/lib/queries";

/** Shows the global group filter on pages that apply it, with a quick way to clear it. */
export function GroupFilterChip() {
  const { groupId, setGroupId, terms } = useOrg();
  const groups = useGroups();
  const g = groups.data?.find((x) => x.id === groupId);
  if (!groupId || !g) return null;
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-md border bg-muted/50 pr-1 pl-2 text-xs">
      <GroupKindIcon kind={g.kind} className="size-3.5" />
      <span className="text-muted-foreground">{terms.group}:</span>
      <span className="font-medium">{g.name}</span>
      <button
        type="button"
        onClick={() => setGroupId(null)}
        aria-label={`Clear ${terms.group.toLowerCase()} filter`}
        className="ml-0.5 rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}
