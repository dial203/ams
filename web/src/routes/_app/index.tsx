import { addDays, isISODate, queryKeys } from "@ams/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Gauge, Settings2 } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { PageBody, PageHeader } from "@/components/page";
import { ReadinessTable, SummaryStrip } from "@/components/readiness/ReadinessTable";
import type { RowFilter, SortDir, SortKey } from "@/components/readiness/readiness-logic";
import { EmptyState, ErrorState, Spinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/lib/api-context";
import { formatDate } from "@/lib/field-format";
import { useOrg } from "@/lib/org";
import { useGroups } from "@/lib/queries";

export const Route = createFileRoute("/_app/")({
  validateSearch: z.object({ date: z.string().optional() }),
  component: ReadinessPage,
});

function ReadinessPage() {
  const api = useApi();
  const { orgId, groupId, today, terms, isAdmin } = useOrg();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const date = search.date && isISODate(search.date) ? search.date : today;
  const groups = useGroups();
  const groupName = groups.data?.find((g) => g.id === groupId)?.name;

  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: { kind: "priority" }, dir: "desc" });
  const [filter, setFilter] = useState<RowFilter>(null);

  const params = { group_id: groupId, date };
  const board = useQuery({
    queryKey: queryKeys.dashboards.readiness(orgId, params),
    queryFn: ({ signal }) => api.dashboards.readiness(orgId, params, { signal }),
    placeholderData: keepPreviousData,
    refetchInterval: 5 * 60_000,
  });

  const setDate = (d: string) => void navigate({ search: { date: d === today ? undefined : d }, replace: true });

  return (
    <>
      <PageHeader
        title="Readiness"
        description={`${groupName ?? `All ${terms.groups.toLowerCase()}`} · ${formatDate(date)}${date === today ? " (today)" : ""}`}
        actions={
          <div className="flex items-center gap-1">
            {board.isFetching && !board.isPending && <Spinner className="mr-1" />}
            <Button variant="outline" size="icon-sm" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}>
              <ChevronLeft />
            </Button>
            <Input
              type="date"
              aria-label="Board date"
              value={date}
              max={today}
              onChange={(e) => e.target.value && isISODate(e.target.value) && setDate(e.target.value)}
              className="h-7 w-36 text-xs"
            />
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Next day"
              disabled={date >= today}
              onClick={() => setDate(addDays(date, 1))}
            >
              <ChevronRight />
            </Button>
            <Button variant="outline" size="sm" disabled={date === today} onClick={() => setDate(today)}>
              Today
            </Button>
          </div>
        }
      />
      <PageBody className="flex flex-col gap-3">
        {board.isPending ? (
          <BoardSkeleton />
        ) : board.isError ? (
          <ErrorState error={board.error} onRetry={() => void board.refetch()} />
        ) : board.data.columns.length === 0 ? (
          <EmptyState
            icon={Settings2}
            title="No readiness metrics selected"
            description="Choose which metrics appear on the board, and in which order, in Settings → Organization."
            action={
              isAdmin ? (
                <Button asChild variant="outline" size="sm">
                  <Link to="/settings">Open settings</Link>
                </Button>
              ) : undefined
            }
          />
        ) : board.data.rows.length === 0 ? (
          <EmptyState
            icon={Gauge}
            title={`No ${terms.athletes.toLowerCase()} here`}
            description={`There are no active ${terms.athletes.toLowerCase()} in this ${terms.group.toLowerCase()} that you can see.`}
          />
        ) : (
          <>
            <SummaryStrip board={board.data} filter={filter} onFilterChange={setFilter} />
            <ReadinessTable
              board={board.data}
              sort={sort.key}
              dir={sort.dir}
              onSortChange={(key, dir) => setSort({ key, dir })}
              filter={filter}
              athleteLabel={terms.athlete}
              onRowClick={(id) => void navigate({ to: "/athletes/$athleteId", params: { athleteId: id } })}
            />
            <Legend />
          </>
        )}
      </PageBody>
    </>
  );
}

function Legend() {
  return (
    <p className="text-xs text-muted-foreground">
      Values are the latest on or before the board date within 3 days; a small “2d” marks values from earlier days.
      Flags follow each metric’s thresholds. Sorted by priority (red, amber, missing) until you sort a column.
    </p>
  );
}

function BoardSkeleton() {
  return (
    <div className="grid gap-3" aria-busy>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
      <div className="grid gap-1.5 rounded-lg border p-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-8" />
        ))}
      </div>
    </div>
  );
}
