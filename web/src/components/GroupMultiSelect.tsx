import type { Group } from "@ams/shared";
import { ChevronsUpDown } from "lucide-react";
import { useMemo, useState } from "react";
import { GroupKindIcon } from "@/components/GroupKindIcon";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { buildGroupTree, flattenGroupTree } from "@/lib/groups";
import { cn } from "@/lib/utils";

export function GroupMultiSelect({
  groups,
  value,
  onChange,
  placeholder = "None",
  id,
  className,
}: {
  groups: readonly Group[];
  value: readonly string[];
  onChange(ids: string[]): void;
  placeholder?: string;
  id?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const nodes = useMemo(() => flattenGroupTree(buildGroupTree(groups.filter((g) => !g.archived))), [groups]);
  const names = value.map((id) => groups.find((g) => g.id === id)?.name).filter(Boolean) as string[];
  const toggle = (gid: string) => onChange(value.includes(gid) ? value.filter((v) => v !== gid) : [...value, gid]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} variant="outline" role="combobox" aria-expanded={open} className={cn("justify-between font-normal", className)}>
          <span className={cn("truncate", names.length === 0 && "text-muted-foreground")}>
            {names.length === 0 ? placeholder : names.join(", ")}
          </span>
          <ChevronsUpDown aria-hidden className="size-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-1" align="start">
        <div className="max-h-72 overflow-y-auto">
          {nodes.length === 0 && <div className="px-2 py-4 text-center text-sm text-muted-foreground">No groups yet</div>}
          {nodes.map((n) => {
            const checked = value.includes(n.group.id);
            return (
              <label
                key={n.group.id}
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                style={{ paddingLeft: 8 + n.depth * 14 }}
              >
                <Checkbox checked={checked} onCheckedChange={() => toggle(n.group.id)} />
                <GroupKindIcon kind={n.group.kind} className="size-3.5" />
                <span className="truncate">{n.group.name}</span>
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
