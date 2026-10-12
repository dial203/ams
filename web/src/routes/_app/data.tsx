import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/data")({
  component: () => <div className="p-6">Data</div>,
});
