import { zodResolver } from "@hookform/resolvers/zod";
import { FORM_KINDS, SENSITIVITIES, type Form, type FormKind, type FormUpdate } from "@ams/shared";
import { useMutation } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { FormRow } from "@/components/FormRow";
import { Spinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useApi } from "@/lib/api-context";
import { toastError } from "@/lib/errors";
import { FORM_KIND_LABELS, SENSITIVITY_LABELS } from "@/lib/labels";
import { useOrg } from "@/lib/org";

const schema = z.object({
  name: z.string().trim().min(1, "Required").max(200),
  description: z.string().max(2000),
  kind: z.enum(FORM_KINDS as unknown as [FormKind, ...FormKind[]]),
  sensitivity: z.enum(["general", "medical", "research"]),
  athlete_can_submit: z.boolean(),
  athlete_can_view: z.boolean(),
  allow_multiple_per_day: z.boolean(),
  archived: z.boolean(),
});
type Values = z.infer<typeof schema>;

function defaults(f: Form): Values {
  return {
    name: f.name,
    description: f.description ?? "",
    kind: f.kind,
    sensitivity: f.sensitivity,
    athlete_can_submit: f.athlete_can_submit,
    athlete_can_view: f.athlete_can_view,
    allow_multiple_per_day: f.allow_multiple_per_day,
    archived: f.archived,
  };
}

const TOGGLES: { name: "athlete_can_submit" | "athlete_can_view" | "allow_multiple_per_day" | "archived"; label: string; hint: string }[] = [
  { name: "athlete_can_submit", label: "Athletes can submit", hint: "Shown in the mobile app (scheduled forms appear as due)." },
  { name: "athlete_can_view", label: "Athletes can view their answers", hint: "Their own submissions appear in their history." },
  { name: "allow_multiple_per_day", label: "Allow several submissions per day", hint: "E.g. one sRPE per session. Otherwise a second one is rejected (409)." },
  { name: "archived", label: "Archived", hint: "Hidden from entry and lists; data is kept." },
];

export function FormSettingsTab({ form, onSaved }: { form: Form; onSaved(f: Form): void }) {
  const api = useApi();
  const { orgId, isAdmin } = useOrg();
  const rhf = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults(form) });
  const save = useMutation({
    mutationFn: (body: FormUpdate) => api.forms.update(orgId, form.id, body),
    onSuccess: (f) => {
      onSaved(f);
      rhf.reset(defaults(f));
      toast.success("Form settings saved");
    },
    onError: (e) => toastError(e, "Could not save settings"),
  });
  const e = rhf.formState.errors;

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <div>
          <CardTitle>Form settings</CardTitle>
          <CardDescription>
            Slug <code className="font-mono">{form.slug}</code> (used in metric sources such as <code className="font-mono">form:{form.slug}.field</code>)
          </CardDescription>
        </div>
      </CardHeader>
      <form
        noValidate
        onSubmit={rhf.handleSubmit((v) => save.mutate({ ...v, name: v.name.trim(), description: v.description.trim() || null }))}
      >
        <fieldset disabled={!isAdmin} className="contents">
          <CardContent className="grid gap-4 py-4 sm:grid-cols-2">
            <FormRow label="Name" htmlFor="fs-name" error={e.name?.message} className="sm:col-span-2">
              <Input id="fs-name" {...rhf.register("name")} />
            </FormRow>
            <FormRow label="Description" htmlFor="fs-desc" className="sm:col-span-2" optional>
              <Textarea id="fs-desc" rows={2} {...rhf.register("description")} />
            </FormRow>
            <FormRow label="Kind" htmlFor="fs-kind">
              <NativeSelect id="fs-kind" {...rhf.register("kind")}>
                {FORM_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {FORM_KIND_LABELS[k]}
                  </option>
                ))}
              </NativeSelect>
            </FormRow>
            <FormRow label="Sensitivity" htmlFor="fs-sens" hint="Medical: only medical staff read it. Research: only researchers.">
              <NativeSelect id="fs-sens" {...rhf.register("sensitivity")}>
                {SENSITIVITIES.map((s) => (
                  <option key={s} value={s}>
                    {SENSITIVITY_LABELS[s]}
                  </option>
                ))}
              </NativeSelect>
            </FormRow>
            <div className="grid gap-3 sm:col-span-2">
              {TOGGLES.map((t) => (
                <Controller
                  key={t.name}
                  control={rhf.control}
                  name={t.name}
                  render={({ field }) => (
                    <label className="flex items-start gap-3 text-sm">
                      <Switch checked={field.value} onCheckedChange={field.onChange} className="mt-0.5" />
                      <span>
                        {t.label}
                        <span className="block text-xs text-muted-foreground">{t.hint}</span>
                      </span>
                    </label>
                  )}
                />
              ))}
            </div>
          </CardContent>
          <CardFooter className="justify-end">
            <Button variant="ghost" type="button" onClick={() => rhf.reset(defaults(form))} disabled={!rhf.formState.isDirty}>
              Reset
            </Button>
            <Button type="submit" disabled={!rhf.formState.isDirty || save.isPending}>
              {save.isPending && <Spinner className="text-current" />}
              Save settings
            </Button>
          </CardFooter>
        </fieldset>
      </form>
    </Card>
  );
}
