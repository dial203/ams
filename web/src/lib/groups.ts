import type { Group } from "@ams/shared";

export interface GroupNode {
  group: Group;
  depth: number;
  children: GroupNode[];
}

/** Builds the group hierarchy. Groups whose parent is not in the list become roots. Sorted by name. */
export function buildGroupTree(groups: readonly Group[]): GroupNode[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const childrenOf = new Map<string | null, Group[]>();
  for (const g of groups) {
    const parent = g.parent_id && byId.has(g.parent_id) ? g.parent_id : null;
    const list = childrenOf.get(parent) ?? [];
    list.push(g);
    childrenOf.set(parent, list);
  }
  const seen = new Set<string>();
  const build = (parent: string | null, depth: number): GroupNode[] =>
    (childrenOf.get(parent) ?? [])
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .filter((g) => !seen.has(g.id))
      .map((g) => {
        seen.add(g.id);
        return { group: g, depth, children: build(g.id, depth + 1) };
      });
  return build(null, 0);
}

/** Depth-first list of the tree (for indented selects). */
export function flattenGroupTree(nodes: readonly GroupNode[]): GroupNode[] {
  const out: GroupNode[] = [];
  const walk = (list: readonly GroupNode[]) => {
    for (const n of list) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/** Indented options for a group select. */
export function groupOptions(groups: readonly Group[]): { id: string; label: string; depth: number; group: Group }[] {
  return flattenGroupTree(buildGroupTree(groups)).map((n) => ({
    id: n.group.id,
    label: `${"   ".repeat(n.depth)}${n.group.name}`,
    depth: n.depth,
    group: n.group,
  }));
}

/** Path of group names from the root, e.g. "Football › First team". */
export function groupPath(groups: readonly Group[], id: string): string {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const names: string[] = [];
  let cur = byId.get(id);
  const guard = new Set<string>();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    names.unshift(cur.name);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return names.join(" › ");
}
