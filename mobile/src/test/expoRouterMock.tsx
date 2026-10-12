/* Minimal stand-in for `expo-router` in component tests (see jest.setup.tsx). */
import type { ReactNode } from "react";

export const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  navigate: jest.fn(),
  dismiss: jest.fn(),
  canGoBack: jest.fn(() => true),
  setParams: jest.fn(),
};

export const mockNavigation = {
  setOptions: jest.fn(),
  dispatch: jest.fn(),
  addListener: jest.fn(() => () => undefined),
  goBack: jest.fn(),
};

let params: Record<string, string> = {};

export function setMockParams(next: Record<string, string>): void {
  params = next;
}

export const router = mockRouter;
export const useRouter = () => mockRouter;
export const useNavigation = () => mockNavigation;
export const useLocalSearchParams = () => params;
export const useGlobalSearchParams = () => params;
export const useSegments = () => [];
export const usePathname = () => "/";
export const useFocusEffect = () => undefined;

function Passthrough({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

export const Stack = Object.assign(Passthrough, { Screen: () => null, Protected: Passthrough });
export const SplashScreen = { preventAutoHideAsync: jest.fn(async () => true), hideAsync: jest.fn(async () => true) };
