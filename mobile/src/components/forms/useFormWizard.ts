import { useCallback, useMemo, useState } from "react";
import {
  compileForm,
  isInputField,
  type CompiledForm,
  type ErrorCode,
  type Field,
  type FormEvaluation,
  type FormSchema,
  type FormValues,
  type Section,
  type SubmissionValidation,
} from "@ams/shared";

/** A section the athlete will see, with only its currently visible fields. */
export interface WizardStep {
  key: string;
  /** Index in `schema.sections`. */
  sectionIndex: number;
  section: Section;
  fields: Field[];
}

export interface FormWizard {
  schema: FormSchema;
  compiled: CompiledForm;
  /** Raw answers as entered (hidden fields keep their answers until submit). */
  values: FormValues;
  /** Live `evaluateForm` result: visibility and calculated values. */
  evaluation: FormEvaluation;
  /** Visible sections, in order. One section per screen. */
  steps: WizardStep[];
  stepIndex: number;
  current: WizardStep | null;
  isFirst: boolean;
  isLast: boolean;
  /** Field key -> error code shown under the field (client or server). */
  errors: Record<string, string>;
  /** Answers changed since the wizard opened. */
  dirty: boolean;
  setValue(key: string, value: unknown): void;
  /** Validates the current section; moves on when it is valid. Returns whether it moved. */
  next(): boolean;
  back(): void;
  goToStep(index: number): void;
  /**
   * `validateSubmission` over every answer. On failure shows the errors and jumps to the
   * first section that has one.
   */
  validateAll(): SubmissionValidation;
  /**
   * Shows server-side field errors (422 `field_errors`) under their fields and jumps to
   * the first one. Returns the keys that do not belong to any visible field.
   */
  applyServerErrors(fieldErrors: Record<string, string>): string[];
}

function visibleSteps(schema: FormSchema, evaluation: FormEvaluation): WizardStep[] {
  const out: WizardStep[] = [];
  schema.sections.forEach((section, sectionIndex) => {
    const fields = section.fields.filter((f) => evaluation.visible[f.key] !== false);
    if (fields.length > 0) out.push({ key: section.key, sectionIndex, section, fields });
  });
  return out;
}

/** Index of `currentKey` among the steps; if it was hidden, the closest earlier step. */
function resolveStepIndex(steps: WizardStep[], schema: FormSchema, currentKey: string | null): number {
  if (steps.length === 0) return 0;
  if (currentKey === null) return 0;
  const exact = steps.findIndex((s) => s.key === currentKey);
  if (exact !== -1) return exact;
  const schemaIndex = schema.sections.findIndex((s) => s.key === currentKey);
  let best = 0;
  steps.forEach((s, i) => {
    if (s.sectionIndex <= schemaIndex) best = i;
  });
  return best;
}

function inputKeys(step: WizardStep): string[] {
  return step.fields.filter(isInputField).map((f) => f.key);
}

export function useFormWizard(schema: FormSchema, initialValues: FormValues = {}): FormWizard {
  const compiled = useMemo(() => compileForm(schema), [schema]);
  const [values, setValues] = useState<FormValues>(initialValues);
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  const evaluation = useMemo(() => compiled.evaluate(values), [compiled, values]);
  const steps = useMemo(() => visibleSteps(schema, evaluation), [schema, evaluation]);
  const stepIndex = resolveStepIndex(steps, schema, currentKey);
  const current = steps[stepIndex] ?? null;

  const setValue = useCallback((key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const { [key]: _cleared, ...rest } = prev;
      return rest;
    });
  }, []);

  const goToStep = useCallback(
    (index: number) => {
      const step = steps[Math.max(0, Math.min(index, steps.length - 1))];
      if (step) setCurrentKey(step.key);
    },
    [steps],
  );

  const firstStepWithError = useCallback(
    (errs: Record<string, string>): number => steps.findIndex((s) => s.fields.some((f) => f.key in errs)),
    [steps],
  );

  const next = useCallback((): boolean => {
    if (!current) return false;
    const result = compiled.validate(values);
    const keys = inputKeys(current);
    const stepErrors: Record<string, string> = {};
    for (const k of keys) {
      const code = result.errors[k];
      if (code) stepErrors[k] = code;
    }
    if (Object.keys(stepErrors).length > 0) {
      setErrors((prev) => ({ ...prev, ...stepErrors }));
      return false;
    }
    if (stepIndex < steps.length - 1) {
      setCurrentKey(steps[stepIndex + 1]!.key);
      return true;
    }
    return false;
  }, [compiled, values, current, stepIndex, steps]);

  const back = useCallback(() => {
    if (stepIndex > 0) setCurrentKey(steps[stepIndex - 1]!.key);
  }, [stepIndex, steps]);

  const validateAll = useCallback((): SubmissionValidation => {
    const result = compiled.validate(values);
    if (!result.ok) {
      const shown: Record<string, ErrorCode> = {};
      for (const [k, code] of Object.entries(result.errors)) shown[k] = code;
      setErrors(shown);
      const idx = firstStepWithError(shown);
      if (idx !== -1) setCurrentKey(steps[idx]!.key);
    }
    return result;
  }, [compiled, values, firstStepWithError, steps]);

  const applyServerErrors = useCallback(
    (fieldErrors: Record<string, string>): string[] => {
      const visibleKeys = new Set(steps.flatMap((s) => s.fields.map((f) => f.key)));
      const unknown = Object.keys(fieldErrors).filter((k) => !visibleKeys.has(k));
      setErrors({ ...fieldErrors });
      const idx = firstStepWithError(fieldErrors);
      if (idx !== -1) setCurrentKey(steps[idx]!.key);
      return unknown;
    },
    [steps, firstStepWithError],
  );

  return {
    schema,
    compiled,
    values,
    evaluation,
    steps,
    stepIndex,
    current,
    isFirst: stepIndex === 0,
    isLast: stepIndex >= steps.length - 1,
    errors,
    dirty,
    setValue,
    next,
    back,
    goToStep,
    validateAll,
    applyServerErrors,
  };
}
