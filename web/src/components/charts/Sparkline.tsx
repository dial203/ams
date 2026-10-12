/** Minimal inline SVG sparkline (no axes), gaps for missing days. */
export function Sparkline({
  values,
  width = 120,
  height = 28,
  className,
  label,
}: {
  values: readonly (number | null)[];
  width?: number;
  height?: number;
  className?: string;
  label?: string;
}) {
  const nums = values.filter((v): v is number => v !== null && isFinite(v));
  if (nums.length === 0) return <svg width={width} height={height} className={className} aria-hidden />;
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  const span = hi - lo || 1;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const y = (v: number) => height - 3 - ((v - lo) / span) * (height - 6);
  const segments: string[] = [];
  let current = "";
  values.forEach((v, i) => {
    if (v === null || !isFinite(v)) {
      if (current) segments.push(current);
      current = "";
      return;
    }
    current += `${current ? "L" : "M"}${(i * step).toFixed(1)},${y(v).toFixed(1)}`;
  });
  if (current) segments.push(current);
  const lastIndex = values.length - 1 - [...values].reverse().findIndex((v) => v !== null);
  const last = values[lastIndex];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {segments.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="var(--chart-1)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      ))}
      {typeof last === "number" && <circle cx={lastIndex * step} cy={y(last)} r={2.2} fill="var(--chart-1)" />}
    </svg>
  );
}
