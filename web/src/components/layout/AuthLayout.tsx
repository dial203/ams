import type { ReactNode } from "react";

export function AuthLayout({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(420px,40%)]">
      <div className="relative hidden overflow-hidden bg-zinc-950 text-zinc-100 lg:flex lg:flex-col lg:justify-between lg:p-10">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex size-7 items-center justify-center rounded-md bg-white text-xs font-bold text-zinc-950">A</span>
          AMS
        </div>
        <div className="relative z-10 max-w-md">
          <p className="text-2xl leading-snug font-semibold tracking-tight">
            Readiness, training load and research data for every athlete, operator and participant.
          </p>
          <p className="mt-3 text-sm text-zinc-400">
            Questionnaires, session logs, tests and wearables in one place, with permissions that match how your
            department works.
          </p>
        </div>
        <svg aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[38%] w-full opacity-35" viewBox="0 0 400 300" preserveAspectRatio="none" fill="none">
          {Array.from({ length: 9 }).map((_, i) => (
            <path
              key={i}
              d={`M0 ${220 - i * 18} C 80 ${180 - i * 20}, 140 ${260 - i * 14}, 220 ${190 - i * 18} S 340 ${120 - i * 10}, 400 ${150 - i * 16}`}
              stroke={i % 3 === 0 ? "#22c55e" : "#52525b"}
              strokeWidth={i % 3 === 0 ? 1.5 : 1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        <div className="text-xs text-zinc-500">Athlete management system</div>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-6">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
