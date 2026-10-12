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
  const form = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await login.mutateAsync(values);
      await navigate({ href: safeRedirect(search.redirect) });
    } catch {
      /* shown below */
    }
  });

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
