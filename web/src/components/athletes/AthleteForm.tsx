import type { AthleteStatus, Group } from "@ams/shared";
import { Controller } from "react-hook-form";
import { FormRow } from "@/components/FormRow";
import { GroupMultiSelect } from "@/components/GroupMultiSelect";
import { TimezoneSelect } from "@/components/TimezoneSelect";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { useAthleteForm } from "@/lib/athlete-form";
import { STATUS_LABELS } from "@/lib/labels";

type FormApi = ReturnType<typeof useAthleteForm>;

export function AthleteFields({
  form,
  mode,
  groups,
  masked = false,
  athleteTerm,
  groupsTerm,
}: {
  form: FormApi;
  mode: "create" | "edit";
  groups: readonly Group[];
  masked?: boolean;
  athleteTerm: string;
  groupsTerm: string;
}) {
  const { register, formState, control } = form;
  const e = formState.errors;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {masked ? (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground sm:col-span-2">
          Name, email and date of birth are hidden for your access level and cannot be edited here.
        </p>
      ) : (
        <>
          <FormRow label="First name" htmlFor="a-first" error={e.first_name?.message}>
            <Input id="a-first" autoFocus={mode === "create"} {...register("first_name")} aria-invalid={!!e.first_name} />
          </FormRow>
          <FormRow label="Last name" htmlFor="a-last" error={e.last_name?.message}>
            <Input id="a-last" {...register("last_name")} aria-invalid={!!e.last_name} />
          </FormRow>
          <FormRow label="Preferred name" htmlFor="a-pref" optional error={e.preferred_name?.message}>
            <Input id="a-pref" {...register("preferred_name")} />
          </FormRow>
          <FormRow label="Email" htmlFor="a-email" optional error={e.email?.message} hint="Used for app invitations">
            <Input id="a-email" type="email" {...register("email")} aria-invalid={!!e.email} />
          </FormRow>
          <FormRow label="Date of birth" htmlFor="a-dob" optional error={e.date_of_birth?.message}>
            <Input id="a-dob" type="date" {...register("date_of_birth")} />
          </FormRow>
        </>
      )}
      <FormRow
        label="Code"
        htmlFor="a-code"
        optional={mode === "create"}
        error={e.code?.message}
        hint={mode === "create" ? "Generated (A-0001…) when left empty" : "Used in de-identified views and imports"}
      >
        <Input id="a-code" className="font-mono" {...register("code")} aria-invalid={!!e.code} />
      </FormRow>
      <FormRow label="Sex" htmlFor="a-sex" optional>
        <NativeSelect id="a-sex" {...register("sex")}>
          <option value="">Not set</option>
          <option value="female">Female</option>
          <option value="male">Male</option>
          <option value="other">Other</option>
          <option value="undisclosed">Undisclosed</option>
        </NativeSelect>
      </FormRow>
      <FormRow label="Position / role" htmlFor="a-pos" optional>
        <Input id="a-pos" {...register("position")} />
      </FormRow>
      <FormRow label="Time zone" htmlFor="a-tz" hint={`Days are counted in this zone for this ${athleteTerm.toLowerCase()}`}>
        <Controller
          control={control}
          name="timezone"
          render={({ field }) => (
            <TimezoneSelect id="a-tz" value={field.value} onValueChange={field.onChange} emptyLabel="Organization default" />
          )}
        />
      </FormRow>
      {mode === "create" ? (
        <FormRow label={groupsTerm} htmlFor="a-groups" optional>
          <Controller
            control={control}
            name="group_ids"
            render={({ field }) => (
              <GroupMultiSelect id="a-groups" groups={groups} value={field.value} onChange={field.onChange} />
            )}
          />
        </FormRow>
      ) : (
        <FormRow label="Status" htmlFor="a-status" hint="Archived people are hidden from boards and entry">
          <NativeSelect id="a-status" {...register("status")}>
            {(Object.keys(STATUS_LABELS) as AthleteStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
        </FormRow>
      )}
    </div>
  );
}
