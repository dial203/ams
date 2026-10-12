/** Form schema types (docs/FORMS.md "Schema"). All keys are snake_case. */

export const FIELD_TYPES = [
  "number",
  "scale",
  "select",
  "multiselect",
  "boolean",
  "text",
  "textarea",
  "date",
  "time",
  "datetime",
  "duration",
  "calculated",
  "info",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

/** Field types the athlete or staff member fills in (everything but `calculated` and `info`). */
export type InputFieldType = Exclude<FieldType, "calculated" | "info">;

export interface FieldOption {
  value: string | number;
  label: string;
}

export interface FieldBase {
  /** Unique across the whole schema. Pattern `^[a-z][a-z0-9_]{0,62}$`, no reserved words. */
  key: string;
  type: FieldType;
  label: string;
  /** Markdown shown under the label. */
  help?: string;
  /** Default `false`. Only enforced when visible. Ignored for `calculated` and `info`. */
  required?: boolean;
  /** Expression; the field is hidden unless it evaluates to `true`. */
  visible_if?: string | null;
  /** Display only, e.g. `"min"`, `"kg"`, `"AU"`. */
  unit?: string;
}

export interface NumberField extends FieldBase {
  type: "number";
  min?: number;
  max?: number;
  /** Input step hint; any value by default. */
  step?: number;
  /** Display and input-step hint; extra precision is not rejected. */
  decimals?: number;
}

export interface ScaleAnchors {
  min?: string;
  max?: string;
  mid?: string;
}

export interface ScaleField extends FieldBase {
  type: "scale";
  min: number;
  max: number;
  /** Default 1. */
  step?: number;
  anchors?: ScaleAnchors;
  /** Default `"buttons"` when the scale has at most 11 points, else `"slider"`. */
  display?: "buttons" | "slider";
}

export interface SelectField extends FieldBase {
  type: "select";
  /** Values unique; all strings or all numbers. */
  options: FieldOption[];
}

export interface MultiselectField extends FieldBase {
  type: "multiselect";
  options: FieldOption[];
  min_selected?: number;
  max_selected?: number;
}

export interface BooleanField extends FieldBase {
  type: "boolean";
}

export interface TextField extends FieldBase {
  type: "text";
  /** Default 500 (Unicode code points). */
  max_length?: number;
}

export interface TextareaField extends FieldBase {
  type: "textarea";
  /** Default 5000 (Unicode code points). */
  max_length?: number;
}

export interface DateField extends FieldBase {
  type: "date";
  /** `YYYY-MM-DD`. */
  min?: string;
  max?: string;
}

export interface TimeField extends FieldBase {
  type: "time";
}

export interface DateTimeField extends FieldBase {
  type: "datetime";
}

export interface DurationField extends FieldBase {
  type: "duration";
  /** Minutes. */
  min?: number;
  max?: number;
}

export interface CalculatedField extends FieldBase {
  type: "calculated";
  expression: string;
  /** Round numeric results half away from zero to this many decimals. */
  decimals?: number;
}

/** Static content: `label` is the heading, `help` is the body. Holds no value. */
export interface InfoField extends FieldBase {
  type: "info";
}

export type Field =
  | NumberField
  | ScaleField
  | SelectField
  | MultiselectField
  | BooleanField
  | TextField
  | TextareaField
  | DateField
  | TimeField
  | DateTimeField
  | DurationField
  | CalculatedField
  | InfoField;

/** The field interface for a given `type`. */
export type FieldOfType<T extends FieldType> = Extract<Field, { type: T }>;

/** Fields that hold a value: everything but `info`. */
export type ValueField = Exclude<Field, InfoField>;

/** Fields that take input: everything but `calculated` and `info`. */
export type InputField = Exclude<Field, InfoField | CalculatedField>;

export interface Section {
  /** Unique among sections. */
  key: string;
  title: string;
  /** Markdown. */
  description?: string | null;
  /** Hides every field in the section unless it evaluates to `true`. */
  visible_if?: string | null;
  /** At least one. */
  fields: Field[];
}

export interface FormSchema {
  schema_version: 1;
  sections: Section[];
}

/** Schema validation problem. `path` is `/`-joined, e.g. `sections/0/fields/2/expression`. */
export interface SchemaError {
  path: string;
  message: string;
}

/** Raw values as entered: field key -> JSON value. */
export type FormValues = Record<string, unknown>;

/** Submission validation error codes (docs/FORMS.md "validate"). */
export const ERROR_CODES = [
  "required",
  "invalid_type",
  "invalid_format",
  "invalid_option",
  "invalid_step",
  "out_of_range",
  "too_long",
  "unknown_field",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
