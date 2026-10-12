import { apiErrorFromBody } from "./errors";
import type {
  AcceptInviteRequest,
  Athlete,
  AthleteCreate,
  AthleteInviteRequest,
  AthleteListParams,
  AthleteUpdate,
  AuditEntry,
  AuditListParams,
  BulkSubmissionCreate,
  BulkSubmissionResult,
  ConnectRequest,
  ConnectResponse,
  DateRangeParams,
  DueForm,
  Form,
  FormCreate,
  FormListParams,
  FormSchedule,
  FormScheduleCreate,
  FormScheduleUpdate,
  FormSchema,
  FormTemplate,
  FormTemplateInstall,
  FormUpdate,
  FormVersion,
  Group,
  GroupAthletesAdd,
  GroupCreate,
  GroupListParams,
  GroupRemoveAthleteParams,
  GroupUpdate,
  ImportBatch,
  ImportCommit,
  ImportListParams,
  ImportPreview,
  Invitation,
  InvitationCreate,
  InviteDetails,
  LoginRequest,
  LoginResponse,
  Me,
  MeUpdate,
  Member,
  MemberUpdate,
  MetricCreate,
  MetricDefinition,
  MetricSeries,
  MetricSeriesParams,
  MetricUpdate,
  Organization,
  OrganizationUpdate,
  Page,
  PushTokenRegister,
  ReadinessBoard,
  ReadinessParams,
  SdkTokenResponse,
  SelfFormsParams,
  SelfSubmissionCreate,
  SelfSubmissionListParams,
  SeriesSource,
  StaffAssignment,
  StaffAssignmentCreate,
  Submission,
  SubmissionCreate,
  SubmissionExportParams,
  SubmissionListParams,
  SubmissionUpdate,
  TokenPair,
  User,
  UUID,
  ValidateSchemaResponse,
  WearableDailyParams,
  WearableDailyPoint,
  WearableProvider,
  WearableRefreshParams,
  WearableRefreshResponse,
  WearableStatus,
} from "./types";

export interface ApiClientOptions {
  /** API root including the version prefix, e.g. `https://ams.example.org/api/v1`. */
  baseUrl: string;
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Current access token, or null when logged out. */
  getAccessToken(): string | null | Promise<string | null>;
  /**
   * Called on a 401 to obtain a new access token (typically `client.auth.refresh` with the
   * stored refresh token, then storing the new pair). Resolve `true` when a new access
   * token is available and `false` when the server rejected the refresh token (the session
   * is over). Throw on a transient failure such as no network: the request then rejects
   * with that error and `onAuthFailure` is not called, so an offline user stays signed in.
   * Concurrent 401s share one call.
   */
  refresh?(): Promise<boolean>;
  /** Called when a 401 cannot be recovered (no refresh, refresh rejected, or still 401 after retry). */
  onAuthFailure?(): void;
  /** Extra headers sent with every request (e.g. an app version). */
  headers?: Record<string, string>;
}

/** Per-call options. */
export interface RequestOptions {
  signal?: AbortSignal | null;
}

/** A file to upload: a `Blob`/`File` on the web, or React Native's `{uri, name, type}`. */
export type UploadFile = Blob | { uri: string; name: string; type: string };

export type QueryParams = Record<string, unknown>;

export interface RequestConfig extends RequestOptions {
  query?: QueryParams | undefined;
  /** JSON body. */
  body?: unknown;
  /** Multipart body (takes precedence over `body`). */
  formData?: FormData;
  /** Send the bearer token and recover from 401 (default true). */
  auth?: boolean;
  /** Try `refresh()` and retry once on 401 (default: same as `auth`). */
  retryOnUnauthorized?: boolean;
  /** `"json"` (default) or `"text"`. Empty bodies yield `undefined`. */
  responseType?: "json" | "text";
}

/**
 * Serialises query parameters: `null`/`undefined` are skipped, arrays are comma-joined
 * (`metrics=a,b`; empty arrays skipped), booleans become `true`/`false`.
 */
