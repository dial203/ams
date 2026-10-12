import { SUBMISSION_SOURCES, addDays, isISODate, type SubmissionSource } from "@ams/shared";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Database, FileUp, History } from "lucide-react";
import { z } from "zod";
import { ImportHistory } from "@/components/data/ImportHistory";
import { ImportWizard } from "@/components/data/ImportWizard";
import { SubmissionsExplorer } from "@/components/data/SubmissionsExplorer";
import { PageBody, PageHeader } from "@/components/page";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOrg } from "@/lib/org";

const TABS = ["submissions", "import", "history"] as const;

export const Route = createFileRoute("/_app/data")({
  validateSearch: z.object({
    tab: z.enum(TABS).optional(),
    form: z.string().optional(),
    athlete: z.string().optional(),
    start: z.string().optional(),
    end: z.string().optional(),
    source: z.enum(SUBMISSION_SOURCES as unknown as [SubmissionSource, ...SubmissionSource[]]).optional(),
  }),
  component: DataPage,
});

function DataPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { today } = useOrg();
  const tab = search.tab ?? "submissions";
  const start = search.start !== undefined ? search.start : addDays(today, -29);
  const end = search.end !== undefined ? search.end : today;

  return (
    <Tabs
      value={tab}
      onValueChange={(t) => void navigate({ search: (p) => ({ ...p, tab: t === "submissions" ? undefined : (t as (typeof TABS)[number]) }), replace: true })}
      className="gap-0"
    >
      <PageHeader title="Data" description="Explore and export submissions, or import a spreadsheet from another system.">
        <TabsList className="-mb-3 border-b-0">
          <TabsTrigger value="submissions">
            <Database /> Submissions
          </TabsTrigger>
          <TabsTrigger value="import">
            <FileUp /> Import
          </TabsTrigger>
          <TabsTrigger value="history">
            <History /> Import history
          </TabsTrigger>
        </TabsList>
      </PageHeader>
      <PageBody>
        <TabsContent value="submissions">
          <SubmissionsExplorer
            filters={{
              formId: search.form ?? null,
              athleteId: search.athlete ?? null,
              start: start && isISODate(start) ? start : "",
              end: end && isISODate(end) ? end : "",
              source: search.source ?? null,
            }}
            onFiltersChange={(f) =>
              void navigate({
                search: (p) => ({
                  ...p,
                  form: f.formId ?? undefined,
                  athlete: f.athleteId ?? undefined,
                  start: f.start === addDays(today, -29) ? undefined : f.start,
                  end: f.end === today ? undefined : f.end,
                  source: f.source ?? undefined,
                }),
                replace: true,
              })
            }
          />
        </TabsContent>
        <TabsContent value="import">
          <ImportWizard onViewHistory={() => void navigate({ search: (p) => ({ ...p, tab: "history" }) })} />
        </TabsContent>
        <TabsContent value="history">
          <ImportHistory formId={search.form ?? null} />
        </TabsContent>
      </PageBody>
    </Tabs>
  );
}
