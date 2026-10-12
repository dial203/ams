import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/athletes/$athleteId")({
  component: () => <div className="p-6">Athlete</div>,
});
