import { FUNCTION_ARITY, FUNCTION_NAMES, type Field } from "@ams/shared";
import { checkExpression } from "@/components/builder/builder-logic";
import { Braces, CircleAlert, CircleCheck } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const FUNCTION_HINTS: Record<string, string> = {
  sum: "sum(a, b, …) — skips empty values",
  avg: "avg(a, b, …)",
  mean: "mean(a, b, …)",
  min: "min(a, b, …)",
  max: "max(a, b, …)",
  count: "count(a, b, …) — number of answered values",
  round: "round(x, decimals)",
  floor: "floor(x)",
  ceil: "ceil(x)",
  abs: "abs(x)",
  sqrt: "sqrt(x)",
  ln: "ln(x)",
  log10: "log10(x)",
  exp: "exp(x)",
  pow: "pow(x, y)",
  clamp: "clamp(x, lo, hi)",
  if: "if(condition, then, else)",
  coalesce: "coalesce(a, b, …) — first answered value",
  isnull: "isnull(x)",
  contains: "contains(list, value)",
  len: "len(text or list)",
};

/**
 * Monospace expression editor with live parse errors and a picker that inserts field keys
 * and functions at the cursor.
 */
export function ExpressionInput({
  id,
  value,
  onChange,
  fields,
  selfKey,
  placeholder,
  rows = 2,
  serverError,
  optional = false,
}: {
  id: string;
  value: string;
  onChange(value: string): void;
  fields: readonly Field[];
  selfKey?: string;
  placeholder?: string;
  rows?: number;
  serverError?: string | undefined;
  optional?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const check = value.trim() === "" && optional ? { ok: true, message: null } : checkExpression(value, fields, selfKey);
  const pickable = fields.filter((f) => f.key !== selfKey && f.type !== "info");

  const insert = (text: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const needsSpace = start > 0 && /[\w)]/.test(value[start - 1] ?? "") && /^\w/.test(text);
    const piece = (needsSpace ? " " : "") + text;
    const next = value.slice(0, start) + piece + value.slice(end);
    onChange(next);
    setOpen(false);
    requestAnimationFrame(() => {
      el?.focus();
      const caret = start + piece.length - (text.endsWith("()") ? 1 : 0);
      el?.setSelectionRange(caret, caret);
    });
  };

  const message = check.message ?? serverError ?? null;
  return (
    <div className="grid gap-1">
      <div className="relative">
        <Textarea
          ref={ref}
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          spellCheck={false}
          autoComplete="off"
          placeholder={placeholder}
          aria-invalid={message ? true : undefined}
          aria-describedby={`${id}-status`}
          className="min-h-9 pr-10 font-mono text-[13px]"
        />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="absolute top-1 right-1" aria-label="Insert field or function">
              <Braces />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0">
            <div className="max-h-80 overflow-y-auto p-1">
              <div className="px-2 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Fields</div>
              {pickable.length === 0 && <div className="px-2 py-1 text-xs text-muted-foreground">No other fields yet</div>}
              {pickable.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => insert(f.key)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-sm hover:bg-accent"
                >
                  <code className="font-mono text-xs">{f.key}</code>
                  <span className="truncate text-xs text-muted-foreground">{f.label}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">{f.type}</span>
                </button>
              ))}
              <div className="px-2 pt-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Functions</div>
              {FUNCTION_NAMES.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => insert(`${name}()`)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-sm hover:bg-accent"
                  title={FUNCTION_HINTS[name]}
                >
                  <code className="font-mono text-xs">{name}</code>
                  <span className="truncate text-xs text-muted-foreground">
                    {FUNCTION_HINTS[name] ?? `${FUNCTION_ARITY[name]!.min}+ args`}
                  </span>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <div id={`${id}-status`} className={cn("flex items-start gap-1.5 text-xs", message ? "text-destructive" : "text-muted-foreground")} aria-live="polite">
        {message ? (
          <>
            <CircleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
            <span>
              {message}
              {check.position !== undefined && value.trim() !== "" && (
                <>
                  {" "}
                  at <ErrorPointer src={value} position={check.position} end={check.end ?? check.position + 1} />
                </>
              )}
            </span>
          </>
        ) : value.trim() !== "" ? (
          <>
            <CircleCheck aria-hidden className="mt-px size-3.5 shrink-0 text-flag-green" />
            <span>Valid expression</span>
          </>
        ) : null}
      </div>
    </div>
  );
}

function ErrorPointer({ src, position, end }: { src: string; position: number; end: number }) {
  const before = src.slice(Math.max(0, position - 12), position);
  const bad = src.slice(position, Math.max(end, position + 1)) || "⏎";
  const after = src.slice(Math.max(end, position + 1), Math.max(end, position + 1) + 8);
  return (
    <code className="rounded bg-muted px-1 font-mono text-foreground">
      {position > 12 && "…"}
      {before}
      <mark className="rounded-sm bg-destructive/20 text-destructive underline decoration-wavy">{bad}</mark>
      {after}
    </code>
  );
}
