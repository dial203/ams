import { zodResolver } from "@hookform/resolvers/zod";
import { queryKeys } from "@ams/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { FormRow } from "@/components/FormRow";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Spinner } from "@/components/states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApi } from "@/lib/api-context";
import { errorText, isStatus } from "@/lib/errors";
import { useAcceptInvite } from "@/lib/session";

export const Route = createFileRoute("/accept-invite")({
  validateSearch: z.object({ token: z.string().optional() }),
  component: AcceptInvitePage,
});

const schema = z
  .object({
    full_name: z.string().trim().min(1, "Enter your name"),
    password: z.string().min(8, "Use at least 8 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords do not match" });
type Values = z.infer<typeof schema>;

function AcceptInvitePage() {
  const { token } = Route.useSearch();
  const api = useApi();
  const navigate = useNavigate();
  const accept = useAcceptInvite();
  const invite = useQuery({
    queryKey: queryKeys.invite(token ?? ""),
    queryFn: ({ signal }) => api.auth.getInvite(token!, { signal }),
    enabled: !!token,
    retry: false,
  });
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { full_name: "", password: "", confirm: "" } });

  if (!token) {
    return (
      <AuthLayout title="Invitation link incomplete">
        <p className="text-sm text-muted-foreground">
          The link is missing its token. Open the link from your invitation email again, or ask your administrator
          for a new one.
        </p>
      </AuthLayout>
    );
  }

  if (invite.isPending) {
    return (
      <AuthLayout title="Accept invitation">
        <Spinner />
      </AuthLayout>
    );
  }

  if (invite.isError) {
    return (
      <AuthLayout title="Invitation not valid">
        <Alert variant="destructive">
          <AlertTitle>
            {isStatus(invite.error, 404) || isStatus(invite.error, 410)
              ? "This invitation has expired or was already used."
              : errorText(invite.error)}
          </AlertTitle>
          <AlertDescription>Ask your administrator to send a new invitation.</AlertDescription>
        </Alert>
        <Link to="/login" className="mt-4 inline-block text-sm text-brand hover:underline">
          Go to sign in
        </Link>
      </AuthLayout>
    );
  }

  const details = invite.data;
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await accept.mutateAsync({ token, password: values.password, full_name: values.full_name.trim() });
      await navigate({ to: "/" });
    } catch {
      /* shown below */
    }
  });

  return (
    <AuthLayout
      title={`Join ${details.org_name}`}
      description={
        <>
          You were invited as <span className="font-medium text-foreground capitalize">{details.role}</span> with{" "}
          <span className="font-medium text-foreground">{details.email}</span>.
        </>
      }
    >
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        {accept.error && (
          <Alert variant="destructive">
            <AlertDescription className="text-destructive">{errorText(accept.error)}</AlertDescription>
          </Alert>
        )}
        <FormRow label="Email" htmlFor="email">
          <Input id="email" value={details.email} readOnly disabled />
        </FormRow>
        <FormRow label="Full name" htmlFor="full_name" error={form.formState.errors.full_name?.message}>
          <Input id="full_name" autoComplete="name" autoFocus {...form.register("full_name")} />
        </FormRow>
        <FormRow
          label="Password"
          htmlFor="password"
          error={form.formState.errors.password?.message}
          hint="If you already have an AMS account, enter its password."
        >
          <Input id="password" type="password" autoComplete="new-password" {...form.register("password")} />
        </FormRow>
        <FormRow label="Confirm password" htmlFor="confirm" error={form.formState.errors.confirm?.message}>
          <Input id="confirm" type="password" autoComplete="new-password" {...form.register("confirm")} />
        </FormRow>
        <Button type="submit" className="h-9" disabled={accept.isPending}>
          {accept.isPending && <Spinner className="text-current" />}
          Accept invitation
        </Button>
        <p className="text-xs text-muted-foreground">
          Expires {new Date(details.expires_at).toLocaleString()}.
        </p>
      </form>
    </AuthLayout>
  );
}
