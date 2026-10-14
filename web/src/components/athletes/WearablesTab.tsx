import {
  addDays,
  dateRange,
  isApiError,
  queryKeys,
  type Athlete,
  type ConnectRequest,
  type WearableDailyPoint,
  type WearableProvider,
  type WearableStatus,
} from "@ams/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, History, Link2, Plug, RefreshCw, Watch } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sparkline } from "@/components/charts/Sparkline";
import { CopyButton } from "@/components/CopyButton";
import { FormRow } from "@/components/FormRow";
import { EmptyState, ErrorState, Spinner } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApi } from "@/lib/api-context";
import { toastError } from "@/lib/errors";
import { formatNumber } from "@/lib/field-format";
import { useOrg } from "@/lib/org";
import { useWearableProviders } from "@/lib/queries";
import { ProviderRanking } from "@/components/wearables/ProviderRanking";
import { isNotConfigured, providerLabel, relativeTime, wearableMetricLabel } from "@/lib/wearables";

const DAYS = 28;

export function OwNotConfigured({ error, compact = false }: { error?: unknown; compact?: boolean }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-dashed bg-muted/30 px-4 py-4">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
        <Plug aria-hidden className="size-4 text-muted-foreground" />
      </div>
      <div className="grid gap-1 text-sm">
        <div className="font-medium">Wearables are not set up on this server</div>
        <p className="text-muted-foreground">
          AMS reads wearable data through Open Wearables. Once an administrator sets{" "}
          <code className="rounded bg-muted px-1 font-mono text-xs">OW_BASE_URL</code> and{" "}
          <code className="rounded bg-muted px-1 font-mono text-xs">OW_API_KEY</code> on the API, providers, device links
          and daily sleep, HRV and activity data appear here.
        </p>
        {!compact && isApiError(error) && error.detail && (
          <p className="text-xs text-muted-foreground/80">Server: {error.detail}</p>
        )}
      </div>
    </div>
  );
}

