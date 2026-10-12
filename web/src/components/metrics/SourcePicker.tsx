import type { SeriesSource } from "@ams/shared";
import { Check, ChevronsUpDown, ClipboardList, LineChart, Search, Watch } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<SeriesSource["kind"], string> = { form: "Form fields", wearable: "Wearables", metric: "Other metrics" };
const KIND_ICON = { form: ClipboardList, wearable: Watch, metric: LineChart } as const;

/** Searchable picker over `GET /series-sources`, grouped by kind. */
export function SourcePicker({
  id,
  sources,
  value,
  onChange,
  exclude,
  invalid,
}: {
  id?: string;
  sources: readonly SeriesSource[];
  value: string;
  onChange(ref: string, source: SeriesSource | undefined): void;
  /** e.g. `metric:<self>` to avoid self references */
  exclude?: string;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const current = sources.find((s) => s.ref === value);
  const needle = q.trim().toLowerCase();
  const list = sources.filter((s) => s.ref !== exclude && (!needle || s.label.toLowerCase().includes(needle) || s.ref.toLowerCase().includes(needle)));
  const kinds: SeriesSource["kind"][] = ["form", "wearable", "metric"];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} variant="outline" role="combobox" aria-expanded={open} aria-invalid={invalid || undefined} className={cn("w-full justify-between font-normal", invalid && "border-destructive")}>
          <span className="min-w-0 truncate text-left">
            {current ? (
              <>
                {current.label} <code className="ml-1 font-mono text-[11px] text-muted-foreground">{current.ref}</code>
              </>
            ) : value ? (
              <code className="font-mono text-xs">{value}</code>
            ) : (
              <span className="text-muted-foreground">Choose a source…</span>
            )}
          </span>
          <ChevronsUpDown aria-hidden className="size-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[28rem] max-w-[calc(100vw-2rem)] p-0">
        <div className="flex items-center gap-2 border-b px-2.5">
          <Search aria-hidden className="size-3.5 text-muted-foreground" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search fields, wearable metrics, metrics…" aria-label="Search sources" className="h-9 w-full bg-transparent text-sm outline-none" />
        </div>
        <div className="max-h-80 overflow-y-auto p-1" role="listbox">
          {kinds.map((k) => {
            const items = list.filter((s) => s.kind === k);
            if (items.length === 0) return null;
            const Icon = KIND_ICON[k];
            return (
              <div key={k}>
                <div className="flex items-center gap-1.5 px-2 pt-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  <Icon aria-hidden className="size-3" /> {KIND_LABEL[k]}
                </div>
                {items.map((s) => (
                  <button
                    key={s.ref}
                    type="button"
                    role="option"
                    aria-selected={s.ref === value}
                    onClick={() => {
                      onChange(s.ref, s);
                      setOpen(false);
                      setQ("");
                    }}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <Check aria-hidden className={cn("size-3.5 shrink-0", s.ref === value ? "opacity-100" : "opacity-0")} />
                    <span className="min-w-0 flex-1 truncate">{s.label}</span>
                    {s.unit && <span className="text-xs text-muted-foreground">{s.unit}</span>}
                  </button>
                ))}
              </div>
            );
          })}
          {list.length === 0 && <div className="px-2 py-6 text-center text-sm text-muted-foreground">No matches</div>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
