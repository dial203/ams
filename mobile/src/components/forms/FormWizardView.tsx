import { useEffect, useRef, type ReactNode } from "react";
import { AccessibilityInfo, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isInputField, type SubmissionValidation } from "@ams/shared";
import { haptics } from "../../lib/haptics";
import { radius, spacing, useTheme } from "../../theme";
import { AppText, Button } from "../ui";
import { stripMarkdown } from "./display";
import { FieldRenderer } from "./FieldRenderer";
import type { FormWizard } from "./useFormWizard";

export interface FormWizardViewProps {
  wizard: FormWizard;
  /** Shown above the first section (the form's description). */
  intro?: string | null;
  submitting?: boolean;
  submitLabel?: string;
  /** Called with a passing `validateSubmission` result. */
  onSubmit: (validation: SubmissionValidation) => void;
  /** Status shown under the fields (submit errors, retry). */
  banner?: ReactNode;
  /** Extra offset for the keyboard (header height). */
  keyboardOffset?: number;
}

function ProgressBar({ current, total }: { current: number; total: number }) {
  const p = useTheme();
  if (total <= 1) return null;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${current} of ${total}`}
      accessibilityValue={{ min: 0, max: total, now: current }}
      style={styles.progress}
    >
      <AppText variant="caption" tone="muted">
        Step {current} of {total}
      </AppText>
      <View style={[styles.track, { backgroundColor: p.surfaceAlt }]}>
        <View style={[styles.fill, { width: `${(current / total) * 100}%`, backgroundColor: p.primary }]} />
      </View>
    </View>
  );
}

/** One section per screen, with progress, Back / Next and Submit on the last section. */
export function FormWizardView({
  wizard,
  intro,
  submitting = false,
  submitLabel = "Submit",
  onSubmit,
  banner,
  keyboardOffset = 0,
}: FormWizardViewProps) {
  const p = useTheme();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const positions = useRef<Record<string, number>>({});
  const pendingScroll = useRef<string | null>(null);
  const step = wizard.current;

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [wizard.stepIndex]);

  const scrollToField = (key: string) => {
    const y = positions.current[key];
    if (y === undefined) {
      pendingScroll.current = key;
      return;
    }
    pendingScroll.current = null;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - spacing.lg), animated: true });
  };

  const reportErrors = (keys: string[]) => {
    haptics.error();
    AccessibilityInfo.announceForAccessibility(
      keys.length === 1 ? "One answer needs attention." : `${keys.length} answers need attention.`,
    );
  };

  const onPrimary = () => {
    if (!step) return;
    if (!wizard.isLast) {
      if (!wizard.next()) {
        const result = wizard.compiled.validate(wizard.values);
        const keys = step.fields.filter(isInputField).map((f) => f.key).filter((k) => result.errors[k]);
        reportErrors(keys);
        if (keys[0]) scrollToField(keys[0]);
      } else {
        haptics.selection();
      }
      return;
    }
    const validation = wizard.validateAll();
    if (!validation.ok) {
      const keys = Object.keys(validation.errors);
      reportErrors(keys);
      const first = step.fields.find((f) => f.key in validation.errors);
      if (first) scrollToField(first.key);
      return;
    }
    onSubmit(validation);
  };

  if (!step) {
    return (
      <View style={styles.empty}>
        <AppText tone="muted">This form has no questions to answer.</AppText>
      </View>
    );
  }

  const description = stripMarkdown(step.section.description);

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: p.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={keyboardOffset}
    >
      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        testID="wizard-scroll"
      >
        <ProgressBar current={wizard.stepIndex + 1} total={wizard.steps.length} />
        {wizard.isFirst && intro ? (
          <AppText variant="body" tone="muted">
            {stripMarkdown(intro)}
          </AppText>
        ) : null}
        <View style={styles.sectionHeader}>
          <AppText variant="title" testID="wizard-section-title">
            {step.section.title}
          </AppText>
          {description ? (
            <AppText variant="body" tone="muted">
              {description}
            </AppText>
          ) : null}
        </View>
        {step.fields.map((field) => (
          <FieldRenderer
            key={field.key}
            field={field}
            value={wizard.values[field.key]}
            computed={wizard.evaluation.computed[field.key]}
            errorCode={wizard.errors[field.key]}
            onChange={wizard.setValue}
            onLayout={(e) => {
              positions.current[field.key] = e.nativeEvent.layout.y;
              if (pendingScroll.current === field.key) scrollToField(field.key);
            }}
          />
        ))}
        {banner}
      </ScrollView>
      <View
        style={[
          styles.footer,
          { borderTopColor: p.border, backgroundColor: p.surface, paddingBottom: Math.max(insets.bottom, spacing.md) },
        ]}
      >
        {!wizard.isFirst ? (
          <Button label="Back" variant="secondary" onPress={wizard.back} style={styles.back} disabled={submitting} />
        ) : null}
        <Button
          testID="wizard-primary"
          label={wizard.isLast ? submitLabel : "Next"}
          onPress={onPrimary}
          loading={submitting}
          style={styles.primary}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xxl },
  sectionHeader: { gap: spacing.xs },
  progress: { gap: spacing.xs },
  track: { height: 6, borderRadius: radius.pill, overflow: "hidden" },
  fill: { height: 6, borderRadius: radius.pill },
  footer: {
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  back: { flex: 1 },
  primary: { flex: 2 },
  empty: { padding: spacing.xl, alignItems: "center" },
});
