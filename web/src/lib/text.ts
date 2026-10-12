/** Number of Unicode code points (what `max_length` counts per docs/FORMS.md). */
export function codePointCount(s: string): number {
  return Array.from(s).length;
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
