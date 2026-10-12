import { createRootRouteWithContext, Link, Outlet } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import type { RouterContext } from "@/lib/router-context";

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
  notFoundComponent: NotFound,
});

function RootComponent() {
  return (
    <>
      <Outlet />
      <Toaster />
    </>
  );
}

function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 p-6 text-center">
      <div className="text-sm font-medium">Page not found</div>
      <Link to="/" className="text-sm text-brand hover:underline">
        Go to the readiness board
      </Link>
    </div>
  );
}
