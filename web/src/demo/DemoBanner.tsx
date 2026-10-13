import { FlaskConical, LogOut } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { useApiContext } from "@/lib/api-context";
import { useLogout } from "@/lib/session";

export const DEMO_BANNER_TEXT =
  "Demo with synthetic data. Changes stay in this tab and reset on reload; new entries don't recompute metrics.";

/** The strip above every page of the demo build; its height is subtracted from full-height layouts. */
export function DemoBanner() {
  const ref = useRef<HTMLDivElement>(null);
  const { tokens } = useApiContext();
  const logout = useLogout();
  const signedIn = useSyncExternalStore(tokens.subscribe, tokens.isAuthenticated);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const apply = () => root.style.setProperty("--demo-banner-h", `${el.offsetHeight}px`);
    apply();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(apply) : null;
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.style.removeProperty("--demo-banner-h");
    };
  }, []);

  return (
    <div
      ref={ref}
      role="note"
      aria-label="Demo"
      className="relative z-50 flex items-center gap-2 border-b border-amber-300/70 bg-amber-50 px-3 py-1.5 text-xs text-amber-950 dark:border-amber-500/30 dark:bg-amber-950/60 dark:text-amber-100"
    >
      <FlaskConical aria-hidden className="size-3.5 shrink-0" />
      <p className="min-w-0 flex-1 leading-snug">{DEMO_BANNER_TEXT}</p>
      {signedIn && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 shrink-0 px-2 text-xs text-current hover:bg-amber-100 dark:hover:bg-amber-900/60"
          onClick={async () => {
            await logout();
            window.location.hash = "#/login";
          }}
        >
          <LogOut className="size-3.5" /> Switch role
        </Button>
      )}
    </div>
  );
}
