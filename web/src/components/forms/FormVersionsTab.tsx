import { fieldKeys, type Form, type FormSchema, type FormVersion } from "@ams/shared";
import { History } from "lucide-react";
import { useState } from "react";
import { FormRenderer } from "@/components/forms/FormRenderer";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrg } from "@/lib/org";
import { useFormVersions } from "@/lib/queries";
import { cn } from "@/lib/utils";

export function FormVersionsTab({ form, onRestore }: { form: Form; onRestore(schema: FormSchema): void }) {
  const { isAdmin } = useOrg();
  const versions = useFormVersions(form.id);
  const [selected, setSelected] = useState<FormVersion | null>(null);
  if (versions.isPending) return <Skeleton className="h-64" />;
  if (versions.isError) return <ErrorState error={versions.error} onRetry={() => void versions.refetch()} />;
  if (versions.data.length === 0) {
    return <EmptyState icon={History} title="Not published yet" description="Each publish creates an immutable version; submissions keep the version they were made with." />;
  }
  const current = selected ?? versions.data[0]!;
  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <Card className="h-fit p-1">
        <ul aria-label="Versions">
          {versions.data.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => setSelected(v)}
                aria-current={v.id === current.id ? "true" : undefined}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40",
                  v.id === current.id && "bg-accent",
                )}
              >
                <span className="font-medium tabular">v{v.version}</span>
                {v.id === form.current_version?.id && <Badge variant="success">Live</Badge>}
                <span className="ml-auto text-xs text-muted-foreground">
                  {new Date(v.published_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">Version {current.version}</div>
            <div className="text-xs text-muted-foreground">
              Published {new Date(current.published_at).toLocaleString()} · {fieldKeys(current.schema).length} fields
            </div>
          </div>
          {isAdmin && (
            <Button size="sm" variant="outline" onClick={() => onRestore(current.schema)}>
              Copy into draft
            </Button>
          )}
        </div>
        <FormRenderer key={current.id} schema={current.schema} compact />
      </Card>
    </div>
  );
}
