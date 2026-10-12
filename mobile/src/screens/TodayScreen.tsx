import { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { formatMetricValue, queryKeys, type DueForm } from "@ams/shared";
import { Sparkline } from "../components/charts";
import { HealthSyncChip } from "../components/HealthSyncChip";
import { AppText, Card, EmptyState, ErrorState, FlagBadge, LoadingState, Screen } from "../components/ui";
import { HEALTH_STATUS_KEY } from "../lib/health/HealthContext";
import { formatLongDate, formatTimeInZone, greetingFor, minutesInZone, parseClock } from "../lib/format";
import { useAthleteDay, useSelfAthlete, useSelfMetrics, useTodayForms } from "../lib/queries";
import { useActiveMembership } from "../lib/session/membership";
import { MIN_TOUCH, radius, spacing, useTheme } from "../theme";

export type DueFormState = "done" | "repeatable" | "overdue" | "due" | "anytime";

export function dueFormState(item: DueForm, nowMinutes: number): DueFormState {
  if (item.completed) return item.form.allow_multiple_per_day ? "repeatable" : "done";
  const due = parseClock(item.due_time);
  if (due === null) return "anytime";
  return nowMinutes > due ? "overdue" : "due";
}

/** Outstanding forms first (by due time, unscheduled after), completed ones last. */
export function sortDueForms(items: DueForm[]): DueForm[] {
  const rank = (d: DueForm) => (d.completed ? 2 : d.due_time ? 0 : 1);
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const r = rank(a.item) - rank(b.item);
      if (r !== 0) return r;
      const ta = parseClock(a.item.due_time) ?? Infinity;
      const tb = parseClock(b.item.due_time) ?? Infinity;
      if (ta !== tb) return ta - tb;
      return a.index - b.index;
    })
    .map((x) => x.item);
}

function statusText(item: DueForm, state: DueFormState, timeZone: string): string {
  const doneAt = item.last_submitted_at ? ` at ${formatTimeInZone(item.last_submitted_at, timeZone)}` : "";
  switch (state) {
    case "done":
      return `Done${doneAt}`;
    case "repeatable":
      return `Done${doneAt} · tap to add another`;
    case "overdue":
      return `Overdue · was due ${item.due_time}`;
    case "due":
      return `Due ${item.due_time}`;
    case "anytime":
      return "Anytime";
  }
}

function DueFormRow({ item, state, timeZone }: { item: DueForm; state: DueFormState; timeZone: string }) {
  const p = useTheme();
  const router = useRouter();
  const done = state === "done" || state === "repeatable";
  const disabled = state === "done";
  const status = statusText(item, state, timeZone);
  const markColor = done ? p.success : state === "overdue" ? p.warning : p.primary;
  return (
    <Pressable
      testID={`due-form-${item.form.id}`}
      disabled={disabled}
      onPress={() => router.push({ pathname: "/form/[formId]", params: { formId: item.form.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${item.form.name}. ${status}`}
      accessibilityHint={disabled ? undefined : "Opens the questionnaire"}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: p.surface, borderColor: state === "overdue" ? p.warning : p.border, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <View
        style={[styles.mark, { borderColor: markColor, backgroundColor: done ? p.success : "transparent" }]}
        importantForAccessibility="no-hide-descendants"
      >
        <AppText variant="bodyStrong" style={{ color: done ? p.textInverse : markColor }}>
          {done ? "✓" : state === "overdue" ? "!" : ""}
        </AppText>
      </View>
      <View style={styles.rowText}>
        <AppText variant="heading" style={done ? { color: p.textMuted } : undefined}>
          {item.form.name}
        </AppText>
        <AppText variant="label" tone={state === "overdue" ? "warning" : done ? "success" : "muted"}>
          {status}
        </AppText>
      </View>
      {!disabled ? (
        <AppText variant="title" tone="muted" importantForAccessibility="no">
          ›
        </AppText>
      ) : null}
    </Pressable>
  );
}

function TrendsGlance({ today }: { today: string }) {
  const router = useRouter();
  const metrics = useSelfMetrics(today);
  const series = (metrics.data ?? []).slice(0, 3);
  if (series.length === 0) return null;
  return (
    <Pressable
      onPress={() => router.push("/trends")}
      accessibilityRole="button"
      accessibilityLabel="Your trends"
      accessibilityHint="Opens Trends"
    >
      <Card>
        <AppText variant="heading">Your trends</AppText>
        {series.map((s) => {
          const latest = [...s.points].reverse().find((pt) => pt.value !== null);
          return (
            <View key={s.metric.id} style={styles.glanceRow}>
              <View style={styles.glanceText}>
                <AppText variant="label">{s.metric.name}</AppText>
                <AppText variant="caption" tone="muted">
                  {formatMetricValue(latest?.value, s.metric)}
                </AppText>
              </View>
              <View style={styles.spark}>
                <Sparkline points={s.points} />
              </View>
              <FlagBadge flag={latest?.flag ?? null} />
            </View>
          );
        })}
      </Card>
    </Pressable>
  );
}

export function TodayScreen() {
  const queryClient = useQueryClient();
  const { org, orgId, terminology } = useActiveMembership();
  const { timeZone, today, now } = useAthleteDay();
  const athlete = useSelfAthlete();
  const forms = useTodayForms(today);
  const nowMinutes = minutesInZone(now, timeZone);
  const sorted = useMemo(() => sortDueForms(forms.data ?? []), [forms.data]);
  const outstanding = sorted.filter((f) => !f.completed).length;

  const firstName =
    athlete.data?.preferred_name || athlete.data?.first_name || athlete.data?.display_name?.split(" ")[0] || "";

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.self.all(orgId) });
    void queryClient.invalidateQueries({ queryKey: HEALTH_STATUS_KEY });
  };

  return (
    <Screen onRefresh={refresh} refreshing={forms.isRefetching} testID="today-screen">
      <View style={styles.header}>
        <AppText variant="caption" tone="muted">
          {formatLongDate(today)}
        </AppText>
        <AppText variant="title">
          {greetingFor(nowMinutes)}
          {firstName ? `, ${firstName}` : ""}
        </AppText>
        <AppText variant="body" tone="muted">
          {athlete.data ? `${terminology.athlete} ${athlete.data.code} · ` : ""}
          {org.name}
        </AppText>
        <HealthSyncChip />
      </View>

      <View style={styles.sectionHeader}>
        <AppText variant="heading">Today</AppText>
        {forms.data ? (
          <AppText variant="label" tone="muted">
            {outstanding === 0 ? "All done" : `${outstanding} to do`}
          </AppText>
        ) : null}
      </View>

      {forms.isPending ? (
        <LoadingState label="Loading today's forms…" />
      ) : forms.isError && !forms.data ? (
        <ErrorState error={forms.error} onRetry={() => void forms.refetch()} retrying={forms.isRefetching} />
      ) : sorted.length === 0 ? (
        <EmptyState title="Nothing to fill in today" message="Check back later or pull down to refresh." />
      ) : (
        <View style={styles.list} accessibilityRole="list">
          {sorted.map((item) => (
            <DueFormRow key={item.form.id} item={item} state={dueFormState(item, nowMinutes)} timeZone={timeZone} />
          ))}
        </View>
      )}

      <TrendsGlance today={today} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.xs },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  list: { gap: spacing.md },
  row: {
    minHeight: MIN_TOUCH + 28,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  mark: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1, gap: 2 },
  glanceRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: MIN_TOUCH - 8 },
  glanceText: { flex: 1 },
  spark: { width: 80 },
});
