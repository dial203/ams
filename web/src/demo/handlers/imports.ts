/** CSV imports: preview, commit (and dry run), history and rollback. XLSX is refused. */
import { inputFields, type Athlete, type ImportBatch, type InputField, type UUID } from "@ams/shared";
import { parseCsv, sniffDelimiter } from "../csv";
import { fail, invalidBody, json, noContent, replay } from "../http";
import { isoInstant, localNoon, matchKey, normName, parseValue, parseWhen, ParseError, suggestMapping, toTable } from "../importing";
import { route, type Ctx, type RouteDef } from "../router";
import { newId, nowIso, type DemoStore } from "../store";
import { createSubmission, DuplicateSubmission, InvalidSubmission } from "./submissions";

const ORG = "/orgs/:org";
const MAX_BYTES = 20 * 1024 * 1024;
export const XLSX_MESSAGE = "XLSX import is not available in the demo. Save the sheet as CSV and upload that.";

function writableForm(store: DemoStore, formId: UUID) {
  const form = store.form(formId);
  if (store.isAthlete || !store.canWriteFormSomewhere(form)) throw fail(403, "write access to the form required");
  return form;
}

async function preview({ store, params, req }: Ctx) {
  const form = writableForm(store, params.id!);
  if (!form.current_version) throw fail(409, "form has no published version");
  const file = req.formData?.get("file");
  if (!file || typeof file === "string") {
    throw invalidBody("file", "Field required", "missing");
  }
  const name = (file as File).name || "upload.csv";
  const lower = name.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) throw fail(400, XLSX_MESSAGE);
  if (!/\.(csv|txt|tsv)$/.test(lower)) throw fail(400, "upload a .csv or .xlsx file");
  if (file.size > MAX_BYTES) throw fail(400, "file too large (max 20 MB)");
  const text = await file.text();
  if (!text.trim()) throw fail(400, "file is empty");
  const table = toTable(parseCsv(text, sniffDelimiter(text)));
  if (table.columns.length === 0) throw fail(400, "file is empty");
  const id = newId();
  store.uploads.set(id, { id, formId: form.id, filename: name.split(/[\\/]/).pop()!.slice(0, 255), ...table });
  const suggestion = suggestMapping(table, form.current_version.schema);
  return json({
    upload_id: id,
    columns: table.columns,
    row_count: table.rows.length,
    sample_rows: table.rows.slice(0, 10),
    suggested_mapping: suggestion.mapping,
    suggested_athlete_column: suggestion.athleteColumn,
    suggested_date_column: suggestion.dateColumn,
  });
}

function athleteIndex(store: DemoStore, mode: string): Map<string, Athlete[]> {
  const index = new Map<string, Athlete[]>();
  const add = (key: string, a: Athlete) => {
    if (!key) return;
    const bucket = index.get(key) ?? [];
    if (!bucket.includes(a)) bucket.push(a);
    index.set(key, bucket);
  };
  for (const a of store.athleteList()) {
    if (mode === "code") add(a.code.trim().toLowerCase(), a);
    else if (mode === "external_id") {
      const ext = a.attributes?.external_id;
      if (ext !== undefined && ext !== null && ext !== "") add(String(ext).trim().toLowerCase(), a);
    } else if (a.masked) continue; // names and emails are hidden from this login: never match on them
    else if (mode === "email") {
      if (a.email) add(a.email.trim().toLowerCase(), a);
    } else if (mode === "name") {
      const first = a.first_name ?? "";
      const last = a.last_name ?? "";
      const names = [`${first} ${last}`, `${last} ${first}`, `${last}, ${first}`];
      if (a.preferred_name) names.push(`${a.preferred_name} ${last}`, `${last}, ${a.preferred_name}`);
      for (const n of names) add(normName(n), a);
    }
  }
  return index;
}

