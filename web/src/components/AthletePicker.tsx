import { athleteLabel, type Athlete } from "@ams/shared";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { Spinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDebounced } from "@/hooks/use-debounced";
import { useOrg } from "@/lib/org";
import { useAthlete, useAthletes } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** Searchable athlete combobox (server-side search, respects the global group filter when `scoped`). */
export function AthletePicker({
  value,
  onChange,
  placeholder,
  scoped = true,
  allowClear = false,
  id,
  className,
  size = "default",
  "aria-label": ariaLabel,
}: {
  value: string | null;
  onChange(athleteId: string | null, athlete: Athlete | null): void;
  placeholder?: string;
  scoped?: boolean;
  allowClear?: boolean;
  id?: string;
  className?: string;
  size?: "default" | "sm";
  "aria-label"?: string;
}) {
  const { terms, groupId } = useOrg();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const dq = useDebounced(q.trim(), 200);
  const list = useAthletes(
    { q: dq || null, status: "active", group_id: scoped ? groupId : null, limit: 30 },
    { enabled: open },
  );
  const selected = useAthlete(value);
  const items = list.data?.items ?? [];
  const label = selected.data ? athleteLabel(selected.data, { withCode: !selected.data.masked }) : null;

  const pick = (a: Athlete) => {
    onChange(a.id, a);
    setOpen(false);
    setQ("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const a = items[active];
      if (a) pick(a);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn("relative flex min-w-0", className)}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={ariaLabel}
            size={size === "sm" ? "sm" : "default"}
            className="w-full justify-between gap-2 font-normal"
          >
            <span className={cn("truncate", !label && "text-muted-foreground")}>
              {label ?? (value && selected.isPending ? "Loading…" : (placeholder ?? `Select ${terms.athlete.toLowerCase()}…`))}
            </span>
            <ChevronsUpDown aria-hidden className={cn("size-3.5 shrink-0 opacity-50", allowClear && value && "invisible")} />
          </Button>
        </PopoverTrigger>
        {allowClear && value && (
          <button
            type="button"
            aria-label="Clear"
            onClick={() => onChange(null, null)}
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="flex items-center gap-2 border-b px-2.5">
          <Search aria-hidden className="size-3.5 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={`Search ${terms.athletes.toLowerCase()}…`}
            aria-label={`Search ${terms.athletes.toLowerCase()}`}
            className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {list.isFetching && <Spinner />}
        </div>
        <div role="listbox" className="max-h-72 overflow-y-auto p-1">
          {items.map((a, i) => (
            <button
              key={a.id}
              type="button"
              role="option"
              aria-selected={a.id === value}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(a)}
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none",
                i === active && "bg-accent",
              )}
            >
              <Check aria-hidden className={cn("size-3.5 shrink-0", a.id === value ? "opacity-100" : "opacity-0")} />
              <span className="truncate">{athleteLabel(a)}</span>
              <span className="ml-auto font-mono text-xs text-muted-foreground">{a.code}</span>
            </button>
          ))}
          {!list.isPending && items.length === 0 && (
            <div className="px-2 py-6 text-center text-sm text-muted-foreground">No matches</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
