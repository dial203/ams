import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import {
  findField,
  flagColor,
  formatMetricValue,
  queryKeys,
  type DueForm,
  type MetricSeries,
  type Submission,
} from "@ams/shared";
import { LineChart, lastValue } from "../components/charts";
import { displayFieldValue } from "../components/forms";
import { AppText, Banner, Card, EmptyState, ErrorState, FlagBadge, LoadingState, Screen } from "../components/ui";
import { formatRelativeDay, formatTimeInZone } from "../lib/format";
import { useAthleteDay, useSelfMetrics, useSelfSubmissions, useTodayForms } from "../lib/queries";
import { useActiveMembership } from "../lib/session/membership";
import { FLAG_META, MIN_TOUCH, spacing, useTheme } from "../theme";

const DAYS = 28;

/** Spoken summary of a metric's chart. */
export function describeSeries(series: MetricSeries, today: string): string {
  const values = series.points.map((p) => p.value).filter((v): v is number => v !== null);
  const last = lastValue(series.points);
  if (!last || last.value === null) return `${series.metric.name}: no data in the last ${DAYS} days.`;
  const flag = FLAG_META[flagColor(last.flag)].label;
  const min = formatMetricValue(Math.min(...values), series.metric);
  const max = formatMetricValue(Math.max(...values), series.metric);
  return (
    `${series.metric.name}: latest ${formatMetricValue(last.value, series.metric)} ` +
    `${formatRelativeDay(last.date, today).toLowerCase()}, flag ${flag}. ` +
    `${values.length} of ${series.points.length} days have data, ranging from ${min} to ${max}.`
  );
}

function MetricCard({ series, today }: { series: MetricSeries; today: string }) {
  const [open, setOpen] = useState(false);
  const last = lastValue(series.points);
  const metric = series.metric;
  return (
    <Card testID={`metric-${metric.slug}`}>
      <View style={styles.metricHeader}>
        <View style={styles.flex}>
          <AppText variant="heading">{metric.name}</AppText>
          <AppText variant="caption" tone="muted">
            {last ? formatRelativeDay(last.date, today) : `No data in ${DAYS} days`}
          </AppText>
        </View>
        <View style={styles.metricValue}>
          <AppText variant="title">{formatMetricValue(last?.value ?? null, metric)}</AppText>
          <FlagBadge flag={last?.flag ?? null} />
        </View>
      </View>
      <LineChart
        points={series.points}
        thresholds={metric.thresholds}
        formatValue={(v) => formatMetricValue(v, metric, { unit: false })}
        accessibilityLabel={describeSeries(series, today)}
      />
      {metric.description ? (
        <Pressable
          onPress={() => setOpen((o) => !o)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          style={styles.more}
        >
          <AppText variant="label" tone="primary">
            {open ? "Hide details" : "About this metric"}
          </AppText>
        </Pressable>
      ) : null}
      {open && metric.description ? (
        <AppText variant="body" tone="muted">
          {metric.description}
        </AppText>
      ) : null}
    </Card>
  );
}

function SubmissionRow({
  submission,
  due,
  today,
  timeZone,
}: {
  submission: Submission;
  due: DueForm | undefined;
  today: string;
  timeZone: string;
}) {
  const p = useTheme();
  const [open, setOpen] = useState(false);
  // The current version's labels; older versions may have renamed fields, so fall back to keys.
  const schema = due?.version.schema;
  const label = (key: string) => (schema ? (findField(schema, key)?.field.label ?? key) : key.replace(/_/g, " "));
  const field = (key: string) => (schema ? findField(schema, key)?.field : undefined);
  const computed = Object.entries(submission.computed).filter(([, v]) => v !== null && v !== undefined);
  const answers = Object.entries(submission.values);
  const title = due?.form.name ?? "Entry";
  const when = `${formatRelativeDay(submission.local_date, today)} · ${formatTimeInZone(submission.observed_at, timeZone)}`;

  return (
    <Pressable
      onPress={() => setOpen((o) => !o)}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${when}`}
      accessibilityState={{ expanded: open }}
      accessibilityHint={open ? "Hides answers" : "Shows answers"}
      style={[styles.subRow, { borderColor: p.border, backgroundColor: p.surface }]}
    >
      <View style={styles.subHeader}>
        <View style={styles.flex}>
          <AppText variant="bodyStrong">{title}</AppText>
          <AppText variant="caption" tone="muted">
            {when}
          </AppText>
        </View>
        <AppText variant="heading" tone="muted">
          {open ? "−" : "+"}
        </AppText>
      </View>
      {computed.length > 0 ? (
        <View style={styles.kvs}>
          {computed.slice(0, open ? undefined : 2).map(([k, v]) => (
            <AppText key={k} variant="label">
              {label(k)}: {displayFieldValue(field(k), v)}
            </AppText>
          ))}
        </View>
      ) : null}
      {open ? (
        <View style={styles.kvs}>
          {answers.map(([k, v]) => (
            <AppText key={k} variant="body" tone="muted">
              {label(k)}: {displayFieldValue(field(k), v)}
            </AppText>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

export function TrendsScreen() {
  const queryClient = useQueryClient();
  const { orgId } = useActiveMembership();
  const { today, timeZone } = useAthleteDay();
  const metrics = useSelfMetrics(today, DAYS);
  const submissions = useSelfSubmissions({ limit: 20 });
  const forms = useTodayForms(today);
  const formsById = useMemo(() => new Map((forms.data ?? []).map((d) => [d.form.id, d])), [forms.data]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.self.metrics(orgId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.self.submissions(orgId) });
  };

  return (
    <Screen onRefresh={refresh} refreshing={metrics.isRefetching || submissions.isRefetching} testID="trends-screen">
      <View>
        <AppText variant="title">Trends</AppText>
        <AppText variant="body" tone="muted">
          Your last 4 weeks
        </AppText>
      </View>

      {metrics.isPending ? (
        <LoadingState label="Loading your metrics…" />
      ) : metrics.isError && !metrics.data ? (
        <ErrorState error={metrics.error} onRetry={() => void metrics.refetch()} />
      ) : metrics.data.length === 0 ? (
        <EmptyState title="No metrics yet" message="Your staff haven't shared any metrics with you." />
      ) : (
        <View style={styles.list}>
          {metrics.isError ? <Banner tone="warning" message="Couldn't refresh. Showing saved data." /> : null}
          {metrics.data.map((s) => (
            <MetricCard key={s.metric.id} series={s} today={today} />
          ))}
        </View>
      )}

      <AppText variant="heading" style={styles.sectionTitle}>
        Recent entries
      </AppText>
      {submissions.isPending ? (
        <LoadingState label="Loading your entries…" />
      ) : submissions.isError && !submissions.data ? (
        <ErrorState error={submissions.error} onRetry={() => void submissions.refetch()} />
      ) : submissions.data.items.length === 0 ? (
        <EmptyState title="No entries yet" message="Questionnaires you submit appear here." />
      ) : (
        <View style={styles.list}>
          {submissions.data.items.map((s) => (
            <SubmissionRow key={s.id} submission={s} due={formsById.get(s.form_id)} today={today} timeZone={timeZone} />
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { gap: spacing.md },
  metricHeader: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  metricValue: { alignItems: "flex-end", gap: spacing.xs },
  more: { minHeight: MIN_TOUCH - 8, justifyContent: "center", alignSelf: "flex-start" },
  sectionTitle: { marginTop: spacing.md },
  subRow: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: spacing.md, gap: spacing.sm, minHeight: MIN_TOUCH },
  subHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  kvs: { gap: 2 },
});
