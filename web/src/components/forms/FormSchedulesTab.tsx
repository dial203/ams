import { queryKeys, type Form, type FormSchedule, type FormScheduleCreate, type Recurrence } from "@ams/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FormRow } from "@/components/FormRow";
import { GroupPicker } from "@/components/GroupPicker";
import { EmptyState, ErrorState, Spinner } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApi } from "@/lib/api-context";
import { toastError } from "@/lib/errors";
import { formatDate } from "@/lib/field-format";
import { RECURRENCE_LABELS, WEEKDAYS, describeRecurrence } from "@/lib/labels";
import { useOrg } from "@/lib/org";
import { useGroups } from "@/lib/queries";
import { cn } from "@/lib/utils";

export function FormSchedulesTab({ form }: { form: Form }) {
  const api = useApi();
  const qc = useQueryClient();
  const { orgId, isAdmin, terms } = useOrg();
  const groups = useGroups();
  const [editing, setEditing] = useState<FormSchedule | "new" | null>(null);
  const [deleting, setDeleting] = useState<FormSchedule | null>(null);
  const schedules = useQuery({
    queryKey: queryKeys.forms.schedules(orgId, form.id),
    queryFn: ({ signal }) => api.schedules.list(orgId, form.id, { signal }),
  });
  const groupName = (id: string) => groups.data?.find((g) => g.id === id)?.name ?? "Unknown";

  return (
    <div className="grid max-w-5xl gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Schedules make the form “due” for every {terms.athlete.toLowerCase()} in a {terms.group.toLowerCase()} (and its sub-{terms.groups.toLowerCase()}) and drive reminders.
        </p>
        {isAdmin && (
          <Button size="sm" onClick={() => setEditing("new")} disabled={!form.current_version}>
            <Plus /> New schedule
          </Button>
        )}
      </div>
      {!form.current_version && <p className="text-xs text-flag-amber">Publish the form before scheduling it.</p>}
      {schedules.isPending ? (
        <Skeleton className="h-40" />
      ) : schedules.isError ? (
        <ErrorState error={schedules.error} onRetry={() => void schedules.refetch()} />
      ) : schedules.data.length === 0 ? (
        <Card>
          <EmptyState icon={CalendarClock} title="No schedules" description={`This form is not due for any ${terms.group.toLowerCase()} yet.`} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{terms.group}</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Due by</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Reminders</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {schedules.data.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{groupName(s.group_id)}</TableCell>
                  <TableCell>{describeRecurrence(s)}</TableCell>
                  <TableCell className="tabular">{s.due_time}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {s.recurrence === "once" ? "–" : `${formatDate(s.start_date)} → ${s.end_date ? formatDate(s.end_date) : "open"}`}
                  </TableCell>
                  <TableCell>{s.remind ? "On" : <span className="text-muted-foreground">Off</span>}</TableCell>
                  <TableCell>{s.active ? <Badge variant="success">Active</Badge> : <Badge variant="muted">Paused</Badge>}</TableCell>
                  <TableCell className="text-right">
                    {isAdmin && (
                      <span className="inline-flex">
                        <Button variant="ghost" size="icon-sm" aria-label="Edit schedule" onClick={() => setEditing(s)}>
                          <Pencil />
                        </Button>
                        <Button variant="ghost" size="icon-sm" aria-label="Delete schedule" onClick={() => setDeleting(s)}>
                          <Trash2 />
                        </Button>
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {editing && <ScheduleDialog form={form} schedule={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this schedule?"
        description="The form stops being due for this group. Existing submissions are kept."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          try {
            await api.schedules.delete(orgId, deleting!.id);
            void qc.invalidateQueries({ queryKey: queryKeys.forms.schedules(orgId, form.id) });
            toast.success("Schedule deleted");
          } catch (e) {
            toastError(e, "Could not delete");
            throw e;
          }
        }}
      />
    </div>
  );
}

function ScheduleDialog({ form, schedule, onClose }: { form: Form; schedule: FormSchedule | null; onClose(): void }) {
  const api = useApi();
  const qc = useQueryClient();
  const { orgId, today, terms, groupId } = useOrg();
  const groups = useGroups();
  const [v, setV] = useState<FormScheduleCreate>(
    schedule
      ? { group_id: schedule.group_id, recurrence: schedule.recurrence, days_of_week: schedule.days_of_week, due_time: schedule.due_time, start_date: schedule.start_date, end_date: schedule.end_date, remind: schedule.remind, active: schedule.active }
      : { group_id: groupId ?? "", recurrence: "daily", days_of_week: [1, 2, 3, 4, 5], due_time: "10:00", start_date: today, end_date: null, remind: true, active: true },
  );
  const save = useMutation({
    mutationFn: (body: FormScheduleCreate) =>
      schedule ? api.schedules.update(orgId, schedule.id, body) : api.schedules.create(orgId, form.id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.forms.schedules(orgId, form.id) });
      toast.success(schedule ? "Schedule updated" : "Schedule created");
      onClose();
    },
    onError: (e) => toastError(e, "Could not save the schedule"),
  });
  const toggleDay = (d: number) =>
    setV((p) => ({ ...p, days_of_week: p.days_of_week.includes(d) ? p.days_of_week.filter((x) => x !== d) : [...p.days_of_week, d].sort() }));
  const invalid = !v.group_id || !/^\d{2}:\d{2}$/.test(v.due_time) || (v.recurrence === "weekly" && v.days_of_week.length === 0) || (!!v.end_date && v.end_date < v.start_date);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{schedule ? "Edit schedule" : "New schedule"}</DialogTitle>
          <DialogDescription>{form.name}</DialogDescription>
        </DialogHeader>
        <form
          id="schedule-form"
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!invalid) save.mutate({ ...v, end_date: v.recurrence === "once" ? null : v.end_date });
          }}
        >
          <FormRow label={terms.group} htmlFor="sch-group">
            <GroupPicker id="sch-group" groups={groups.data ?? []} value={v.group_id || null} onChange={(g) => setV((p) => ({ ...p, group_id: g ?? "" }))} placeholder={`Choose ${terms.group.toLowerCase()}…`} />
          </FormRow>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormRow label="Repeats" htmlFor="sch-rec">
              <NativeSelect id="sch-rec" value={v.recurrence} onChange={(e) => setV((p) => ({ ...p, recurrence: e.target.value as Recurrence }))}>
                {(Object.keys(RECURRENCE_LABELS) as Recurrence[]).map((r) => (
                  <option key={r} value={r}>
                    {RECURRENCE_LABELS[r]}
                  </option>
                ))}
              </NativeSelect>
            </FormRow>
            <FormRow label="Due by (local time)" htmlFor="sch-time">
              <Input id="sch-time" type="time" value={v.due_time} onChange={(e) => setV((p) => ({ ...p, due_time: e.target.value }))} />
            </FormRow>
          </div>
          {v.recurrence === "weekly" && (
            <div className="grid gap-1.5">
              <span className="text-[13px] font-medium">Days</span>
              <div className="flex flex-wrap gap-1" role="group" aria-label="Days of week">
                {WEEKDAYS.map((d) => {
                  const on = v.days_of_week.includes(d.n);
                  return (
                    <button
                      key={d.n}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleDay(d.n)}
                      className={cn(
                        "h-8 w-11 rounded-md border text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                        on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
                      )}
                    >
                      {d.short}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormRow label={v.recurrence === "once" ? "Day" : "Starts"} htmlFor="sch-start">
              <Input id="sch-start" type="date" value={v.start_date} onChange={(e) => setV((p) => ({ ...p, start_date: e.target.value }))} />
            </FormRow>
            {v.recurrence !== "once" && (
              <FormRow label="Ends" htmlFor="sch-end" optional error={v.end_date && v.end_date < v.start_date ? "Ends before it starts" : undefined}>
                <Input id="sch-end" type="date" value={v.end_date ?? ""} onChange={(e) => setV((p) => ({ ...p, end_date: e.target.value || null }))} />
              </FormRow>
            )}
          </div>
          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={v.remind} onCheckedChange={(c) => setV((p) => ({ ...p, remind: c }))} /> Push reminders
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={v.active} onCheckedChange={(c) => setV((p) => ({ ...p, active: c }))} /> Active
            </label>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="schedule-form" disabled={invalid || save.isPending}>
            {save.isPending && <Spinner className="text-current" />}
            {schedule ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
