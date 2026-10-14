import type { WearableProvider } from "@ams/shared";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { DEFAULT_PROVIDER_ORDER, providerLabel } from "@/lib/wearables";

/**
 * An ordered list of wearable providers, best first, with move, remove and add. `choices` are the
 * providers that can be added (default: Open Wearables' providers, else the default order).
 */
export function ProviderRanking({
  value,
  onChange,
  providers,
  choices,
  badges,
  label = "Provider ranking",
}: {
  value: string[];
  onChange(next: string[]): void;
  providers?: readonly WearableProvider[];
  choices?: readonly string[];
  /** Small notes per provider, e.g. "has data". */
  badges?: (key: string) => string | null;
  label?: string;
}) {
  const [adding, setAdding] = useState("");
  const pool = choices ?? (providers?.length ? providers.map((p) => p.provider) : DEFAULT_PROVIDER_ORDER);
  const available = pool.filter((p) => !value.includes(p));
  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= value.length) return;
    const next = value.slice();
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  return (
    <div className="grid gap-3">
      {value.length > 0 && (
        <ol className="grid gap-1" aria-label={label}>
          {value.map((key, i) => {
            const name = providerLabel(key, providers);
            const note = badges?.(key);
            return (
              <li key={key} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5">
                <span className="w-5 text-xs text-muted-foreground tabular">{i + 1}</span>
                <span className="flex-1 truncate text-sm">
                  {name}
                  {note && <span className="ml-2 text-xs text-muted-foreground">{note}</span>}
                </span>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${name} up`} onClick={() => move(i, -1)} disabled={i === 0}>
                  <ArrowUp />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move ${name} down`}
                  onClick={() => move(i, 1)}
                  disabled={i === value.length - 1}
                >
                  <ArrowDown />
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${name}`} onClick={() => onChange(value.filter((k) => k !== key))}>
                  <X />
                </Button>
              </li>
            );
          })}
        </ol>
      )}
      {available.length > 0 && (
        <div className="flex max-w-md gap-2">
          <NativeSelect aria-label="Provider to add" value={adding} onChange={(e) => setAdding(e.target.value)}>
            <option value="">Add a provider…</option>
            {available.map((p) => (
              <option key={p} value={p}>
                {providerLabel(p, providers)}
              </option>
            ))}
          </NativeSelect>
          <Button
            type="button"
            variant="outline"
            disabled={!adding}
            onClick={() => {
              onChange([...value, adding]);
              setAdding("");
            }}
          >
            <Plus /> Add
          </Button>
        </div>
      )}
    </div>
  );
}
