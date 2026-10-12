import { queryKeys, type AthleteStatus } from "@ams/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus, Search, Smartphone, Users, Watch } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { AthleteName, StatusBadge } from "@/components/athletes/AthleteBits";
import { AthleteFields } from "@/components/athletes/AthleteForm";
import { PageBody, PageHeader, Toolbar } from "@/components/page";
import { Pagination } from "@/components/Pagination";
import { EmptyState, ErrorState, Spinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDebounced } from "@/hooks/use-debounced";
import { useApi } from "@/lib/api-context";
import { athleteFormDefaults, toAthleteCreate, useAthleteForm } from "@/lib/athlete-form";
import { toastError } from "@/lib/errors";
import { useOrg } from "@/lib/org";
import { useAthletes, useGroups } from "@/lib/queries";

const PAGE = 50;

export const Route = createFileRoute("/_app/athletes/")({
  validateSearch: z.object({
    q: z.string().optional(),
    status: z.enum(["active", "inactive", "archived", "all"]).optional(),
    offset: z.number().int().min(0).optional(),
  }),
  component: AthletesPage,
});

function AthletesPage() {
  const { terms, groupId } = useOrg();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [q, setQ] = useState(search.q ?? "");
  const debouncedQ = useDebounced(q.trim(), 250);
  const status = search.status ?? "active";
  const offset = search.offset ?? 0;
  const [creating, setCreating] = useState(false);
  const groups = useGroups();
  const groupName = new Map((groups.data ?? []).map((g) => [g.id, g.name]));

  const params = {
    q: debouncedQ || null,
    status: status === "all" ? null : (status as AthleteStatus),
    group_id: groupId,
    limit: PAGE,
    offset,
  };
  const athletes = useAthletes(params);

  const setSearch = (patch: Partial<typeof search>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  return (
    <>
      <PageHeader
        title={terms.athletes}
        description={athletes.data ? `${athletes.data.total} ${status === "all" ? "" : status} ${terms.athletes.toLowerCase()}` : undefined}
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus /> New {terms.athlete.toLowerCase()}
          </Button>
        }
      >
        <Toolbar>
          <div className="relative w-full max-w-xs">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                if (offset) setSearch({ offset: undefined });
              }}
              onBlur={() => setSearch({ q: q.trim() || undefined })}
              placeholder="Search name, code, email…"
              aria-label={`Search ${terms.athletes.toLowerCase()}`}
              className="h-7 pl-8 text-xs"
            />
          </div>
          <NativeSelect
            aria-label="Status"
            size="sm"
            wrapperClassName="w-36"
            value={status}
            onChange={(e) => setSearch({ status: e.target.value as typeof status, offset: undefined })}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="archived">Archived</option>
            <option value="all">All but archived</option>
          </NativeSelect>
          {athletes.isFetching && <Spinner />}
          <div className="ml-auto">
            {athletes.data && (
              <Pagination offset={offset} limit={PAGE} total={athletes.data.total} onChange={(o) => setSearch({ offset: o || undefined })} />
            )}
          </div>
        </Toolbar>
      </PageHeader>
      <PageBody className="p-0 md:p-0">
        {athletes.isPending ? (
          <div className="grid gap-1.5 p-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        ) : athletes.isError ? (
          <ErrorState error={athletes.error} onRetry={() => void athletes.refetch()} />
        ) : athletes.data.items.length === 0 ? (
          <EmptyState
            icon={Users}
            title={debouncedQ ? "No matches" : `No ${terms.athletes.toLowerCase()} yet`}
            description={debouncedQ ? "Try a different search, status or group." : `Add ${terms.athletes.toLowerCase()} one by one, or import them with a CSV.`}
            action={
              !debouncedQ && (
                <Button size="sm" onClick={() => setCreating(true)}>
                  <Plus /> New {terms.athlete.toLowerCase()}
                </Button>
              )
            }
          />
        ) : (
          <Table containerClassName="px-2 md:px-4">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>{terms.groups}</TableHead>
                <TableHead>Position</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Links</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {athletes.data.items.map((a) => (
                <TableRow
                  key={a.id}
                  className="cursor-pointer"
                  onClick={() => void navigate({ to: "/athletes/$athleteId", params: { athleteId: a.id } })}
                >
                  <TableCell>
                    <button
                      type="button"
                      className="rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                      onClick={(e) => {
                        e.stopPropagation();
                        void navigate({ to: "/athletes/$athleteId", params: { athleteId: a.id } });
                      }}
                    >
                      <AthleteName athlete={a} showCode={false} />
                    </button>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{a.code}</TableCell>
                  <TableCell className="max-w-64 truncate text-muted-foreground">
                    {a.group_ids.map((id) => groupName.get(id)).filter(Boolean).join(", ") || "–"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{a.position ?? "–"}</TableCell>
                  <TableCell>
                    <StatusBadge status={a.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="inline-flex items-center gap-2 text-muted-foreground">
                      <Smartphone
                        aria-label={a.user_id ? "Has app login" : "No app login"}
                        className={a.user_id ? "size-3.5 text-foreground" : "size-3.5 opacity-25"}
                      />
                      <Watch
                        aria-label={a.ow_user_id ? "Linked to wearables" : "Wearables not linked"}
                        className={a.ow_user_id ? "size-3.5 text-foreground" : "size-3.5 opacity-25"}
                      />
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </PageBody>
      <CreateAthleteDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

function CreateAthleteDialog({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { orgId, terms, groupId } = useOrg();
  const groups = useGroups();
  const form = useAthleteForm({ ...athleteFormDefaults(), group_ids: groupId ? [groupId] : [] });
  const create = useMutation({
    mutationFn: (body: ReturnType<typeof toAthleteCreate>) => api.athletes.create(orgId, body),
    onSuccess: async (athlete) => {
      await qc.invalidateQueries({ queryKey: queryKeys.athletes.all(orgId) });
      void qc.invalidateQueries({ queryKey: queryKeys.groups.all(orgId) });
      toast.success(`${athlete.display_name} added`, { description: `Code ${athlete.code}` });
      onOpenChange(false);
      form.reset({ ...athleteFormDefaults(), group_ids: groupId ? [groupId] : [] });
      void navigate({ to: "/athletes/$athleteId", params: { athleteId: athlete.id } });
    },
    onError: (e) => toastError(e, `Could not add ${terms.athlete.toLowerCase()}`),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New {terms.athlete.toLowerCase()}</DialogTitle>
          <DialogDescription>
            Only first and last name are required. You can invite them to the app from their profile.
          </DialogDescription>
        </DialogHeader>
        <form id="create-athlete" onSubmit={form.handleSubmit((v) => create.mutate(toAthleteCreate(v)))} noValidate>
          <AthleteFields form={form} mode="create" groups={groups.data ?? []} athleteTerm={terms.athlete} groupsTerm={terms.groups} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="create-athlete" disabled={create.isPending}>
            {create.isPending && <Spinner className="text-current" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

