import type { FieldOption } from "@ams/shared";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

function slug(label: string): string {
  return (
    label
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "option"
  );
}

/**
 * Editor for select / multiselect options. Values are all strings or all numbers (FORMS.md);
 * the value type switch converts existing values.
 */
export function OptionsEditor({
  id,
  options,
  onChange,
  error,
}: {
  id: string;
  options: FieldOption[];
  onChange(options: FieldOption[]): void;
  error?: string | undefined;
}) {
  const numeric = options.length > 0 && options.every((o) => typeof o.value === "number");
  const counts = new Map<string, number>();
  for (const o of options) counts.set(String(o.value), (counts.get(String(o.value)) ?? 0) + 1);

  const set = (i: number, patch: Partial<FieldOption>) => onChange(options.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= options.length) return;
    const next = options.slice();
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  const add = () => {
    const label = `Option ${options.length + 1}`;
    if (numeric) {
      const max = options.reduce((m, o) => Math.max(m, typeof o.value === "number" ? o.value : 0), -1);
      onChange([...options, { value: max + 1, label }]);
    } else {
      let v = slug(label);
      let n = 2;
      while (options.some((o) => o.value === v)) v = `${slug(label)}_${n++}`;
      onChange([...options, { value: v, label }]);
    }
  };
  const setType = (t: "text" | "number") => {
    if (t === "number") onChange(options.map((o, i) => ({ ...o, value: Number.isFinite(Number(o.value)) && String(o.value).trim() !== "" ? Number(o.value) : i })));
    else onChange(options.map((o) => ({ ...o, value: String(o.value) })));
  };

  return (
    <div className="grid gap-2" id={id}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Stored value</span>
        <NativeSelect size="sm" wrapperClassName="w-28" aria-label="Option value type" value={numeric ? "number" : "text"} onChange={(e) => setType(e.target.value as "text" | "number")}>
          <option value="text">Text</option>
          <option value="number">Number</option>
        </NativeSelect>
        <span className="hidden sm:inline">Numbers can be used in calculations.</span>
      </div>
      <div className="grid gap-1">
        <div className="grid grid-cols-[6rem_1fr_auto] gap-1.5 px-0.5 text-[11px] font-medium text-muted-foreground">
          <span>Value</span>
          <span>Label</span>
          <span className="w-[5.25rem]" />
        </div>
        {options.map((o, i) => {
          const dup = (counts.get(String(o.value)) ?? 0) > 1;
          return (
            <div key={i} className="grid grid-cols-[6rem_1fr_auto] items-center gap-1.5">
              <Input
                aria-label={`Option ${i + 1} value`}
                value={String(o.value)}
                inputMode={numeric ? "decimal" : undefined}
                onChange={(e) => {
                  const raw = e.target.value;
                  set(i, { value: numeric && raw.trim() !== "" && Number.isFinite(Number(raw)) ? Number(raw) : raw });
                }}
                aria-invalid={dup || undefined}
                className={cn("h-7 font-mono text-xs", dup && "border-destructive")}
              />
              <Input aria-label={`Option ${i + 1} label`} value={o.label} onChange={(e) => set(i, { label: e.target.value })} className="h-7 text-xs" />
              <div className="flex">
                <Button variant="ghost" size="icon-sm" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}>
                  <ArrowUp />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === options.length - 1}>
                  <ArrowDown />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Remove option ${i + 1}`} onClick={() => onChange(options.filter((_, j) => j !== i))}>
                  <X />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      <Button variant="outline" size="sm" className="w-fit" onClick={add}>
        <Plus /> Add option
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
