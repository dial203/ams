import type { Group } from "@ams/shared";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { GroupKindIcon } from "@/components/GroupKindIcon";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { flattenGroupTree, buildGroupTree } from "@/lib/groups";
import { cn } from "@/lib/utils";

/**
 * Popover tree picker for a group. `allLabel` adds an "all" entry (value null).
 */
export function GroupPicker({
  groups,
  value,
  onChange,
  allLabel,
  placeholder = "Select…",
  className,
  id,
  disabled,
  size = "default",
  "aria-label": ariaLabel,
}: {
  groups: readonly Group[];
  value: string | null;
  onChange(groupId: string | null): void;
  allLabel?: string;
  placeholder?: string;
  className?: string;
  id?: string;
  disabled?: boolean;
  size?: "default" | "sm";
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const nodes = useMemo(() => flattenGroupTree(buildGroupTree(groups)), [groups]);
  const selected = groups.find((g) => g.id === value) ?? null;
  const filtered = q.trim()
    ? nodes.filter((n) => n.group.name.toLowerCase().includes(q.trim().toLowerCase()))
    : nodes;

  const pick = (id: string | null) => {
    onChange(id);
    setOpen(false);
    setQ("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          size={size === "sm" ? "sm" : "default"}
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn("justify-between gap-2 font-normal", className)}
        >
          <span className="flex min-w-0 items-center gap-2 truncate">
            {selected && <GroupKindIcon kind={selected.kind} className="size-3.5" />}
            <span className={cn("truncate", !selected && !allLabel && "text-muted-foreground")}>
              {selected ? selected.name : (allLabel ?? placeholder)}
            </span>
          </span>
          <ChevronsUpDown aria-hidden className="size-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <div className="flex items-center gap-2 border-b px-2.5">
          <Search aria-hidden className="size-3.5 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            aria-label="Search groups"
            className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div role="listbox" className="max-h-72 overflow-y-auto p-1">
          {allLabel && !q && (
            <GroupOption selected={value === null} onSelect={() => pick(null)} depth={0}>
              <span className="text-muted-foreground">{allLabel}</span>
            </GroupOption>
          )}
          {filtered.map((n) => (
            <GroupOption
              key={n.group.id}
              selected={value === n.group.id}
              onSelect={() => pick(n.group.id)}
              depth={q ? 0 : n.depth}
            >
              <GroupKindIcon kind={n.group.kind} className="size-3.5" />
              <span className={cn("truncate", n.group.archived && "text-muted-foreground line-through")}>
                {n.group.name}
              </span>
              <span className="ml-auto text-xs text-muted-foreground tabular">{n.group.athlete_count}</span>
            </GroupOption>
          ))}
          {filtered.length === 0 && <div className="px-2 py-6 text-center text-sm text-muted-foreground">No matches</div>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function GroupOption({
  selected,
  onSelect,
  depth,
  children,
}: {
  selected: boolean;
  onSelect(): void;
  depth: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      <Check aria-hidden className={cn("size-3.5 shrink-0", selected ? "opacity-100" : "opacity-0")} />
      {children}
    </button>
  );
}
