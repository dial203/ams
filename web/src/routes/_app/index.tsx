import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/")({
  component: () => <div className="p-6">Readiness</div>,
});
