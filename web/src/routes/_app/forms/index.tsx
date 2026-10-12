import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/forms/")({
  component: () => <div className="p-6">Forms</div>,
});
