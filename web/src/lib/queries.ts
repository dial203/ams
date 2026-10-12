/** Shared TanStack Query hooks over the @ams/shared client and key factory. */
import {
  queryKeys,
  type AthleteListParams,
  type Form,
  type FormListParams,
  type SubmissionListParams,
} from "@ams/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useApi } from "@/lib/api-context";
import { useOrg } from "@/lib/org";

export function useGroups(options: { includeArchived?: boolean } = {}) {
  const api = useApi();
  const { orgId } = useOrg();
  const params = { include_archived: options.includeArchived ? true : null };
  return useQuery({
    queryKey: queryKeys.groups.list(orgId, params),
    queryFn: ({ signal }) => api.groups.list(orgId, params, { signal }),
    staleTime: 60_000,
  });
}

export function useAthletes(params: AthleteListParams, options: { enabled?: boolean } = {}) {
  const api = useApi();
  const { orgId } = useOrg();
  return useQuery({
    queryKey: queryKeys.athletes.list(orgId, params),
    queryFn: ({ signal }) => api.athletes.list(orgId, params, { signal }),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function useAthlete(athleteId: string | null | undefined) {
  const api = useApi();
  const { orgId } = useOrg();
  return useQuery({
    queryKey: queryKeys.athletes.detail(orgId, athleteId ?? ""),
    queryFn: ({ signal }) => api.athletes.get(orgId, athleteId!, { signal }),
    enabled: !!athleteId,
  });
}

export function useForms(params: FormListParams = {}) {
  const api = useApi();
  const { orgId } = useOrg();
  return useQuery({
    queryKey: queryKeys.forms.list(orgId, params),
    queryFn: ({ signal }) => api.forms.list(orgId, params, { signal }),
    staleTime: 60_000,
  });
}

/** Forms with a published version, i.e. ones that can take submissions. */
export function publishedForms(forms: readonly Form[] | undefined): Form[] {
  return (forms ?? []).filter((f) => f.current_version !== null && !f.archived);
}

export function useForm(formId: string | null | undefined) {
  const api = useApi();
  const { orgId } = useOrg();
  return useQuery({
    queryKey: queryKeys.forms.detail(orgId, formId ?? ""),
    queryFn: ({ signal }) => api.forms.get(orgId, formId!, { signal }),
    enabled: !!formId,
  });
}

export function useFormVersions(formId: string | null | undefined) {
  const api = useApi();
  const { orgId } = useOrg();
  return useQuery({
    queryKey: queryKeys.forms.versions(orgId, formId ?? ""),
    queryFn: ({ signal }) => api.forms.versions(orgId, formId!, { signal }),
    enabled: !!formId,
    staleTime: 5 * 60_000,
  });
}

export function useSubmissions(params: SubmissionListParams, options: { enabled?: boolean } = {}) {
  const api = useApi();
  const { orgId } = useOrg();
  return useQuery({
    queryKey: queryKeys.submissions.list(orgId, params),
    queryFn: ({ signal }) => api.submissions.list(orgId, params, { signal }),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function useMetrics() {
  const api = useApi();
  const { orgId } = useOrg();
  return useQuery({
    queryKey: queryKeys.metrics.list(orgId),
    queryFn: ({ signal }) => api.metrics.list(orgId, { signal }),
    staleTime: 60_000,
  });
}

export function useSeriesSources() {
  const api = useApi();
  const { orgId } = useOrg();
  return useQuery({
    queryKey: queryKeys.metrics.seriesSources(orgId),
    queryFn: ({ signal }) => api.metrics.seriesSources(orgId, { signal }),
    staleTime: 5 * 60_000,
  });
}

export function useMembers(options: { enabled?: boolean } = {}) {
  const api = useApi();
  const { orgId } = useOrg();
  return useQuery({
    queryKey: queryKeys.members.list(orgId),
    queryFn: ({ signal }) => api.members.list(orgId, { signal }),
    staleTime: 60_000,
    enabled: options.enabled ?? true,
  });
}

export function useWearableProviders(options: { enabled?: boolean } = {}) {
  const api = useApi();
  const { orgId } = useOrg();
  return useQuery({
    queryKey: queryKeys.wearables.providers(orgId),
    queryFn: ({ signal }) => api.wearables.providers(orgId, { signal }),
    staleTime: 5 * 60_000,
    enabled: options.enabled ?? true,
  });
}
