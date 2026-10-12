import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/metrics")({
  component: () => <div className="p-6">Metrics</div>,
});
