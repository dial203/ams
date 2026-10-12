import type { Me } from "@ams/shared";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { Building2, LogOut } from "lucide-react";
import { useCallback, useState } from "react";
import { AthleteHome } from "@/components/athlete-home/AthleteHome";
import { AppShell } from "@/components/layout/AppShell";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { ErrorState, FullPageSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { OrgProvider, pickMembership, rememberedOrgId, rememberOrgId } from "@/lib/org";
import { useLogout, useMe } from "@/lib/session";

export const Route = createFileRoute("/_app")({
  beforeLoad: ({ context, location }) => {
    if (!context.tokens.isAuthenticated()) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  component: AppGate,
});

function AppGate() {
  const me = useMe();
  const [selected, setSelected] = useState<string | null>(() => rememberedOrgId());

  const switchOrg = useCallback((orgId: string) => {
    rememberOrgId(orgId);
    setSelected(orgId);
  }, []);

  if (me.isPending) return <FullPageSpinner />;
  if (me.isError) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <ErrorState error={me.error} title="Could not load your account" onRetry={() => void me.refetch()} />
      </div>
    );
  }

  const membership = pickMembership(me.data, selected);
  if (!membership) {
    return <OrgPicker me={me.data} onPick={switchOrg} />;
  }

  return (
    <OrgProvider me={me.data} membership={membership} onSwitchOrg={switchOrg}>
      {membership.role === "athlete" ? (
        <AthleteHome />
      ) : (
        <AppShell>
          <Outlet />
        </AppShell>
      )}
    </OrgProvider>
  );
}

function OrgPicker({ me, onPick }: { me: Me; onPick(orgId: string): void }) {
  const logout = useLogout();
  if (me.memberships.length === 0) {
    return (
      <AuthLayout title="No organization yet" description={`Signed in as ${me.user.email}.`}>
        <p className="text-sm text-muted-foreground">
          Your account is not a member of any organization. Ask an administrator to invite you.
        </p>
        <Button
          variant="outline"
          className="mt-6"
          onClick={async () => {
            await logout();
            window.location.assign("/login");
          }}
        >
          <LogOut /> Sign out
        </Button>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Choose an organization" description={`Signed in as ${me.user.email}.`}>
      <ul className="grid gap-2">
        {me.memberships.map((m) => (
          <li key={m.org.id}>
            <button
              type="button"
              onClick={() => onPick(m.org.id)}
              className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
            >
              <Building2 aria-hidden className="size-4 text-muted-foreground" />
              <span className="flex-1">
                <span className="block text-sm font-medium">{m.org.name}</span>
                <span className="block text-xs text-muted-foreground capitalize">{m.role}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </AuthLayout>
  );
}
