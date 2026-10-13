/**
 * Demo build (`VITE_DEMO=1`) hooks. The demo code itself lives in `src/demo` and is loaded
 * with a dynamic import only in demo builds; normal builds render with this context unset.
 */
import { createContext, useContext } from "react";

export interface DemoAccount {
  label: string;
  email: string;
  password: string;
  /** One line on what this login sees. */
  description: string;
}

export interface DemoMode {
  accounts: readonly DemoAccount[];
}

export const DemoModeContext = createContext<DemoMode | null>(null);

/** The demo settings in a demo build, otherwise null. */
export function useDemoMode(): DemoMode | null {
  return useContext(DemoModeContext);
}
