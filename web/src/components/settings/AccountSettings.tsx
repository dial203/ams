import { zodResolver } from "@hookform/resolvers/zod";
import { queryKeys, type Me, type MeUpdate } from "@ams/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { FormRow } from "@/components/FormRow";
import { Spinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useApi } from "@/lib/api-context";
import { errorText } from "@/lib/errors";
import { useOrg } from "@/lib/org";

const profileSchema = z.object({ full_name: z.string().trim().min(1, "Required").max(200) });
const passwordSchema = z
  .object({
    current_password: z.string().min(1, "Required"),
    password: z.string().min(8, "Use at least 8 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords do not match" });

export function AccountSettings() {
  const api = useApi();
  const qc = useQueryClient();
  const { me } = useOrg();
  const profile = useForm<z.infer<typeof profileSchema>>({ resolver: zodResolver(profileSchema), defaultValues: { full_name: me.user.full_name } });
  const password = useForm<z.infer<typeof passwordSchema>>({ resolver: zodResolver(passwordSchema), defaultValues: { current_password: "", password: "", confirm: "" } });
  const update = useMutation({
    mutationFn: (body: MeUpdate) => api.me.update(body),
    onSuccess: (user) => qc.setQueryData<Me>(queryKeys.me(), (m) => (m ? { ...m, user } : m)),
  });

  return (
    <div className="grid max-w-2xl gap-4">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Profile</CardTitle>
            <CardDescription>{me.user.email}</CardDescription>
          </div>
        </CardHeader>
        <form
          noValidate
          onSubmit={profile.handleSubmit(async (v) => {
            try {
              await update.mutateAsync({ full_name: v.full_name.trim() });
              profile.reset(v);
              toast.success("Profile saved");
            } catch (e) {
              toast.error(errorText(e));
            }
          })}
        >
          <CardContent className="py-4">
            <FormRow label="Full name" htmlFor="acc-name" error={profile.formState.errors.full_name?.message}>
              <Input id="acc-name" autoComplete="name" {...profile.register("full_name")} />
            </FormRow>
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="submit" disabled={!profile.formState.isDirty || update.isPending}>
              Save
            </Button>
          </CardFooter>
        </form>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
        </CardHeader>
        <form
          noValidate
          onSubmit={password.handleSubmit(async (v) => {
            try {
              await update.mutateAsync({ current_password: v.current_password, password: v.password });
              password.reset();
              toast.success("Password changed");
            } catch (e) {
              password.setError("current_password", { message: errorText(e) });
            }
          })}
        >
          <CardContent className="grid gap-4 py-4">
            <FormRow label="Current password" htmlFor="acc-cur" error={password.formState.errors.current_password?.message}>
              <Input id="acc-cur" type="password" autoComplete="current-password" {...password.register("current_password")} />
            </FormRow>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormRow label="New password" htmlFor="acc-new" error={password.formState.errors.password?.message}>
                <Input id="acc-new" type="password" autoComplete="new-password" {...password.register("password")} />
              </FormRow>
              <FormRow label="Confirm" htmlFor="acc-confirm" error={password.formState.errors.confirm?.message}>
                <Input id="acc-confirm" type="password" autoComplete="new-password" {...password.register("confirm")} />
              </FormRow>
            </div>
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="submit" disabled={update.isPending}>
              {update.isPending && <Spinner className="text-current" />}
              Change password
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