export function WearablesTab({ athlete }: { athlete: Athlete }) {
  const api = useApi();
  const qc = useQueryClient();
  const { orgId, today, terms } = useOrg();
  const [connectOpen, setConnectOpen] = useState(false);
  // set while a history copy queued from here runs: poll until history_synced_at moves past it
  const [historySince, setHistorySince] = useState<string | null>(null);
  const status = useQuery({
    queryKey: queryKeys.wearables.status(orgId, athlete.id),
    queryFn: ({ signal }) => api.wearables.status(orgId, athlete.id, { signal }),
    refetchInterval: historySince ? 3000 : false,
  });
  const copiedAt = status.data?.history_synced_at ?? null;
  useEffect(() => {
    if (!historySince || !copiedAt || copiedAt <= historySince) return;
    setHistorySince(null);
    void qc.invalidateQueries({ queryKey: queryKeys.wearables.athlete(orgId, athlete.id) });
    void qc.invalidateQueries({ queryKey: queryKeys.metrics.allSeries(orgId) });
    void qc.invalidateQueries({ queryKey: queryKeys.dashboards.all(orgId) });
    toast.success("Wearable history copied");
  }, [historySince, copiedAt, qc, orgId, athlete.id]);
  useEffect(() => {
    if (!historySince) return;
    const t = setTimeout(() => setHistorySince(null), 120_000); // stop polling; the copy may still finish
    return () => clearTimeout(t);
  }, [historySince]);
  const providers = useWearableProviders();
  const providerName = (p: string) => providers.data?.find((x) => x.provider === p)?.name ?? p;

  const link = useMutation({
    mutationFn: () => api.wearables.link(orgId, athlete.id),
    onSuccess: (s) => {
      qc.setQueryData(queryKeys.wearables.status(orgId, athlete.id), s);
      void qc.invalidateQueries({ queryKey: queryKeys.athletes.all(orgId) });
      toast.success("Linked to Open Wearables");
    },
    onError: (e) => toastError(e, "Could not link"),
  });
  const refresh = useMutation({
    mutationFn: () => api.wearables.refresh(orgId, athlete.id, { days: 7 }),
    onSuccess: (r) => {
      toast.success(`Sync complete`, { description: `${r.updated} daily value${r.updated === 1 ? "" : "s"} updated` });
      void qc.invalidateQueries({ queryKey: queryKeys.wearables.athlete(orgId, athlete.id) });
      void qc.invalidateQueries({ queryKey: queryKeys.metrics.allSeries(orgId) });
    },
    onError: (e) => toastError(e, "Refresh failed"),
  });
  const history = useMutation({
    mutationFn: () => api.wearables.history(orgId, athlete.id),
    onMutate: () => setHistorySince(new Date().toISOString()),
    onSuccess: (r) => {
      toast.success("Copying wearable history", {
        description: `The last ${r.days} days from Open Wearables. This can take a minute.`,
      });
    },
    onError: (e) => {
      setHistorySince(null);
      toastError(e, "Could not pull history");
    },
  });

  if (status.isPending) return <Skeleton className="h-48" />;
  if (status.isError) {
    return isNotConfigured(status.error) ? (
      <OwNotConfigured error={status.error} />
    ) : (
      <ErrorState error={status.error} onRetry={() => void status.refetch()} />
    );
  }
  const s = status.data;
  const owMissing = isNotConfigured(providers.error);

  return (
    <div className="grid gap-4">
      {owMissing && <OwNotConfigured error={providers.error} />}
      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              Connections
              {s.linked ? <Badge variant="success">Linked</Badge> : <Badge variant="muted">Not linked</Badge>}
            </CardTitle>
            <CardDescription>
              {s.linked
                ? `Open Wearables user ${s.ow_user_id ?? ""} · ${
                    s.history_synced_at ? `history copied ${relativeTime(s.history_synced_at)}` : "history not copied yet"
                  }`
                : `Link this ${terms.athlete.toLowerCase()} to Open Wearables to connect devices.`}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {!s.linked && (
              <Button size="sm" variant="outline" onClick={() => link.mutate()} disabled={link.isPending || owMissing}>
                {link.isPending ? <Spinner className="text-current" /> : <Link2 />}
                Link
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => refresh.mutate()} disabled={!s.linked || refresh.isPending || owMissing}>
              <RefreshCw className={refresh.isPending ? "animate-spin" : undefined} />
              Refresh now
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => history.mutate()}
              disabled={!s.linked || history.isPending || !!historySince || owMissing}
              title="Copy the full history window from Open Wearables, e.g. after a provider delivered older data"
            >
              {historySince ? <Spinner className="text-current" /> : <History />}
              {historySince ? "Pulling history…" : "Pull history"}
            </Button>
            <Button size="sm" onClick={() => setConnectOpen(true)} disabled={owMissing}>
              <Plug /> Connect provider
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {s.connections.length === 0 ? (
            <EmptyState
              icon={Watch}
              title="No connected providers"
              description={
                owMissing
                  ? "Device connections become available once Open Wearables is configured. Cached daily data below still shows."
                  : "Connect a cloud provider (Garmin, Oura, Whoop, Polar…) with an authorization link, or ask them to enable Apple Health / Health Connect in the mobile app."
              }
            />
          ) : (
            <Table containerClassName="px-1">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Provider</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Devices</TableHead>
                  <TableHead className="text-right">Last sync</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.connections.map((c) => (
                  <TableRow key={c.connection_id}>
                    <TableCell className="font-medium">{providerName(c.provider)}</TableCell>
                    <TableCell>
                      <Badge variant={c.status === "active" ? "success" : c.status === "revoked" ? "destructive" : "muted"}>{c.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {[c.account_label, c.account_type].filter(Boolean).join(" · ") || "–"}
                    </TableCell>
                    <TableCell className="max-w-64 truncate text-muted-foreground" title={c.devices.join(", ")}>
                      {c.devices.length ? c.devices.join(", ") : "–"}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground" title={c.last_synced_at ?? undefined}>
                      {relativeTime(c.last_synced_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <SourcePriority athlete={athlete} status={s} providers={providers.data} />
      <DailyData athlete={athlete} start={addDays(today, -(DAYS - 1))} end={today} />
      <ConnectDialog
        athlete={athlete}
        open={connectOpen}
        onOpenChange={setConnectOpen}
        providers={providers.data}
        providersError={providers.error}
        connectedProviders={s.connections.map((c) => c.provider)}
      />
    </div>
  );
}

/** Which provider wins each day: the athlete's own ranking or the organization's. */
function SourcePriority({
  athlete,
  status,
  providers,
}: {
  athlete: Athlete;
  status: WearableStatus;
  providers: WearableProvider[] | undefined;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const { orgId, terms } = useOrg();
  const [draft, setDraft] = useState<string[] | null>(null);
  const connected = status.connections.map((c) => c.provider);
  // the providers that matter for this athlete, in the order in force
  const relevant = status.effective_priority.filter((p) => status.sources.includes(p) || connected.includes(p));
  const extra = [...status.sources, ...connected].filter((p) => !status.effective_priority.includes(p));
  const shown = [...relevant, ...new Set(extra)];
  const save = useMutation({
    mutationFn: (providersInOrder: string[] | null) =>
      api.wearables.setPriority(orgId, athlete.id, { providers: providersInOrder }),
    onSuccess: (next) => {
      qc.setQueryData(queryKeys.wearables.status(orgId, athlete.id), next);
      void qc.invalidateQueries({ queryKey: queryKeys.wearables.athlete(orgId, athlete.id) });
      void qc.invalidateQueries({ queryKey: queryKeys.metrics.allSeries(orgId) });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboards.all(orgId) });
      setDraft(null);
      toast.success(next.priority ? "Source priority saved" : "Using the organization’s source priority");
    },
    onError: (e) => toastError(e, "Could not save the source priority"),
  });
  const note = (p: string) =>
    [status.sources.includes(p) ? "has data" : null, connected.includes(p) ? "connected" : null].filter(Boolean).join(" · ") || null;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            Source priority
            {status.priority ? <Badge>Custom</Badge> : <Badge variant="muted">Organization default</Badge>}
          </CardTitle>
          <CardDescription>
            Each day’s value comes from the first provider below that has one; a lower one fills days the first has nothing for.
            Z-score baselines only count days from the same device.
          </CardDescription>
        </div>
        {draft === null && (
          <div className="flex flex-wrap gap-2">
            {status.priority && (
              <Button size="sm" variant="ghost" onClick={() => save.mutate(null)} disabled={save.isPending}>
                Use organization default
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setDraft(shown.length ? shown : [])}>
              Change
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="grid gap-3 py-4">
        {draft !== null ? (
          <>
            <ProviderRanking
              value={draft}
              onChange={setDraft}
              providers={providers}
              badges={note}
              label={`Source priority for ${athlete.display_name}`}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button onClick={() => save.mutate(draft.length ? draft : null)} disabled={save.isPending}>
                {save.isPending && <Spinner className="text-current" />}
                Save for this {terms.athlete.toLowerCase()}
              </Button>
            </div>
          </>
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">No provider has sent data yet.</p>
        ) : (
          <ol className="grid gap-1" aria-label="Source priority in use">
            {shown.map((p, i) => (
              <li key={p} className="flex items-center gap-2 text-sm">
                <span className="w-5 text-xs text-muted-foreground tabular">{i + 1}</span>
                <span className="font-medium">{providerLabel(p, providers)}</span>
                {note(p) && <span className="text-xs text-muted-foreground">{note(p)}</span>}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function DailyData({ athlete, start, end }: { athlete: Athlete; start: string; end: string }) {
  const api = useApi();
  const { orgId } = useOrg();
  const params = { start, end };
  const daily = useQuery({
    queryKey: queryKeys.wearables.daily(orgId, athlete.id, params),
    queryFn: ({ signal }) => api.wearables.daily(orgId, athlete.id, params, { signal }),
  });
  const days = dateRange(start, end);
  const byMetric = new Map<string, WearableDailyPoint[]>();
  for (const p of daily.data ?? []) {
    const list = byMetric.get(p.metric) ?? [];
    list.push(p);
    byMetric.set(p.metric, list);
  }
  const metrics = [...byMetric.keys()];

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Daily wearable data</CardTitle>
          <CardDescription>Last {DAYS} days from the AMS cache (one source per day, by the source priority above)</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {daily.isPending ? (
          <Skeleton className="m-4 h-32" />
        ) : daily.isError ? (
          isNotConfigured(daily.error) ? <div className="p-4"><OwNotConfigured error={daily.error} /></div> : <ErrorState error={daily.error} />
        ) : metrics.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">No wearable data in this period.</div>
        ) : (
          <Table containerClassName="px-1">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Metric</TableHead>
                <TableHead>{DAYS} days</TableHead>
                <TableHead className="text-right">Latest</TableHead>
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {metrics.map((m) => {
                const pts = byMetric.get(m)!;
                const byDay = new Map(pts.map((p) => [p.local_date, p]));
                const latest = pts.reduce((a, b) => (b.local_date > a.local_date ? b : a));
                return (
                  <TableRow key={m}>
                    <TableCell className="font-medium">{wearableMetricLabel(m)}</TableCell>
                    <TableCell>
                      <Sparkline values={days.map((d) => byDay.get(d)?.value ?? null)} label={`${wearableMetricLabel(m)} trend`} />
                    </TableCell>
                    <TableCell className="text-right tabular">
                      <span className="font-medium">{formatNumber(latest.value, latest.value >= 100 ? 0 : 1)}</span>{" "}
                      <span className="text-xs text-muted-foreground">{latest.unit}</span>
                      <div className="text-[11px] text-muted-foreground">{latest.local_date}</div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {latest.provider}
                      {latest.device ? ` · ${latest.device}` : ""}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function ConnectDialog({
  athlete,
  open,
  onOpenChange,
  providers,
  providersError,
  connectedProviders,
}: {
  athlete: Athlete;
  open: boolean;
  onOpenChange(open: boolean): void;
  providers: WearableProvider[] | undefined;
  providersError: unknown;
  connectedProviders: string[];
}) {
  const api = useApi();
  const qc = useQueryClient();
  const { orgId } = useOrg();
  const cloud = (providers ?? []).filter((p) => p.kind === "cloud" && p.enabled);
  const [provider, setProvider] = useState("");
  const [accountType, setAccountType] = useState("");
  const [accountLabel, setAccountLabel] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [additional, setAdditional] = useState<boolean | null>(null);
  const connect = useMutation({
    mutationFn: (body: ConnectRequest) => api.wearables.connect(orgId, athlete.id, body),
    onSuccess: (r) => {
      setUrl(r.authorization_url);
      void qc.invalidateQueries({ queryKey: queryKeys.wearables.status(orgId, athlete.id) });
    },
    onError: (e) => toastError(e, "Could not create the authorization link"),
  });
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setUrl(null);
      setAdditional(null);
      connect.reset();
    }
  };
  const chosen = provider || cloud[0]?.provider || "";
  const alreadyConnected = connectedProviders.includes(chosen);
  const newAccount = additional ?? alreadyConnected;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect a provider</DialogTitle>
          <DialogDescription>
            Creates a one-time authorization link for {athlete.display_name}. Open it on their phone (scan the QR code) or
            send it to them.
          </DialogDescription>
        </DialogHeader>
        {providersError ? (
          isNotConfigured(providersError) ? <OwNotConfigured error={providersError} /> : <ErrorState error={providersError} />
        ) : url ? (
          <div className="grid gap-4">
            <div className="mx-auto rounded-lg border bg-white p-3">
              <QRCodeSVG value={url} size={176} marginSize={0} aria-label="Authorization link QR code" role="img" />
            </div>
            <div className="flex items-center gap-2">
              <Input readOnly value={url} aria-label="Authorization link" className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <CopyButton value={url} label="Copy link" />
              <Button asChild variant="outline" size="icon-sm" aria-label="Open link">
                <a href={url} target="_blank" rel="noreferrer noopener">
                  <ExternalLink />
                </a>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">The connection appears here after the provider authorization completes.</p>
          </div>
        ) : (
          <form
            id="connect-form"
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!chosen) return;
              connect.mutate({
                provider: chosen,
                account_type: accountType.trim() || null,
                account_label: accountLabel.trim() || null,
                new_account: newAccount || null,
              });
            }}
          >
            <FormRow label="Provider" htmlFor="c-provider">
              <NativeSelect id="c-provider" value={chosen} onChange={(e) => setProvider(e.target.value)} disabled={!providers}>
                {!providers && <option>Loading…</option>}
                {providers && cloud.length === 0 && <option value="">No cloud providers enabled</option>}
                {cloud.map((p) => (
                  <option key={p.provider} value={p.provider}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            </FormRow>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormRow label="Account type" htmlFor="c-type" optional hint="e.g. primary, validation">
                <Input id="c-type" list="account-types" value={accountType} onChange={(e) => setAccountType(e.target.value)} />
                <datalist id="account-types">
                  <option value="primary" />
                  <option value="validation" />
                  <option value="research" />
                </datalist>
              </FormRow>
              <FormRow label="Account label" htmlFor="c-label" optional hint="e.g. left wrist unit">
                <Input id="c-label" value={accountLabel} onChange={(e) => setAccountLabel(e.target.value)} />
              </FormRow>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={newAccount} onCheckedChange={(v) => setAdditional(v === true)} className="mt-0.5" />
              <span>
                Add as an additional account
                <span className="block text-xs text-muted-foreground">
                  {alreadyConnected ? "This provider is already connected. " : ""}For validation studies, connect a second
                  account of the same provider with its own type/label to record two devices worn at once.
                </span>
              </span>
            </label>
          </form>
        )}
        <DialogFooter>
          {url ? (
            <Button onClick={() => close(false)}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button type="submit" form="connect-form" disabled={!chosen || connect.isPending || !!providersError}>
                {connect.isPending && <Spinner className="text-current" />}
                Create link
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

