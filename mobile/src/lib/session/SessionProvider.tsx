import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { isApiError, type AcceptInviteRequest, type ApiClient } from "@ams/shared";
import type { TokenStore } from "../auth/tokens";
import type { Signal } from "../signal";
import { STORAGE_KEYS, type KeyValueStorage } from "../storage";

export type SessionStatus = "loading" | "signedOut" | "signedIn";

export interface SessionContextValue {
  status: SessionStatus;
  /** The last sign-out was forced because the session could not be refreshed. */
  expired: boolean;
  /** Org chosen in the org picker (remembered across launches). */
  storedOrgId: string | null;
  signIn(email: string, password: string): Promise<void>;
  acceptInvite(body: AcceptInviteRequest): Promise<void>;
  signOut(): Promise<void>;
  selectOrg(orgId: string): Promise<void>;
  clearOrg(): Promise<void>;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside <SessionProvider>");
  return value;
}

export interface SessionProviderProps {
  api: ApiClient;
  tokens: TokenStore;
  storage: KeyValueStorage;
  queryClient: QueryClient;
  /** Emitted by the API client when the refresh token is rejected. */
  sessionExpired: Signal;
  /** Runs before the refresh token is revoked, while requests are still authorised (push token removal). */
  beforeSignOut?: () => Promise<void>;
  /** Runs on every sign-out, voluntary or not (health SDK local sign-out). */
  afterSignOut?: () => Promise<void>;
  children: ReactNode;
}

interface State {
  status: SessionStatus;
  expired: boolean;
  storedOrgId: string | null;
}

async function safely(task: (() => Promise<void>) | undefined): Promise<void> {
  if (!task) return;
  try {
    await task();
  } catch {
    // Best effort: sign-out must always complete.
  }
}

export function SessionProvider({
  api,
  tokens,
  storage,
  queryClient,
  sessionExpired,
  beforeSignOut,
  afterSignOut,
  children,
}: SessionProviderProps) {
  const [state, setState] = useState<State>({ status: "loading", expired: false, storedOrgId: null });
  const signingOut = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await tokens.load();
      } catch {
        // Unreadable keychain: treat as signed out.
      }
      const storedOrgId = await storage.getItem(STORAGE_KEYS.orgId).catch(() => null);
      if (!cancelled) {
        setState({ status: tokens.hasSession() ? "signedIn" : "signedOut", expired: false, storedOrgId });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tokens, storage]);

  const endSession = useCallback(
    async (expired: boolean) => {
      await tokens.clear().catch(() => undefined);
      queryClient.clear();
      setState((s) => ({ ...s, status: "signedOut", expired }));
    },
    [tokens, queryClient],
  );

  useEffect(
    () =>
      sessionExpired.subscribe(() => {
        if (signingOut.current) return;
        signingOut.current = true;
        void (async () => {
          await safely(afterSignOut);
          await endSession(true);
          signingOut.current = false;
        })();
      }),
    [sessionExpired, endSession, afterSignOut],
  );

  const startSession = useCallback(
    async (pair: { access_token: string; refresh_token: string }) => {
      queryClient.clear();
      await tokens.set(pair);
      setState((s) => ({ ...s, status: "signedIn", expired: false }));
    },
    [tokens, queryClient],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const res = await api.auth.login({ email: email.trim(), password });
      await startSession(res);
    },
    [api, startSession],
  );

  const acceptInvite = useCallback(
    async (body: AcceptInviteRequest) => {
      const res = await api.auth.acceptInvite(body);
      await startSession(res);
    },
    [api, startSession],
  );

  const signOut = useCallback(async () => {
    if (signingOut.current) return;
    signingOut.current = true;
    try {
      await safely(beforeSignOut);
      const refreshToken = tokens.getRefreshToken();
      if (refreshToken) {
        // `POST /auth/logout` needs a valid access token; if it has expired, rotate once and
        // revoke the new refresh token instead.
        try {
          await api.auth.logout(refreshToken);
        } catch (error) {
          if (isApiError(error) && error.status === 401) {
            try {
              const pair = await api.auth.refresh(refreshToken);
              await tokens.set(pair);
              await api.auth.logout(pair.refresh_token);
            } catch {
              // The refresh token is already unusable; nothing left to revoke.
            }
          }
        }
      }
      await safely(afterSignOut);
      await endSession(false);
    } finally {
      signingOut.current = false;
    }
  }, [api, tokens, endSession, beforeSignOut, afterSignOut]);

  const selectOrg = useCallback(
    async (orgId: string) => {
      setState((s) => ({ ...s, storedOrgId: orgId }));
      await storage.setItem(STORAGE_KEYS.orgId, orgId).catch(() => undefined);
    },
    [storage],
  );

  const clearOrg = useCallback(async () => {
    setState((s) => ({ ...s, storedOrgId: null }));
    await storage.removeItem(STORAGE_KEYS.orgId).catch(() => undefined);
  }, [storage]);

  const value = useMemo<SessionContextValue>(
    () => ({ ...state, signIn, acceptInvite, signOut, selectOrg, clearOrg }),
    [state, signIn, acceptInvite, signOut, selectOrg, clearOrg],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
