import { Watch } from "lucide-react";
import { OwNotConfigured } from "@/components/athletes/WearablesTab";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useWearableProviders } from "@/lib/queries";
import { isNotConfigured } from "@/lib/wearables";

export function WearablesSettings() {
  const providers = useWearableProviders();
  return (
    <div className="grid max-w-4xl gap-4">
      <p className="text-sm text-muted-foreground">
        Wearable data comes from Open Wearables, a separate service that handles provider sign-in, health-store sync and storage. AMS keeps a
        daily cache for boards and metrics. Providers are enabled in Open Wearables itself.
      </p>
      {providers.isPending ? (
        <Skeleton className="h-48" />
      ) : providers.isError ? (
        isNotConfigured(providers.error) ? (
          <OwNotConfigured error={providers.error} />
        ) : (
          <ErrorState error={providers.error} title="Could not reach Open Wearables" onRetry={() => void providers.refetch()} />
        )
      ) : providers.data.length === 0 ? (
        <Card>
          <EmptyState icon={Watch} title="No providers" description="Open Wearables is connected but reports no providers." />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardHeader>
            <div>
              <CardTitle>Connected service</CardTitle>
              <CardDescription>Open Wearables is configured. {providers.data.filter((p) => p.enabled).length} of {providers.data.length} providers enabled.</CardDescription>
            </div>
            <Badge variant="success">Connected</Badge>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Provider</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.data.map((p) => (
                <TableRow key={p.provider}>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      {p.icon_url ? <img src={p.icon_url} alt="" className="size-5 rounded" /> : <Watch aria-hidden className="size-4 text-muted-foreground" />}
                      <span className="font-medium">{p.name}</span>
                      <code className="font-mono text-xs text-muted-foreground">{p.provider}</code>
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.kind === "cloud" ? "Cloud (OAuth link)" : "On-device (mobile app SDK)"}</TableCell>
                  <TableCell>{p.enabled ? <Badge variant="success">Enabled</Badge> : <Badge variant="muted">Disabled</Badge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
