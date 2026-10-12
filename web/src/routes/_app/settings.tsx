import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Building2, KeyRound, Mail, Plug, Users } from "lucide-react";
import { z } from "zod";
import { AccountSettings } from "@/components/settings/AccountSettings";
import { InvitationsSettings } from "@/components/settings/InvitationsSettings";
import { MembersSettings } from "@/components/settings/MembersSettings";
import { OrganizationSettings } from "@/components/settings/OrganizationSettings";
import { WearablesSettings } from "@/components/settings/WearablesSettings";
import { PageBody, PageHeader } from "@/components/page";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOrg } from "@/lib/org";

const TABS = ["organization", "members", "invitations", "wearables", "account"] as const;

export const Route = createFileRoute("/_app/settings")({
  validateSearch: z.object({ tab: z.enum(TABS).optional() }),
  component: SettingsPage,
});

function SettingsPage() {
  const { tab = "organization" } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { isAdmin, org } = useOrg();
  return (
    <Tabs value={tab} onValueChange={(t) => void navigate({ search: { tab: t === "organization" ? undefined : (t as (typeof TABS)[number]) }, replace: true })} className="gap-0">
      <PageHeader title="Settings" description={org.name}>
        <TabsList className="-mb-3 border-b-0">
          <TabsTrigger value="organization">
            <Building2 /> Organization
          </TabsTrigger>
          <TabsTrigger value="members">
            <Users /> Members
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="invitations">
              <Mail /> Invitations
            </TabsTrigger>
          )}
          <TabsTrigger value="wearables">
            <Plug /> Open Wearables
          </TabsTrigger>
          <TabsTrigger value="account">
            <KeyRound /> My account
          </TabsTrigger>
        </TabsList>
      </PageHeader>
      <PageBody>
        <TabsContent value="organization">
          <OrganizationSettings />
        </TabsContent>
        <TabsContent value="members">
          <MembersSettings />
        </TabsContent>
        {isAdmin && (
          <TabsContent value="invitations">
            <InvitationsSettings />
          </TabsContent>
        )}
        <TabsContent value="wearables">
          <WearablesSettings />
        </TabsContent>
        <TabsContent value="account">
          <AccountSettings />
        </TabsContent>
      </PageBody>
    </Tabs>
  );
}
