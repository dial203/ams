import { zodResolver } from "@hookform/resolvers/zod";
import type { Athlete, AthleteCreate, AthleteStatus, AthleteUpdate, Sex } from "@ams/shared";
import { useForm } from "react-hook-form";
import { z } from "zod";

const optionalText = z.string().trim().max(200);

const schema = z.object({
  first_name: z.string().trim().min(1, "Required").max(100),
  last_name: z.string().trim().min(1, "Required").max(100),
  preferred_name: optionalText,
  code: z
    .string()
    .trim()
    .max(32)
    .refine((v) => v === "" || /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(v), "Letters, digits, - _ . only"),
  email: z.string().trim().refine((v) => v === "" || z.email().safeParse(v).success, "Enter a valid email"),
  date_of_birth: z.string().refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Use YYYY-MM-DD"),
  sex: z.enum(["", "female", "male", "other", "undisclosed"]),
  position: optionalText,
  timezone: z.string().nullable(),
  group_ids: z.array(z.string()),
  status: z.enum(["active", "inactive", "archived"]),
});

export type AthleteFormValues = z.infer<typeof schema>;

const nullIfEmpty = (v: string) => (v.trim() === "" ? null : v.trim());

export function athleteFormDefaults(a?: Athlete | null): AthleteFormValues {
  return {
    first_name: a?.first_name ?? "",
    last_name: a?.last_name ?? "",
    preferred_name: a?.preferred_name ?? "",
    code: a?.code ?? "",
    email: a?.email ?? "",
    date_of_birth: a?.date_of_birth ?? "",
    sex: (a?.sex ?? "") as AthleteFormValues["sex"],
    position: a?.position ?? "",
    timezone: a?.timezone ?? null,
    group_ids: a?.group_ids ?? [],
    status: a?.status ?? "active",
  };
}

export function toAthleteCreate(v: AthleteFormValues): AthleteCreate {
  const body: AthleteCreate = {
    first_name: v.first_name.trim(),
    last_name: v.last_name.trim(),
    preferred_name: nullIfEmpty(v.preferred_name),
    email: nullIfEmpty(v.email),
    date_of_birth: v.date_of_birth || null,
    sex: (v.sex || null) as Sex | null,
    position: nullIfEmpty(v.position),
    timezone: v.timezone,
    group_ids: v.group_ids,
  };
  if (v.code.trim() !== "") body.code = v.code.trim();
  return body;
}

/** Only fields that changed; PII fields are left out for masked athletes. */
export function toAthleteUpdate(v: AthleteFormValues, before: Athlete): AthleteUpdate {
  const out: AthleteUpdate = {};
  const set = <K extends keyof AthleteUpdate>(k: K, value: AthleteUpdate[K], prev: unknown) => {
    if ((value ?? null) !== (prev ?? null)) out[k] = value;
  };
  if (!before.masked) {
    set("first_name", v.first_name.trim(), before.first_name);
    set("last_name", v.last_name.trim(), before.last_name);
    set("preferred_name", nullIfEmpty(v.preferred_name), before.preferred_name);
    set("email", nullIfEmpty(v.email), before.email);
    set("date_of_birth", v.date_of_birth || null, before.date_of_birth);
  }
  set("code", v.code.trim() || before.code, before.code);
  set("sex", (v.sex || null) as Sex | null, before.sex);
  set("position", nullIfEmpty(v.position), before.position);
  set("timezone", v.timezone, before.timezone);
  set("status", v.status as AthleteStatus, before.status);
  return out;
}

export function useAthleteForm(defaults: AthleteFormValues) {
  return useForm<AthleteFormValues>({ resolver: zodResolver(schema), defaultValues: defaults });
}
