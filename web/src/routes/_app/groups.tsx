import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/groups")({
  component: () => <div className="p-6">Groups</div>,
});
