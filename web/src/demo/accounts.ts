/** The demo logins (`seed-demo` in the API) and what each one sees. */
import type { DemoAccount } from "@/lib/demo-mode";
import type { DemoRole } from "./fixture";

export const DEMO_PASSWORD = "demo-password-change-me";

export const DEMO_ACCOUNTS: readonly (DemoAccount & { role: DemoRole })[] = [
  {
    role: "owner",
    label: "Owner",
    email: "admin@example.com",
    password: DEMO_PASSWORD,
    description: "Everything: all 16 athletes, medical and research forms, settings, members and imports.",
  },
  {
    role: "coach",
    label: "Coach",
    email: "coach@example.com",
    password: DEMO_PASSWORD,
    description: "The Athletics squad with names; general forms only, no medical or research data.",
  },
  {
    role: "medic",
    label: "Medical",
    email: "medic@example.com",
    password: DEMO_PASSWORD,
    description: "The Athletics squad plus medical forms such as injury reports.",
  },
  {
    role: "researcher",
    label: "Blinded researcher",
    email: "researcher@example.com",
    password: DEMO_PASSWORD,
    description: "Only the six Pilot Study participants, by code; names, emails and birth dates stay hidden.",
  },
  {
    role: "athlete",
    label: "Athlete",
    email: "athlete@example.com",
    password: DEMO_PASSWORD,
    description: "Maya's own view on the web: her submissions and a pointer to the mobile app.",
  },
];

export function roleForEmail(email: string): DemoRole | null {
  return DEMO_ACCOUNTS.find((a) => a.email === email.trim().toLowerCase())?.role ?? null;
}