export function buildQuery(params: QueryParams | undefined): string {
  if (!params) return "";
  const parts: string[] = [];
  for (const key of Object.keys(params)) {
    const v = params[key];
    if (v === undefined || v === null) continue;
    let encoded: string;
    if (Array.isArray(v)) {
      const items = v.filter((x) => x !== undefined && x !== null);
      if (items.length === 0) continue;
      encoded = items.map((x) => encodeURIComponent(String(x))).join(",");
    } else {
      encoded = encodeURIComponent(String(v));
    }
    parts.push(`${encodeURIComponent(key)}=${encoded}`);
  }
  return parts.join("&");
}

/** Template tag that URL-encodes every interpolated path segment. */
function path(strings: TemplateStringsArray, ...values: (string | number)[]): string {
  let out = strings[0]!;
  values.forEach((v, i) => {
    out += encodeURIComponent(String(v)) + strings[i + 1]!;
  });
  return out;
}

function isNativeFile(file: UploadFile): file is { uri: string; name: string; type: string } {
  return typeof file === "object" && file !== null && "uri" in file && typeof (file as { uri: unknown }).uri === "string";
}

function defaultFilename(type: string): string {
  return /sheet|excel/i.test(type) ? "upload.xlsx" : "upload.csv";
}

/** Builds the multipart body for an import preview (`file` part). */
export function uploadFormData(file: UploadFile, filename?: string): FormData {
  const fd = new FormData();
  if (isNativeFile(file)) {
    // React Native's FormData accepts {uri, name, type}.
    fd.append("file", (filename ? { ...file, name: filename } : file) as unknown as Blob);
  } else {
    const ownName = (file as { name?: unknown }).name;
    const name = filename ?? (typeof ownName === "string" && ownName !== "" ? ownName : defaultFilename(file.type));
    fd.append("file", file, name);
  }
  return fd;
}

/**
 * Creates the AMS API client. Every method maps to one endpoint of docs/API.md and
 * resolves with the parsed response (`undefined` for 204), or rejects with `ApiError`.
 */
