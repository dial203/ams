import { inputFields, type AthleteMatch, type FormSchema, type ImportCommit, type ImportPreview } from "@ams/shared";
import { ArrowRight, CalendarDays, CircleAlert, UserRound } from "lucide-react";
import {
  ATHLETE_MATCH_LABELS,
  DATE_FORMAT_PRESETS,
  buildCommit,
  guessMatch,
  hasIssues,
  mappingIssues,
  type MappingState,
} from "@/components/data/import-logic";
import { FormRow } from "@/components/FormRow";
import { TimezoneSelect } from "@/components/TimezoneSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** Step 3 of the import wizard: column → field mapping, athlete matching and dates. */
export function MappingStep({
  preview,
  schema,
  state,
  onStateChange,
  onSubmit,
  onBack,
  busy = false,
  athleteTerm = "Athlete",
}: {
  preview: ImportPreview;
  schema: FormSchema;
  state: MappingState;
  onStateChange(state: MappingState): void;
  onSubmit(commit: Omit<ImportCommit, "upload_id" | "dry_run">): void;
  onBack(): void;
  busy?: boolean;
  athleteTerm?: string;
}) {
  const fields = inputFields(schema);
  const issues = mappingIssues(state);
  const set = (patch: Partial<MappingState>) => onStateChange({ ...state, ...patch });
  const samples = (col: string) =>
    preview.sample_rows
      .map((r) => r[col] ?? "")
      .filter((v) => v !== "")
      .slice(0, 3);
  const mappedCount = Object.entries(state.mapping).filter(([c, k]) => k && c !== state.athleteColumn && c !== state.dateColumn).length;

  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!hasIssues(issues)) onSubmit(buildCommit(state));
      }}
    >
      <div className="grid gap-4 rounded-lg border p-4 lg:grid-cols-2">
        <div className="grid content-start gap-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <UserRound aria-hidden className="size-4 text-muted-foreground" /> Who is each row about?
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormRow label={`${athleteTerm} column`} htmlFor="map-athlete" error={issues.athleteColumn}>
              <NativeSelect
                id="map-athlete"
                value={state.athleteColumn}
                onChange={(e) => set({ athleteColumn: e.target.value, athleteMatch: e.target.value ? guessMatch(e.target.value, preview) : state.athleteMatch })}
                aria-invalid={!!issues.athleteColumn}
              >
                <option value="">Choose a column…</option>
                {preview.columns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
            </FormRow>
            <FormRow label="Match by" htmlFor="map-match">
              <NativeSelect id="map-match" value={state.athleteMatch} onChange={(e) => set({ athleteMatch: e.target.value as AthleteMatch })}>
                {(Object.keys(ATHLETE_MATCH_LABELS) as AthleteMatch[]).map((m) => (
                  <option key={m} value={m}>
                    {ATHLETE_MATCH_LABELS[m]}
                  </option>
                ))}
              </NativeSelect>
            </FormRow>
          </div>
          {state.athleteColumn && (
            <p className="text-xs text-muted-foreground">
              e.g. {samples(state.athleteColumn).map((s) => `“${s}”`).join(", ") || "(empty)"} — rows that match nobody are skipped and reported.
            </p>
          )}
        </div>
        <div className="grid content-start gap-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <CalendarDays aria-hidden className="size-4 text-muted-foreground" /> Which day?
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormRow label="Date column" htmlFor="map-date" error={issues.date}>
              <NativeSelect id="map-date" value={state.dateColumn} onChange={(e) => set({ dateColumn: e.target.value })}>
                <option value="">None — use the default date</option>
                {preview.columns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
            </FormRow>
            {state.dateColumn ? (
              <FormRow label="Date format" htmlFor="map-format" hint={`e.g. ${samples(state.dateColumn)[0] ?? "–"}`}>
                <Input id="map-format" list="date-formats" value={state.dateFormat} placeholder="Automatic (ISO 8601)" onChange={(e) => set({ dateFormat: e.target.value })} className="font-mono text-xs" />
                <datalist id="date-formats">
                  {DATE_FORMAT_PRESETS.filter((p) => p.value).map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </datalist>
              </FormRow>
            ) : (
              <FormRow label="Default date" htmlFor="map-default" error={issues.date && !state.defaultDate ? "Required" : undefined}>
                <Input id="map-default" type="date" value={state.defaultDate} onChange={(e) => set({ defaultDate: e.target.value })} />
              </FormRow>
            )}
            {state.dateColumn && (
              <FormRow label="Default date" htmlFor="map-default" hint="For rows with an empty date">
                <Input id="map-default" type="date" value={state.defaultDate} onChange={(e) => set({ defaultDate: e.target.value })} />
              </FormRow>
            )}
            <FormRow label="Time zone" htmlFor="map-tz" hint="For date-times without an offset">
              <TimezoneSelect id="map-tz" value={state.timezone} onValueChange={(v) => set({ timezone: v ?? "" })} />
            </FormRow>
          </div>
        </div>
      </div>

      <div className="grid gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">Columns → fields</h3>
          <span className={cn("text-xs", issues.fields ? "text-destructive" : "text-muted-foreground")}>
            {issues.fields ?? `${mappedCount} of ${preview.columns.length} columns mapped · ${preview.row_count} rows`}
          </span>
        </div>
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>File column</TableHead>
                <TableHead>Sample values</TableHead>
                <TableHead className="w-8" />
                <TableHead className="w-72">Form field</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.columns.map((col) => {
                const role = col === state.athleteColumn ? athleteTerm : col === state.dateColumn ? "Date" : null;
                const dup = issues.duplicates.includes(col);
                return (
                  <TableRow key={col} className={cn(role && "bg-muted/40")}>
                    <TableCell className="font-mono text-xs">{col}</TableCell>
                    <TableCell className="max-w-72 truncate text-xs text-muted-foreground">{samples(col).join(" · ") || "(empty)"}</TableCell>
                    <TableCell>
                      <ArrowRight aria-hidden className="size-3.5 text-muted-foreground" />
                    </TableCell>
                    <TableCell>
                      {role ? (
                        <Badge variant="secondary">Used as {role.toLowerCase()} column</Badge>
                      ) : (
                        <NativeSelect
                          size="sm"
                          aria-label={`Field for column ${col}`}
                          value={state.mapping[col] ?? ""}
                          onChange={(e) => set({ mapping: { ...state.mapping, [col]: e.target.value } })}
                          aria-invalid={dup || undefined}
                          className={cn(!state.mapping[col] && "text-muted-foreground")}
                        >
                          <option value="">— Ignore —</option>
                          {fields.map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.label} ({f.key})
                            </option>
                          ))}
                        </NativeSelect>
                      )}
                      {dup && (
                        <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
                          <CircleAlert aria-hidden className="size-3" /> Also mapped from another column
                        </p>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex justify-between gap-2">
        <Button variant="outline" onClick={onBack} type="button">
          Back
        </Button>
        <Button type="submit" disabled={hasIssues(issues) || busy}>
          Check import (dry run)
        </Button>
      </div>
    </form>
  );
}
