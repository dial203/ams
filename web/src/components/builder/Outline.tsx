/**
 * Builder outline: sections and fields in one sortable list (dnd-kit). Drag a field
 * anywhere (also into another section); drag a section header to reorder sections. The
 * drag handles are keyboard operable (Space to lift, arrows to move, Space to drop).
 */
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FIELD_TYPES, FIELD_TYPE_LABELS, type FieldType, type FormSchema } from "@ams/shared";
import { GripVertical, Plus } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { applyOutlineDrop, flattenOutline, type Selection } from "@/components/builder/builder-logic";
import { FieldTypeIcon } from "@/components/builder/FieldTypeIcon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function Outline({
  schema,
  selection,
  onSelect,
  onChange,
  onAddField,
  onAddSection,
  errorPaths,
}: {
  schema: FormSchema;
  selection: Selection;
  onSelect(sel: Selection): void;
  onChange(schema: FormSchema): void;
  onAddField(sectionIndex: number, type: FieldType): void;
  onAddSection(): void;
  /** Paths with schema errors, to flag items. */
  errorPaths: ReadonlySet<string>;
}) {
  const items = useMemo(() => flattenOutline(schema), [schema]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const hasError = (prefix: string, exactOnlyForSection = false) => {
    for (const p of errorPaths) {
      if (p === prefix || p.startsWith(`${prefix}/`)) {
        if (exactOnlyForSection && p.startsWith(`${prefix}/fields/`)) continue;
        return true;
      }
    }
    return false;
  };

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    if (!e.over) return;
    const next = applyOutlineDrop(schema, String(e.active.id), String(e.over.id));
    if (next !== schema) onChange(next);
  };
  const active = items.find((i) => i.id === activeId);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto p-2">
        {schema.sections.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">No sections yet. Add one to start.</p>
        )}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
          <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <ul className="grid gap-px" aria-label="Form outline">
              {items.map((item) => {
                if (item.kind === "section") {
                  const s = schema.sections[item.si]!;
                  return (
                    <SortableRow key={item.id} id={item.id} label={`Section ${s.title || s.key}`} className="mt-2 first:mt-0">
                      <button
                        type="button"
                        onClick={() => onSelect({ kind: "section", index: item.si })}
                        aria-current={selection?.kind === "section" && selection.index === item.si ? "true" : undefined}
                        className={cn(
                          "flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40",
                          selection?.kind === "section" && selection.index === item.si && "bg-accent text-foreground",
                        )}
                      >
                        <span className="truncate">{s.title || s.key || "Untitled section"}</span>
                        {s.visible_if && <span className="rounded bg-muted px-1 text-[9px] normal-case">if</span>}
                        {hasError(`sections/${item.si}`, true) && <ErrorDot />}
                      </button>
                      <AddFieldMenu onAdd={(t) => onAddField(item.si, t)} />
                    </SortableRow>
                  );
                }
                const f = schema.sections[item.si]!.fields[item.fi]!;
                const selected = selection?.kind === "field" && selection.key === f.key;
                return (
                  <SortableRow key={item.id} id={item.id} label={`Field ${f.label || f.key}`}>
                    <button
                      type="button"
                      onClick={() => onSelect({ kind: "field", key: f.key })}
                      aria-current={selected ? "true" : undefined}
                      data-field-key={f.key}
                      className={cn(
                        "flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/40",
                        selected && "bg-accent font-medium hover:bg-accent",
                      )}
                    >
                      <FieldTypeIcon type={f.type} />
                      <span className="min-w-0 flex-1 truncate">{f.label || <span className="text-muted-foreground italic">No label</span>}</span>
                      {f.required && <span className="text-[10px] text-destructive" aria-label="required">*</span>}
                      {f.visible_if && <span className="rounded bg-muted px-1 text-[9px] text-muted-foreground">if</span>}
                      <code className="max-w-24 truncate font-mono text-[10px] text-muted-foreground">{f.key}</code>
                      {hasError(`sections/${item.si}/fields/${item.fi}`) && <ErrorDot />}
                    </button>
                  </SortableRow>
                );
              })}
            </ul>
          </SortableContext>
          <DragOverlay dropAnimation={null}>
            {active ? (
              <div className="flex items-center gap-2 rounded-md border bg-popover px-2 py-1 text-[13px] shadow-lg">
                <GripVertical className="size-3.5 text-muted-foreground" />
                {active.kind === "section"
                  ? (schema.sections[active.si]?.title ?? "Section")
                  : (schema.sections[active.si]?.fields[active.fi]?.label ?? "Field")}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
      <div className="border-t p-2">
        <Button variant="outline" size="sm" className="w-full" onClick={onAddSection}>
          <Plus /> Add section
        </Button>
      </div>
    </div>
  );
}

function ErrorDot() {
  return <span className="size-1.5 shrink-0 rounded-full bg-destructive" aria-label="has errors" role="img" />;
}

function SortableRow({ id, label, children, className }: { id: string; label: string; children: ReactNode; className?: string }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("group flex items-center gap-0.5", isDragging && "opacity-40", className)}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Drag ${label}`}
        className="flex h-6 w-4 shrink-0 cursor-grab items-center justify-center rounded-sm text-muted-foreground/50 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 active:cursor-grabbing"
      >
        <GripVertical className="size-3.5" />
      </button>
      {children}
    </li>
  );
}

function AddFieldMenu({ onAdd }: { onAdd(type: FieldType): void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Add field" className="size-6 text-muted-foreground">
          <Plus />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Add field</DropdownMenuLabel>
        {FIELD_TYPES.map((t) => (
          <DropdownMenuItem key={t} onSelect={() => onAdd(t)}>
            <FieldTypeIcon type={t} />
            {FIELD_TYPE_LABELS[t]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
