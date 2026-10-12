/**
 * Three-pane form builder: outline (drag to reorder), editor for the selected field or
 * section, and a live preview with test values. Controlled: the page owns the draft schema
 * and saving/publishing.
 */
import {
  findReferences,
  removeField,
  removeSection,
  renameField,
  slugifyKey,
  updateField,
  updateSection,
  usedKeys,
  validateSchema,
  type FieldType,
  type FormSchema,
  type SchemaError,
} from "@ams/shared";
import { CircleAlert, MousePointerClick } from "lucide-react";
import { useMemo, useState } from "react";
import {
  addField,
  addSection,
  describePath,
  duplicateField,
  errorsForField,
  errorsForSection,
  fieldPath,
  globalErrors,
  selectionForPath,
  type Selection,
} from "@/components/builder/builder-logic";
import { FieldEditor, SectionEditor } from "@/components/builder/FieldEditor";
import { Outline } from "@/components/builder/Outline";
import { PreviewPanel } from "@/components/builder/PreviewPanel";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function toProps(list: { prop: string; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of list) if (!(e.prop in out)) out[e.prop] = e.message;
  return out;
}

export function FormBuilder({
  schema,
  onChange,
  serverErrors = [],
  readOnly = false,
}: {
  schema: FormSchema;
  onChange(schema: FormSchema): void;
  /** `schema_errors` from a rejected publish (paths as in docs/FORMS.md). */
  serverErrors?: readonly SchemaError[];
  readOnly?: boolean;
}) {
  const [selection, setSelection] = useState<Selection>(() =>
    schema.sections[0]?.fields[0] ? { kind: "field", key: schema.sections[0].fields[0].key } : null,
  );
  /** Keys of fields added in this session whose key still follows the label. */
  const [autoKeys, setAutoKeys] = useState<ReadonlySet<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<Selection>(null);
  /** Remounts the editor on user selection, but not when a rename changes the selected key. */
  const [editorNonce, setEditorNonce] = useState(0);
  const select = (sel: Selection) => {
    setSelection(sel);
    setEditorNonce((n) => n + 1);
  };

  const clientErrors = useMemo(() => validateSchema(schema), [schema]);
  const errors = useMemo(() => {
    const seen = new Set(clientErrors.map((e) => e.path));
    return [...clientErrors, ...serverErrors.filter((e) => !seen.has(e.path))];
  }, [clientErrors, serverErrors]);
  const errorPaths = useMemo(() => new Set(errors.map((e) => e.path)), [errors]);

  const selectedField =
    selection?.kind === "field"
      ? schema.sections.flatMap((s) => s.fields).find((f) => f.key === selection.key) ?? null
      : null;
  const selectedSection = selection?.kind === "section" ? (schema.sections[selection.index] ?? null) : null;

  const handleAddField = (si: number, type: FieldType) => {
    const r = addField(schema, si, type);
    onChange(r.schema);
    setAutoKeys(new Set([...autoKeys, r.key]));
    select({ kind: "field", key: r.key });
  };

  const handleRename = (oldKey: string, newKey: string) => {
    onChange(renameField(schema, oldKey, newKey));
    const next = new Set(autoKeys);
    next.delete(oldKey);
    setAutoKeys(next);
    setSelection({ kind: "field", key: newKey });
  };

  const handleLabel = (label: string) => {
    if (!selectedField) return;
    const key = selectedField.key;
    let next = updateField(schema, key, { label });
    if (autoKeys.has(key) && label.trim() !== "") {
      const derived = slugifyKey(label, usedKeys(schema).fields.filter((k) => k !== key));
      if (derived !== key) {
        next = renameField(next, key, derived);
        const keys = new Set(autoKeys);
        keys.delete(key);
        keys.add(derived);
        setAutoKeys(keys);
        setSelection({ kind: "field", key: derived });
      }
    }
    onChange(next);
  };

  const deleteSelection = (sel: Selection) => {
    if (sel?.kind === "field") {
      onChange(removeField(schema, sel.key));
      setSelection(null);
    } else if (sel?.kind === "section") {
      onChange(removeSection(schema, sel.index));
      setSelection(null);
    }
  };

  const deleteRefs = pendingDelete?.kind === "field" ? findReferences(schema, pendingDelete.key).filter((r) => r.owner !== pendingDelete.key) : [];
  const pendingSection = pendingDelete?.kind === "section" ? schema.sections[pendingDelete.index] : undefined;

  return (
    <div className="grid grid-cols-1 lg:h-full lg:min-h-0 lg:grid-cols-[17rem_minmax(0,1fr)_minmax(20rem,26rem)]">
      <aside className="min-h-0 border-b lg:border-r lg:border-b-0" aria-label="Outline">
        <div className="flex h-10 items-center justify-between border-b px-3">
          <h2 className="text-xs font-medium text-muted-foreground">Outline</h2>
          <ErrorSummary errors={errors} schema={schema} onPick={(p) => select(selectionForPath(schema, p))} />
        </div>
        <div className="h-[calc(100%-2.5rem)] max-h-[60vh] lg:max-h-none">
          <Outline
            schema={schema}
            selection={selection}
            onSelect={select}
            onChange={onChange}
            onAddField={handleAddField}
            onAddSection={() => {
              const r = addSection(schema);
              onChange(r.schema);
              select({ kind: "section", index: r.index });
            }}
            errorPaths={errorPaths}
          />
        </div>
      </aside>
      <section className={cn("min-h-0 overflow-y-auto p-4 md:p-5", readOnly && "pointer-events-none opacity-60")} aria-label="Editor">
        {globalErrors(errors).map((e) => (
          <p key={e.path} className="mb-3 text-xs text-destructive">
            {e.path}: {e.message}
          </p>
        ))}
        {selectedField ? (
          <FieldEditor
            key={editorNonce}
            schema={schema}
            field={selectedField}
            errors={toProps(errorsForField(errors, fieldPath(schema, selectedField.key)))}
            onChange={onChange}
            onRename={handleRename}
            onLabelChange={handleLabel}
            onDuplicate={() => {
              const r = duplicateField(schema, selectedField.key);
              if (r) {
                onChange(r.schema);
                select({ kind: "field", key: r.key });
              }
            }}
            onDelete={() => setPendingDelete({ kind: "field", key: selectedField.key })}
          />
        ) : selectedSection && selection?.kind === "section" ? (
          <SectionEditor
            key={`${editorNonce}:${selection.index}`}
            schema={schema}
            section={selectedSection}
            index={selection.index}
            errors={toProps(errorsForSection(errors, selection.index))}
            onChange={(patch) => onChange(updateSection(schema, selection.index, patch))}
            onDelete={() =>
              selectedSection.fields.length === 0 ? deleteSelection(selection) : setPendingDelete(selection)
            }
          />
        ) : (
          <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <MousePointerClick aria-hidden className="size-5" />
            Select a field or section in the outline, or add one with +.
          </div>
        )}
      </section>
      <aside className="min-h-[24rem] border-t lg:min-h-0 lg:border-t-0 lg:border-l" aria-label="Live preview">
        <PreviewPanel schema={schema} />
      </aside>
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title={pendingDelete?.kind === "section" ? `Delete section “${pendingSection?.title ?? ""}”?` : "Delete this field?"}
        description={
          pendingDelete?.kind === "section"
            ? `Its ${pendingSection?.fields.length ?? 0} field(s) are removed from the draft. Published versions and their data are not affected.`
            : deleteRefs.length > 0
              ? `It is used by ${deleteRefs.map((r) => r.owner).join(", ")}; those expressions will show errors until you update them.`
              : "Removed from the draft only. Published versions and their data are not affected."
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          deleteSelection(pendingDelete);
          setPendingDelete(null);
        }}
      />
    </div>
  );
}

function ErrorSummary({ errors, schema, onPick }: { errors: readonly SchemaError[]; schema: FormSchema; onPick(path: string): void }) {
  if (errors.length === 0) return <span className="text-[11px] text-flag-green">No errors</span>;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1 rounded-sm text-[11px] font-medium text-destructive outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/40">
          <CircleAlert aria-hidden className="size-3.5" />
          {errors.length} error{errors.length === 1 ? "" : "s"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-1">
        <ul className="max-h-72 overflow-y-auto">
          {errors.map((e) => (
            <li key={e.path + e.message}>
              <button type="button" onClick={() => onPick(e.path)} className="grid w-full gap-0.5 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent">
                <span className="font-medium">{describePath(schema, e.path)}</span>
                <span className="text-destructive">{e.message}</span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