export function createApiClient(options: ApiClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const doFetch = (input: string, init: RequestInit): Promise<Response> =>
    options.fetch ? options.fetch(input, init) : fetch(input, init);

  let refreshing: Promise<boolean> | null = null;

  /**
   * Runs `options.refresh` once for all concurrent callers. Resolves `false` (after
   * `onAuthFailure`) when the refresh was rejected; rejects with the refresh's own error when
   * it threw, leaving the session in place.
   */
  function refreshOnce(): Promise<boolean> {
    if (!options.refresh) {
      options.onAuthFailure?.();
      return Promise.resolve(false);
    }
    if (!refreshing) {
      const refresh = options.refresh;
      refreshing = (async () => {
        const ok = (await refresh()) === true;
        if (!ok) options.onAuthFailure?.();
        return ok;
      })();
      const done = () => {
        refreshing = null;
      };
      refreshing.then(done, done);
    }
    return refreshing;
  }

  function url(p: string, query?: QueryParams): string {
    const qs = buildQuery(query);
    return `${baseUrl}${p}${qs ? `?${qs}` : ""}`;
  }

  async function parseBody(res: Response, type: "json" | "text"): Promise<unknown> {
    if (res.status === 204 || res.status === 205) return undefined;
    const text = await res.text();
    if (type === "text") return text;
    if (text === "") return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  async function request<T>(method: string, p: string, config: RequestConfig = {}): Promise<T> {
    const auth = config.auth !== false;
    const retry = config.retryOnUnauthorized ?? auth;
    const responseType = config.responseType ?? "json";
    const target = url(p, config.query);

    const send = (token: string | null): Promise<Response> => {
      const headers: Record<string, string> = {
        Accept: responseType === "json" ? "application/json" : "text/csv, text/plain, */*",
        ...options.headers,
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      let body: BodyInit | undefined;
      if (config.formData) {
        body = config.formData; // fetch sets the multipart boundary
      } else if (config.body !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(config.body);
      }
      const init: RequestInit = { method, headers };
      if (body !== undefined) init.body = body;
      if (config.signal) init.signal = config.signal;
      return doFetch(target, init);
    };

    let token = auth ? await options.getAccessToken() : null;
    let res = await send(token);

    if (res.status === 401 && auth && retry) {
      // If another request already refreshed while this one was in flight, just retry.
      const current = await options.getAccessToken();
      const recovered = current !== null && current !== token ? true : await refreshOnce();
      if (recovered) {
        token = await options.getAccessToken();
        res = await send(token);
        if (res.status === 401) options.onAuthFailure?.();
      }
    }

    if (!res.ok) {
      let body: unknown;
      try {
        body = await parseBody(res, "json");
      } catch {
        body = undefined;
      }
      throw apiErrorFromBody(res.status, body, res.statusText);
    }
    return (await parseBody(res, responseType)) as T;
  }

  const get = <T>(p: string, query?: QueryParams, o?: RequestOptions) =>
    request<T>("GET", p, { query, ...o });
  const post = <T>(p: string, body?: unknown, o?: RequestOptions) =>
    request<T>("POST", p, { body, ...o });
  const patch = <T>(p: string, body: unknown, o?: RequestOptions) => request<T>("PATCH", p, { body, ...o });
  const del = (p: string, query?: QueryParams, o?: RequestOptions) =>
    request<undefined>("DELETE", p, { query, ...o });

  const org = (orgId: UUID) => path`/orgs/${orgId}`;

  return {
    /** Low-level escape hatch with the same auth handling. */
    request,
    /** Absolute URL for a path (`/orgs/...`) and query. */
    url,

    /** `GET /health` (no auth). */
    health: (o?: RequestOptions) => request<unknown>("GET", "/health", { auth: false, ...o }),

    auth: {
      /** `POST /auth/login`. 401 on bad credentials (no refresh attempted). */
      login: (body: LoginRequest, o?: RequestOptions) =>
        request<LoginResponse>("POST", "/auth/login", { body, auth: false, ...o }),
      /** `POST /auth/refresh`. Rotates: the old refresh token is revoked. */
      refresh: (refreshToken: string, o?: RequestOptions) =>
        request<TokenPair>("POST", "/auth/refresh", { body: { refresh_token: refreshToken }, auth: false, ...o }),
      /** `POST /auth/logout`. Sends the bearer token if any; never triggers a refresh. */
      logout: (refreshToken: string, o?: RequestOptions) =>
        request<undefined>("POST", "/auth/logout", {
          body: { refresh_token: refreshToken },
          retryOnUnauthorized: false,
          ...o,
        }),
      /** `GET /auth/invite/{token}` (public). */
      getInvite: (token: string, o?: RequestOptions) =>
        request<InviteDetails>("GET", path`/auth/invite/${token}`, { auth: false, ...o }),
      /** `POST /auth/accept-invite` (public). */
      acceptInvite: (body: AcceptInviteRequest, o?: RequestOptions) =>
        request<LoginResponse>("POST", "/auth/accept-invite", { body, auth: false, ...o }),
    },

    me: {
      /** `GET /me` */
      get: (o?: RequestOptions) => get<Me>("/me", undefined, o),
      /** `PATCH /me` */
      update: (body: MeUpdate, o?: RequestOptions) => patch<User>("/me", body, o),
      /** `POST /me/push-tokens` (upsert) */
      registerPushToken: (body: PushTokenRegister, o?: RequestOptions) => post<undefined>("/me/push-tokens", body, o),
      /** `DELETE /me/push-tokens/{token}` */
      deletePushToken: (token: string, o?: RequestOptions) => del(path`/me/push-tokens/${token}`, undefined, o),
    },

    orgs: {
      /** `GET /orgs/{org_id}` */
      get: (orgId: UUID, o?: RequestOptions) => get<Organization>(org(orgId), undefined, o),
      /** `PATCH /orgs/{org_id}` (admin) */
      update: (orgId: UUID, body: OrganizationUpdate, o?: RequestOptions) =>
        patch<Organization>(org(orgId), body, o),
    },

    members: {
      /** `GET /orgs/{org_id}/members` */
      list: (orgId: UUID, o?: RequestOptions) => get<Member[]>(`${org(orgId)}/members`, undefined, o),
      /** `PATCH /orgs/{org_id}/members/{user_id}` */
      update: (orgId: UUID, userId: UUID, body: MemberUpdate, o?: RequestOptions) =>
        patch<Member>(`${org(orgId)}${path`/members/${userId}`}`, body, o),
      /** `DELETE /orgs/{org_id}/members/{user_id}` */
      delete: (orgId: UUID, userId: UUID, o?: RequestOptions) =>
        del(`${org(orgId)}${path`/members/${userId}`}`, undefined, o),
    },

    invitations: {
      /** `GET /orgs/{org_id}/invitations` (pending) */
      list: (orgId: UUID, o?: RequestOptions) => get<Invitation[]>(`${org(orgId)}/invitations`, undefined, o),
      /** `POST /orgs/{org_id}/invitations` */
      create: (orgId: UUID, body: InvitationCreate, o?: RequestOptions) =>
        post<Invitation>(`${org(orgId)}/invitations`, body, o),
      /** `DELETE /orgs/{org_id}/invitations/{id}` */
      delete: (orgId: UUID, invitationId: UUID, o?: RequestOptions) =>
        del(`${org(orgId)}${path`/invitations/${invitationId}`}`, undefined, o),
    },

    groups: {
      /** `GET /orgs/{org_id}/groups?include_archived` */
      list: (orgId: UUID, params?: GroupListParams, o?: RequestOptions) =>
        get<Group[]>(`${org(orgId)}/groups`, params, o),
      /** `POST /orgs/{org_id}/groups` */
      create: (orgId: UUID, body: GroupCreate, o?: RequestOptions) => post<Group>(`${org(orgId)}/groups`, body, o),
      /** `GET /orgs/{org_id}/groups/{group_id}` */
      get: (orgId: UUID, groupId: UUID, o?: RequestOptions) =>
        get<Group>(`${org(orgId)}${path`/groups/${groupId}`}`, undefined, o),
      /** `PATCH /orgs/{org_id}/groups/{group_id}` */
      update: (orgId: UUID, groupId: UUID, body: GroupUpdate, o?: RequestOptions) =>
        patch<Group>(`${org(orgId)}${path`/groups/${groupId}`}`, body, o),
      /** `DELETE /orgs/{org_id}/groups/{group_id}` (archives the group) */
      delete: (orgId: UUID, groupId: UUID, o?: RequestOptions) =>
        del(`${org(orgId)}${path`/groups/${groupId}`}`, undefined, o),
      /** `POST /orgs/{org_id}/groups/{group_id}/athletes` */
      addAthletes: (orgId: UUID, groupId: UUID, body: GroupAthletesAdd, o?: RequestOptions) =>
        post<Group>(`${org(orgId)}${path`/groups/${groupId}/athletes`}`, body, o),
      /** `DELETE /orgs/{org_id}/groups/{group_id}/athletes/{athlete_id}?left_on` (keeps history) */
      removeAthlete: (
        orgId: UUID,
        groupId: UUID,
        athleteId: UUID,
        params?: GroupRemoveAthleteParams,
        o?: RequestOptions,
      ) => del(`${org(orgId)}${path`/groups/${groupId}/athletes/${athleteId}`}`, params, o),
    },

    staffAssignments: {
      /** `GET /orgs/{org_id}/groups/{group_id}/staff` */
      list: (orgId: UUID, groupId: UUID, o?: RequestOptions) =>
        get<StaffAssignment[]>(`${org(orgId)}${path`/groups/${groupId}/staff`}`, undefined, o),
      /** `POST /orgs/{org_id}/groups/{group_id}/staff` */
      create: (orgId: UUID, groupId: UUID, body: StaffAssignmentCreate, o?: RequestOptions) =>
        post<StaffAssignment>(`${org(orgId)}${path`/groups/${groupId}/staff`}`, body, o),
      /** `DELETE /orgs/{org_id}/staff-assignments/{id}` */
      delete: (orgId: UUID, assignmentId: UUID, o?: RequestOptions) =>
        del(`${org(orgId)}${path`/staff-assignments/${assignmentId}`}`, undefined, o),
    },

    athletes: {
      /** `GET /orgs/{org_id}/athletes?group_id&q&status&limit&offset` */
      list: (orgId: UUID, params?: AthleteListParams, o?: RequestOptions) =>
        get<Page<Athlete>>(`${org(orgId)}/athletes`, params, o),
      /** `POST /orgs/{org_id}/athletes` */
      create: (orgId: UUID, body: AthleteCreate, o?: RequestOptions) =>
        post<Athlete>(`${org(orgId)}/athletes`, body, o),
      /** `GET /orgs/{org_id}/athletes/{athlete_id}` */
      get: (orgId: UUID, athleteId: UUID, o?: RequestOptions) =>
        get<Athlete>(`${org(orgId)}${path`/athletes/${athleteId}`}`, undefined, o),
      /** `PATCH /orgs/{org_id}/athletes/{athlete_id}` */
      update: (orgId: UUID, athleteId: UUID, body: AthleteUpdate, o?: RequestOptions) =>
        patch<Athlete>(`${org(orgId)}${path`/athletes/${athleteId}`}`, body, o),
      /** `DELETE /orgs/{org_id}/athletes/{athlete_id}` (sets status = archived) */
      delete: (orgId: UUID, athleteId: UUID, o?: RequestOptions) =>
        del(`${org(orgId)}${path`/athletes/${athleteId}`}`, undefined, o),
      /** `POST /orgs/{org_id}/athletes/{athlete_id}/invite` */
      invite: (orgId: UUID, athleteId: UUID, body: AthleteInviteRequest = {}, o?: RequestOptions) =>
        post<Invitation>(`${org(orgId)}${path`/athletes/${athleteId}/invite`}`, body, o),
    },

    forms: {
      /** `GET /orgs/{org_id}/forms?kind&include_archived` */
      list: (orgId: UUID, params?: FormListParams, o?: RequestOptions) =>
        get<Form[]>(`${org(orgId)}/forms`, params, o),
      /** `POST /orgs/{org_id}/forms` */
      create: (orgId: UUID, body: FormCreate, o?: RequestOptions) => post<Form>(`${org(orgId)}/forms`, body, o),
      /** `GET /orgs/{org_id}/forms/{form_id}` */
      get: (orgId: UUID, formId: UUID, o?: RequestOptions) =>
        get<Form>(`${org(orgId)}${path`/forms/${formId}`}`, undefined, o),
      /** `PATCH /orgs/{org_id}/forms/{form_id}` (saving draft_schema does not validate) */
      update: (orgId: UUID, formId: UUID, body: FormUpdate, o?: RequestOptions) =>
        patch<Form>(`${org(orgId)}${path`/forms/${formId}`}`, body, o),
      /** `POST /orgs/{org_id}/forms/{form_id}/publish`. 422 -> `ApiError.schemaErrors`. */
      publish: (orgId: UUID, formId: UUID, o?: RequestOptions) =>
        post<FormVersion>(`${org(orgId)}${path`/forms/${formId}/publish`}`, undefined, o),
      /** `GET /orgs/{org_id}/forms/{form_id}/versions` (newest first) */
      versions: (orgId: UUID, formId: UUID, o?: RequestOptions) =>
        get<FormVersion[]>(`${org(orgId)}${path`/forms/${formId}/versions`}`, undefined, o),
      /** `POST /orgs/{org_id}/forms/validate-schema` */
      validateSchema: (orgId: UUID, schema: FormSchema, o?: RequestOptions) =>
        post<ValidateSchemaResponse>(`${org(orgId)}/forms/validate-schema`, { schema }, o),
    },

    formTemplates: {
      /** `GET /orgs/{org_id}/form-templates` */
      list: (orgId: UUID, o?: RequestOptions) => get<FormTemplate[]>(`${org(orgId)}/form-templates`, undefined, o),
      /** `POST /orgs/{org_id}/form-templates/{key}/install` -> published v1 */
      install: (orgId: UUID, key: string, body: FormTemplateInstall = {}, o?: RequestOptions) =>
        post<Form>(`${org(orgId)}${path`/form-templates/${key}/install`}`, body, o),
    },

    schedules: {
      /** `GET /orgs/{org_id}/forms/{form_id}/schedules` */
      list: (orgId: UUID, formId: UUID, o?: RequestOptions) =>
        get<FormSchedule[]>(`${org(orgId)}${path`/forms/${formId}/schedules`}`, undefined, o),
      /** `POST /orgs/{org_id}/forms/{form_id}/schedules` */
      create: (orgId: UUID, formId: UUID, body: FormScheduleCreate, o?: RequestOptions) =>
        post<FormSchedule>(`${org(orgId)}${path`/forms/${formId}/schedules`}`, body, o),
      /** `PATCH /orgs/{org_id}/form-schedules/{schedule_id}` */
      update: (orgId: UUID, scheduleId: UUID, body: FormScheduleUpdate, o?: RequestOptions) =>
        patch<FormSchedule>(`${org(orgId)}${path`/form-schedules/${scheduleId}`}`, body, o),
      /** `DELETE /orgs/{org_id}/form-schedules/{schedule_id}` */
      delete: (orgId: UUID, scheduleId: UUID, o?: RequestOptions) =>
        del(`${org(orgId)}${path`/form-schedules/${scheduleId}`}`, undefined, o),
    },

    submissions: {
      /** `GET /orgs/{org_id}/submissions?form_id&athlete_id&group_id&start&end&source&limit&offset` */
      list: (orgId: UUID, params?: SubmissionListParams, o?: RequestOptions) =>
        get<Page<Submission>>(`${org(orgId)}/submissions`, params, o),
      /** `POST /orgs/{org_id}/submissions`. 422 -> `ApiError.fieldErrors`; 409 duplicate day. */
      create: (orgId: UUID, body: SubmissionCreate, o?: RequestOptions) =>
        post<Submission>(`${org(orgId)}/submissions`, body, o),
      /** `POST /orgs/{org_id}/submissions/bulk` */
      bulkCreate: (orgId: UUID, body: BulkSubmissionCreate, o?: RequestOptions) =>
        post<BulkSubmissionResult>(`${org(orgId)}/submissions/bulk`, body, o),
      /** `GET /orgs/{org_id}/submissions/{id}` */
      get: (orgId: UUID, submissionId: UUID, o?: RequestOptions) =>
        get<Submission>(`${org(orgId)}${path`/submissions/${submissionId}`}`, undefined, o),
      /** `PATCH /orgs/{org_id}/submissions/{id}` */
      update: (orgId: UUID, submissionId: UUID, body: SubmissionUpdate, o?: RequestOptions) =>
        patch<Submission>(`${org(orgId)}${path`/submissions/${submissionId}`}`, body, o),
      /** `DELETE /orgs/{org_id}/submissions/{id}` (soft delete) */
      delete: (orgId: UUID, submissionId: UUID, o?: RequestOptions) =>
        del(`${org(orgId)}${path`/submissions/${submissionId}`}`, undefined, o),
      /**
       * URL of `GET /orgs/{org_id}/submissions/export` (text/csv). The endpoint needs the
       * bearer token, so a plain link only works where auth is handled otherwise; use
       * `exportCsv` to download with auth.
       */
      exportUrl: (orgId: UUID, params: SubmissionExportParams) => url(`${org(orgId)}/submissions/export`, params),
      /** `GET /orgs/{org_id}/submissions/export` -> CSV text. */
      exportCsv: (orgId: UUID, params: SubmissionExportParams, o?: RequestOptions) =>
        request<string>("GET", `${org(orgId)}/submissions/export`, { query: params, responseType: "text", ...o }),
    },

    imports: {
      /** `POST /orgs/{org_id}/forms/{form_id}/imports/preview` (multipart `file`, .csv or .xlsx) */
      preview: (orgId: UUID, formId: UUID, file: UploadFile, o?: RequestOptions & { filename?: string }) =>
        request<ImportPreview>("POST", `${org(orgId)}${path`/forms/${formId}/imports/preview`}`, {
          formData: uploadFormData(file, o?.filename),
          ...(o?.signal ? { signal: o.signal } : {}),
        }),
      /** `POST /orgs/{org_id}/forms/{form_id}/imports` */
      commit: (orgId: UUID, formId: UUID, body: ImportCommit, o?: RequestOptions) =>
        post<ImportBatch>(`${org(orgId)}${path`/forms/${formId}/imports`}`, body, o),
      /** `GET /orgs/{org_id}/imports?form_id` */
      list: (orgId: UUID, params?: ImportListParams, o?: RequestOptions) =>
        get<ImportBatch[]>(`${org(orgId)}/imports`, params, o),
      /** `DELETE /orgs/{org_id}/imports/{batch_id}` (soft-deletes the batch's submissions) */
      delete: (orgId: UUID, batchId: UUID, o?: RequestOptions) =>
        del(`${org(orgId)}${path`/imports/${batchId}`}`, undefined, o),
    },

    /** Athlete self-service, `/orgs/{org_id}/me/*` (caller must be an athlete in the org). */
    self: {
      /** `GET /orgs/{org_id}/me/athlete` */
      athlete: (orgId: UUID, o?: RequestOptions) => get<Athlete>(`${org(orgId)}/me/athlete`, undefined, o),
      /** `GET /orgs/{org_id}/me/forms?date` (athlete-local date, default today) */
      forms: (orgId: UUID, params?: SelfFormsParams, o?: RequestOptions) =>
        get<DueForm[]>(`${org(orgId)}/me/forms`, params, o),
      /** `GET /orgs/{org_id}/me/submissions?form_id&start&end&limit&offset` */
      submissions: (orgId: UUID, params?: SelfSubmissionListParams, o?: RequestOptions) =>
        get<Page<Submission>>(`${org(orgId)}/me/submissions`, params, o),
      /** `POST /orgs/{org_id}/me/submissions` */
      submit: (orgId: UUID, body: SelfSubmissionCreate, o?: RequestOptions) =>
        post<Submission>(`${org(orgId)}/me/submissions`, body, o),
      /** `GET /orgs/{org_id}/me/metrics?start&end` */
      metrics: (orgId: UUID, params?: DateRangeParams, o?: RequestOptions) =>
        get<MetricSeries[]>(`${org(orgId)}/me/metrics`, params, o),
      /** `GET /orgs/{org_id}/me/wearables` (links to OW on first call) */
      wearables: (orgId: UUID, o?: RequestOptions) => get<WearableStatus>(`${org(orgId)}/me/wearables`, undefined, o),
      /** `GET /orgs/{org_id}/me/wearables/providers` */
      wearableProviders: (orgId: UUID, o?: RequestOptions) =>
        get<WearableProvider[]>(`${org(orgId)}/me/wearables/providers`, undefined, o),
      /** `POST /orgs/{org_id}/me/wearables/connect` */
      connectWearable: (orgId: UUID, body: ConnectRequest, o?: RequestOptions) =>
        post<ConnectResponse>(`${org(orgId)}/me/wearables/connect`, body, o),
      /** `POST /orgs/{org_id}/me/wearables/sdk-token` (503 when OW app credentials are missing) */
      wearableSdkToken: (orgId: UUID, o?: RequestOptions) =>
        post<SdkTokenResponse>(`${org(orgId)}/me/wearables/sdk-token`, undefined, o),
    },

    /** Staff wearable endpoints. */
    wearables: {
      /** `GET /orgs/{org_id}/wearables/providers` */
      providers: (orgId: UUID, o?: RequestOptions) =>
        get<WearableProvider[]>(`${org(orgId)}/wearables/providers`, undefined, o),
      /** `GET /orgs/{org_id}/athletes/{athlete_id}/wearables` */
      status: (orgId: UUID, athleteId: UUID, o?: RequestOptions) =>
        get<WearableStatus>(`${org(orgId)}${path`/athletes/${athleteId}/wearables`}`, undefined, o),
      /** `POST /orgs/{org_id}/athletes/{athlete_id}/wearables/link` (idempotent) */
      link: (orgId: UUID, athleteId: UUID, o?: RequestOptions) =>
        post<WearableStatus>(`${org(orgId)}${path`/athletes/${athleteId}/wearables/link`}`, undefined, o),
      /** `POST /orgs/{org_id}/athletes/{athlete_id}/wearables/connect` */
      connect: (orgId: UUID, athleteId: UUID, body: ConnectRequest, o?: RequestOptions) =>
        post<ConnectResponse>(`${org(orgId)}${path`/athletes/${athleteId}/wearables/connect`}`, body, o),
      /** `POST /orgs/{org_id}/athletes/{athlete_id}/wearables/refresh?days=7` */
      refresh: (orgId: UUID, athleteId: UUID, params?: WearableRefreshParams, o?: RequestOptions) =>
        request<WearableRefreshResponse>("POST", `${org(orgId)}${path`/athletes/${athleteId}/wearables/refresh`}`, {
          query: params,
          ...o,
        }),
      /** `GET /orgs/{org_id}/athletes/{athlete_id}/wearables/daily?start&end&metrics=a,b` */
      daily: (orgId: UUID, athleteId: UUID, params?: WearableDailyParams, o?: RequestOptions) =>
        get<WearableDailyPoint[]>(`${org(orgId)}${path`/athletes/${athleteId}/wearables/daily`}`, params, o),
    },

    metrics: {
      /** `GET /orgs/{org_id}/metrics` */
      list: (orgId: UUID, o?: RequestOptions) => get<MetricDefinition[]>(`${org(orgId)}/metrics`, undefined, o),
      /** `POST /orgs/{org_id}/metrics` */
      create: (orgId: UUID, body: MetricCreate, o?: RequestOptions) =>
        post<MetricDefinition>(`${org(orgId)}/metrics`, body, o),
      /** `PATCH /orgs/{org_id}/metrics/{metric_id}` */
      update: (orgId: UUID, metricId: UUID, body: MetricUpdate, o?: RequestOptions) =>
        patch<MetricDefinition>(`${org(orgId)}${path`/metrics/${metricId}`}`, body, o),
      /** `DELETE /orgs/{org_id}/metrics/{metric_id}` (built-ins cannot be deleted) */
      delete: (orgId: UUID, metricId: UUID, o?: RequestOptions) =>
        del(`${org(orgId)}${path`/metrics/${metricId}`}`, undefined, o),
      /** `GET /orgs/{org_id}/series-sources` */
      seriesSources: (orgId: UUID, o?: RequestOptions) =>
        get<SeriesSource[]>(`${org(orgId)}/series-sources`, undefined, o),
      /** `GET /orgs/{org_id}/metrics/{slug}/series?athlete_id&start&end` */
      series: (orgId: UUID, slug: string, params: MetricSeriesParams, o?: RequestOptions) =>
        get<MetricSeries>(`${org(orgId)}${path`/metrics/${slug}/series`}`, params, o),
    },

    dashboards: {
      /** `GET /orgs/{org_id}/dashboards/readiness?group_id&date` */
      readiness: (orgId: UUID, params?: ReadinessParams, o?: RequestOptions) =>
        get<ReadinessBoard>(`${org(orgId)}/dashboards/readiness`, params, o),
    },

    audit: {
      /** `GET /orgs/{org_id}/audit?entity_type&entity_id&limit&offset` */
      list: (orgId: UUID, params?: AuditListParams, o?: RequestOptions) =>
        get<Page<AuditEntry>>(`${org(orgId)}/audit`, params, o),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
