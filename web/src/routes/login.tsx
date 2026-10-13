import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { FormRow } from "@/components/FormRow";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Spinner } from "@/components/states";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDemoMode, type DemoAccount } from "@/lib/demo-mode";
import { errorText, isStatus } from "@/lib/errors";
import { useLogin } from "@/lib/session";

const searchSchema = z.object({ redirect: z.string().optional() });

export const Route = createFileRoute("/login")({
  validateSearch: searchSchema,
  beforeLoad: ({ context, search }) => {
    if (context.tokens.isAuthenticated()) throw redirect({ href: safeRedirect(search.redirect) });
  },
  component: LoginPage,
});

/** Only same-origin relative paths. */
function safeRedirect(target: string | undefined): string {
  return target && target.startsWith("/") && !target.startsWith("//") && !target.startsWith("/login") ? target : "/";
}

const loginSchema = z.object({
  email: z.string().trim().min(1, "Enter your email").email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});
type LoginValues = z.infer<typeof loginSchema>;

function LoginPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const login = useLogin();
  const demo = useDemoMode();
  const form = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });

  const signIn = async (values: LoginValues) => {
    try {
      await login.mutateAsync(values);
      await navigate({ href: safeRedirect(search.redirect) });
    } catch {
      /* shown below */
    }
  };
  const onSubmit = form.handleSubmit(signIn);

  if (demo) {
    return (
      <AuthLayout title="Try the demo" description="Pick a role. Each one sees what that login would see on a real server.">
        <DemoRoles accounts={demo.accounts} busy={login.isPending} onPick={(a) => void signIn({ email: a.email, password: a.password })} />
        {login.error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {errorText(login.error)}
          </p>
        )}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Sign in" description="Use the email and password from your invitation.">
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        {login.error && (
          <Alert variant="destructive">
            <AlertDescription className="text-destructive">
              {isStatus(login.error, 401) ? "Incorrect email or password." : errorText(login.error)}
            </AlertDescription>
          </Alert>
        )}
        <FormRow label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            autoFocus
            aria-invalid={!!form.formState.errors.email}
            {...form.register("email")}
          />
        </FormRow>
        <FormRow label="Password" htmlFor="password" error={form.formState.errors.password?.message}>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={!!form.formState.errors.password}
            {...form.register("password")}
          />
        </FormRow>
        <Button type="submit" className="h-9" disabled={login.isPending}>
          {login.isPending && <Spinner className="text-current" />}
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}

function DemoRoles({ accounts, busy, onPick }: { accounts: readonly DemoAccount[]; busy: boolean; onPick(account: DemoAccount): void }) {
  return (
    <ul className="grid gap-2" aria-label="Demo roles">
      {accounts.map((a) => (
        <li key={a.email}>
          <button
            type="button"
            disabled={busy}
            onClick={() => onPick(a)}
            className="flex w-full flex-col items-start gap-0.5 rounded-lg border p-3 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-60"
          >
            <span className="text-sm font-medium">{a.label}</span>
            <span className="text-xs text-muted-foreground">{a.description}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