function commit({ store, params, body: getBody }: Ctx) {
  const form = writableForm(store, params.id!);
  const version = form.current_version;
  if (!version) throw fail(409, "form has no published version");
  const body = getBody();
  const upload = store.uploads.get(String(body.upload_id));
  if (!upload || upload.formId !== form.id) throw fail(404, "upload not found or expired; preview again");
  const mapping = (body.mapping ?? {}) as Record<string, string>;
  const athleteColumn = String(body.athlete_column ?? "");
  const athleteMatch = String(body.athlete_match ?? "code");
  const dateColumn = typeof body.date_column === "string" && body.date_column ? body.date_column : null;
  const dateFormat = typeof body.date_format === "string" && body.date_format ? body.date_format : null;
  const defaultDate = typeof body.default_date === "string" && body.default_date ? body.default_date : null;
  const dryRun = body.dry_run === true;
  const fields = new Map<string, InputField>(inputFields(version.schema).map((f) => [f.key, f]));
  for (const [col, key] of Object.entries(mapping)) {
    if (!upload.columns.includes(col)) throw fail(400, `column '${col}' is not in the file`);
    if (!fields.has(key)) throw fail(400, `'${key}' is not an input field of the form`);
  }
  if (new Set(Object.values(mapping)).size !== Object.keys(mapping).length) throw fail(400, "two columns map to the same field");
  if (!upload.columns.includes(athleteColumn)) throw fail(400, `column '${athleteColumn}' is not in the file`);
  if (dateColumn !== null && !upload.columns.includes(dateColumn)) throw fail(400, `column '${dateColumn}' is not in the file`);
  if (dateColumn === null && defaultDate === null) throw fail(400, "give date_column or default_date");

  const index = athleteIndex(store, athleteMatch);
  const batch: ImportBatch = {
    id: newId(),
    form_id: form.id,
    filename: upload.filename,
    created_by: store.userId,
    created_at: nowIso(),
    row_count: upload.rows.length,
    created_count: 0,
    skipped_count: 0,
    errors: [],
    dry_run: dryRun,
  };
  const pending = new Set<string>();
  let created = 0;
  upload.rows.forEach((row, i) => {
    const n = i + 1;
    const keyText = row[athleteColumn] ?? "";
    if (!keyText.trim()) {
      batch.errors.push({ row: n, message: `${athleteColumn}: empty athlete identifier` });
      return;
    }
    const matches = index.get(matchKey(keyText, athleteMatch)) ?? [];
    if (matches.length === 0) {
      batch.errors.push({ row: n, message: `${athleteColumn}: no athlete matches '${keyText}'` });
      return;
    }
    if (matches.length > 1) {
      batch.errors.push({ row: n, message: `${athleteColumn}: '${keyText}' matches several athletes` });
      return;
    }
    const athlete = matches[0]!;
    if (!store.canWriteFormData(form, athlete.id)) {
      batch.errors.push({ row: n, message: `not allowed to write this form for athlete ${athlete.code}` });
      return;
    }
    const tz = (typeof body.timezone === "string" && body.timezone) || athlete.timezone || store.timezone;
    let observedAt: Date | null;
    let day: string;
    const values: Record<string, unknown> = {};
    try {
      if (dateColumn !== null) ({ observedAt, localDate: day } = parseWhen(row[dateColumn] ?? "", dateFormat, tz));
      else [observedAt, day] = [null, defaultDate!];
      for (const [col, key] of Object.entries(mapping)) {
        let parsed: unknown;
        try {
          parsed = parseValue(fields.get(key)!, row[col] ?? "", tz);
        } catch (e) {
          throw new ParseError(`${col}: ${(e as Error).message}`);
        }
        if (parsed !== null) values[key] = parsed;
      }
    } catch (e) {
      if (e instanceof ParseError) {
        batch.errors.push({ row: n, message: e.message });
        return;
      }
      throw e;
    }
    try {
      createSubmission({
        store,
        form,
        athlete,
        values,
        source: "import",
        observedAt: isoInstant(observedAt ?? localNoon(day, athlete.timezone || store.timezone)),
        localDate: day,
        importBatchId: dryRun ? null : batch.id,
        pending,
        dryRun,
      });
      created += 1;
    } catch (e) {
      if (e instanceof InvalidSubmission) {
        const detail = Object.entries(e.fieldErrors)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ");
        batch.errors.push({ row: n, message: `invalid values (${detail})` });
      } else if (e instanceof DuplicateSubmission) {
        batch.errors.push({ row: n, message: `athlete ${athlete.code} already has a submission on ${day}` });
      } else throw e;
    }
  });
  batch.created_count = created;
  batch.skipped_count = upload.rows.length - created;
  replay(store.imports).unshift(batch);
  return json(batch, 201);
}

export const importRoutes: RouteDef[] = [
  route("POST", `${ORG}/forms/:id/imports/preview`, preview),
  route("POST", `${ORG}/forms/:id/imports`, commit),
  route("GET", `${ORG}/imports`, ({ store, req }) => {
    const formId = req.query.get("form_id");
    const forms = new Set(store.formList().map((f) => f.id));
    return json(replay(store.imports).filter((b) => (!formId || b.form_id === formId) && forms.has(b.form_id)));
  }),
  route("DELETE", `${ORG}/imports/:id`, ({ store, params }) => {
    store.requireAdmin();
    const list = replay(store.imports);
    const i = list.findIndex((b) => b.id === params.id);
    if (i < 0) throw fail(404, "import batch not found");
    list.splice(i, 1);
    store.submissions = store.submissionList().filter((s) => s.import_batch_id !== params.id);
    return noContent();
  }),
];
