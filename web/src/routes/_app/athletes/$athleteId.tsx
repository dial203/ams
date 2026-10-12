import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, SquarePen } from "lucide-react";
import { z } from "zod";
import { AthleteName, StatusBadge } from "@/components/athletes/AthleteBits";
import { DataTab } from "@/components/athletes/DataTab";
import { OverviewTab } from "@/components/athletes/OverviewTab";
import { ProfileTab } from "@/components/athletes/ProfileTab";
import { WearablesTab } from "@/components/athletes/WearablesTab";
import { GroupKindIcon } from "@/components/GroupKindIcon";
import { ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isStatus } from "@/lib/errors";
import { useOrg } from "@/lib/org";
import { useAthlete, useGroups } from "@/lib/queries";
import { useDocumentTitle } from "@/hooks/use-document-title";

const TABS = ["overview", "data", "wearables", "profile"] as const;
type Tab = (typeof TABS)[number];

export const Route = createFileRoute("/_app/athletes/$athleteId")({
  validateSearch: z.object({ tab: z.enum(TABS).optional() }),
  component: AthleteDetailPage,
});

function AthleteDetailPage() {
  const { athleteId } = Route.useParams();
  const { tab = "overview" } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { terms } = useOrg();
  const athlete = useAthlete(athleteId);
  const groups = useGroups();
  useDocumentTitle(athlete.data?.display_name ?? terms.athlete);

  if (athlete.isPending) {
    return (
      <div className="grid gap-3 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="mt-6 h-64" />
      </div>
    );
  }
  if (athlete.isError) {
    return (
      <ErrorState
        error={athlete.error}
        title={isStatus(athlete.error, 404) ? `${terms.athlete} not found` : `Could not load ${terms.athlete.toLowerCase()}`}
        onRetry={() => void athlete.refetch()}
      />
    );
  }
  const a = athlete.data;
  const memberOf = (groups.data ?? []).filter((g) => a.group_ids.includes(g.id));

  return (
    <Tabs
      value={tab}
      onValueChange={(t) => void navigate({ search: { tab: t === "overview" ? undefined : (t as Tab) }, replace: true })}
      className="flex flex-col gap-0"
    >
      <div className="border-b px-4 pt-3 md:px-6">
        <Link to="/athletes" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronLeft aria-hidden className="size-3.5" /> {terms.athletes}
        </Link>
        <div className="mt-1.5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight">
              <AthleteName athlete={a} />
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <StatusBadge status={a.status} />
              {a.position && <Badge variant="outline">{a.position}</Badge>}
              {memberOf.map((g) => (
                <Badge key={g.id} variant="secondary" className="gap-1">
                  <GroupKindIcon kind={g.kind} className="size-3" />
                  {g.name}
                </Badge>
              ))}
              {memberOf.length === 0 && <span>No {terms.groups.toLowerCase()}</span>}
            </div>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link to="/entry" search={{ athlete: a.id }}>
              <SquarePen /> Enter data
            </Link>
          </Button>
        </div>
        <TabsList className="mt-2 border-b-0">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="data">Data</TabsTrigger>
          <TabsTrigger value="wearables">Wearables</TabsTrigger>
          <TabsTrigger value="profile">Profile</TabsTrigger>
        </TabsList>
      </div>
      <div className="px-4 py-4 md:px-6">
          <TabsContent value="overview">
            <OverviewTab athlete={a} />
          </TabsContent>
          <TabsContent value="data">
            <DataTab athlete={a} />
          </TabsContent>
          <TabsContent value="wearables">
            <WearablesTab athlete={a} />
          </TabsContent>
          <TabsContent value="profile">
            <ProfileTab key={a.id + a.status} athlete={a} />
          </TabsContent>
      </div>
    </Tabs>
  );
}
