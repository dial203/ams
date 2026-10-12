import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/forms/$formId")({
  component: () => <div className="p-6">Form</div>,
});
