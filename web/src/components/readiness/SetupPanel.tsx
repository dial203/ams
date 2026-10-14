import type { ReadinessBoard, Terminology } from "@ams/shared";
import { Link } from "@tanstack/react-router";
import { CalendarX, ChevronRight, FileX, Hourglass, Unlink, Watch, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { setupItems, type SetupItem } from "@/components/readiness/missing";
import { Button } from "@/components/ui/button";

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function listNames(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function Item({ icon: Icon, children, action }: { icon: LucideIcon; children: ReactNode; action?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
      <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 basis-64 text-sm">{children}</div>
      {action}
    </li>
  );
}

function SetupRow({ item, isAdmin, terms }: { item: SetupItem; isAdmin: boolean; terms: Terminology }) {
  const athletes = (n: number) => plural(n, terms.athlete.toLowerCase(), terms.athletes.toLowerCase());
  switch (item.kind) {
    case "no_source":
      return (
        <Item
          icon={FileX}
          action={
            isAdmin && item.formSlug ? (
              <Button asChild variant="outline" size="sm">
                <Link to="/forms" search={{ template: item.formSlug }}>
                  Install form
                </Link>
              </Button>
            ) : undefined
          }
        >
          <span className="font-medium">{item.metric.name}</span> reads{" "}
          {item.formSlug ? (
            <>
              the form <code className="text-xs">{item.formSlug}</code>, which does not exist yet.
              {!isAdmin && " An admin can install it from its template in Forms."}
            </>
          ) : (
            <>
              <code className="text-xs">{item.source}</code>, which does not exist.
            </>
          )}
        </Item>
      );
    case "not_linked": {
      const one = item.athletes.length === 1 ? item.athletes[0]! : null;
      return (
        <Item
          icon={Unlink}
          action={
            <Button asChild variant="outline" size="sm">
              {one ? (
                <Link to="/athletes/$athleteId" params={{ athleteId: one.id }} search={{ tab: "wearables" }}>
                  Connect wearable
                </Link>
              ) : (
                <Link to="/athletes">Open {terms.athletes.toLowerCase()}</Link>
              )}
            </Button>
          }
        >
          {one ? <span className="font-medium">{one.display_name}</span> : athletes(item.athletes.length)}{" "}
          {one ? "has" : "have"} no wearable linked, so {listNames(item.metrics.map((m) => m.name))}{" "}
          {item.metrics.length === 1 ? "stays" : "stay"} empty.
        </Item>
      );
    }
    case "no_device_data":
      return (
        <Item icon={Watch}>
          <span className="font-medium">{item.metric.name}</span>: the linked wearable of {athletes(item.athletes)} has sent
          no <code className="text-xs">{item.source.replace(/^wearable:/, "")}</code> data. Not every device records it;
          the Wearables tab shows what arrives.
        </Item>
      );
    case "building": {
      const left = item.minLeft === item.maxLeft ? `${item.minLeft}` : `${item.minLeft}–${item.maxLeft}`;
      return (
        <Item icon={Hourglass}>
          <span className="font-medium">{item.metric.name}</span>: still building for {athletes(item.athletes)}; at least{" "}
          {left} more {item.maxLeft === 1 ? "day" : "days"} of data needed.
        </Item>
      );
    }
    case "no_schedule":
      return (
        <Item
          icon={CalendarX}
          action={
            isAdmin ? (
              <Button asChild variant="outline" size="sm">
                <Link to="/forms">Schedule forms</Link>
              </Button>
            ) : undefined
          }
        >
          No forms are scheduled for{" "}
          {item.athletes === item.total
            ? item.total === 1
              ? `this ${terms.athlete.toLowerCase()}`
              : `these ${terms.athletes.toLowerCase()}`
            : `${item.athletes} of ${athletes(item.total)}`}
          , so nothing is ever due. Schedule a form for a {terms.group.toLowerCase()} on the form’s page.
        </Item>
      );
  }
}

/** Board-wide reasons for empty cells, with the step that fills them. Renders nothing when there are none. */
export function SetupPanel({ board, isAdmin, terms }: { board: ReadinessBoard; isAdmin: boolean; terms: Terminology }) {
  const items = setupItems(board);
  if (items.length === 0) return null;
  return (
    <details open className="group rounded-lg border bg-card" data-testid="readiness-setup">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
        Why cells are empty
        <span className="font-normal text-muted-foreground">· {plural(items.length, "item", "items")}</span>
      </summary>
      <ul className="divide-y border-t">
        {items.map((item, i) => (
          <SetupRow key={`${item.kind}-${"metric" in item ? item.metric.slug : i}`} item={item} isAdmin={isAdmin} terms={terms} />
        ))}
      </ul>
    </details>
  );
}
