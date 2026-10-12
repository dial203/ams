import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Pagination({
  offset,
  limit,
  total,
  onChange,
}: {
  offset: number;
  limit: number;
  total: number;
  onChange(offset: number): void;
}) {
  if (total <= limit && offset === 0) {
    return <div className="text-xs text-muted-foreground tabular">{total} total</div>;
  }
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="tabular">
        {from}–{to} of {total}
      </span>
      <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
        <ChevronLeft />
      </Button>
      <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={to >= total} onClick={() => onChange(offset + limit)}>
        <ChevronRight />
      </Button>
    </div>
  );
}
