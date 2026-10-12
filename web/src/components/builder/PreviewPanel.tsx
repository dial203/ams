import { compileForm, errorMessage, findField, type FormSchema, type FormValues } from "@ams/shared";
import { RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { FormRenderer } from "@/components/forms/FormRenderer";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatFieldValue } from "@/lib/field-format";
import { cn } from "@/lib/utils";

/** Live preview of the draft with the shared renderer and engine, plus a test-values panel. */
export function PreviewPanel({ schema }: { schema: FormSchema }) {
  const [values, setValues] = useState<FormValues>({});
  const [showErrors, setShowErrors] = useState(false);
  const [round, setRound] = useState(0);
  const compiled = useMemo(() => compileForm(schema), [schema]);
  const result = useMemo(() => compiled.validate(values), [compiled, values]);
  const hidden = Object.keys(result.visible).filter((k) => !result.visible[k]);
  const errorKeys = Object.keys(result.errors);

  return (
    <Tabs defaultValue="preview" className="flex h-full min-h-0 flex-col gap-0">
      <div className="flex items-center gap-2 border-b px-3">
        <TabsList className="h-10 w-auto border-b-0">
          <TabsTrigger value="preview" className="h-10">
            Preview
          </TabsTrigger>
          <TabsTrigger value="values" className="h-10">
            Test values
            {errorKeys.length > 0 && (
              <span className="rounded-full bg-destructive/10 px-1.5 text-[10px] text-destructive tabular">{errorKeys.length}</span>
            )}
          </TabsTrigger>
        </TabsList>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          aria-label="Reset test values"
          title="Reset test values"
          onClick={() => {
            setValues({});
            setRound((r) => r + 1);
          }}
        >
          <RotateCcw />
        </Button>
      </div>
      <TabsContent value="preview" className="min-h-0 flex-1 overflow-y-auto p-4" forceMount>
        <div className="mb-3 flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground">
          <span>Interact to test visibility and calculations. Nothing is saved.</span>
          <label className="flex shrink-0 items-center gap-1.5">
            <Switch checked={showErrors} onCheckedChange={setShowErrors} aria-label="Show validation errors" />
            Errors
          </label>
        </div>
        {schema.sections.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Add a section and fields to see the preview.</p>
        ) : (
          <FormRenderer key={round} id="builder-preview" schema={schema} values={values} onChange={(v) => setValues(v)} showAllErrors={showErrors} compact />
        )}
      </TabsContent>
      <TabsContent value="values" className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="grid gap-5 text-sm">
          <section>
            <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">Calculated</h3>
            {Object.keys(result.computed).length === 0 ? (
              <p className="text-xs text-muted-foreground">No calculated fields.</p>
            ) : (
              <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                {Object.entries(result.computed).map(([k, v]) => {
                  const f = findField(schema, k)?.field;
                  return (
                    <div key={k} className="contents">
                      <dt className="truncate">
                        <code className="font-mono text-xs">{k}</code>
                      </dt>
                      <dd className={cn("text-right tabular", v === null && "text-muted-foreground")} data-testid={`computed-${k}`}>
                        {f ? formatFieldValue(f, v) : String(v)}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            )}
          </section>
          <section>
            <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">Validation</h3>
            {errorKeys.length === 0 ? (
              <p className="text-xs text-flag-green">These values would be accepted.</p>
            ) : (
              <ul className="grid gap-1">
                {errorKeys.map((k) => {
                  const f = findField(schema, k)?.field;
                  return (
                    <li key={k} className="text-xs">
                      <code className="font-mono">{k}</code> <span className="text-muted-foreground">({result.errors[k]})</span>{" "}
                      <span className="text-destructive">{errorMessage(result.errors[k]!, f)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <section>
            <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">Hidden right now</h3>
            <p className="text-xs">{hidden.length ? hidden.map((k) => <code key={k} className="mr-1.5 font-mono">{k}</code>) : <span className="text-muted-foreground">Nothing hidden.</span>}</p>
          </section>
          <section>
            <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">Submitted values</h3>
            <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-[11px]">{JSON.stringify(result.values, null, 2)}</pre>
          </section>
        </div>
      </TabsContent>
    </Tabs>
  );
}
