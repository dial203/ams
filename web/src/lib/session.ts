import { queryKeys, type AcceptInviteRequest, type LoginRequest } from "@ams/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useApiContext } from "@/lib/api-context";

export function useMe() {
  const { api, tokens } = useApiContext();
  return useQuery({
    queryKey: queryKeys.me(),
    queryFn: ({ signal }) => api.me.get({ signal }),
    enabled: tokens.isAuthenticated(),
    staleTime: 5 * 60_000,
  });
}

export function useLogin() {
  const { api, tokens } = useApiContext();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LoginRequest) => api.auth.login(body),
    onSuccess: async (res) => {
      qc.clear();
      tokens.setPair(res);
    },
  });
}

export function useAcceptInvite() {
  const { api, tokens } = useApiContext();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AcceptInviteRequest) => api.auth.acceptInvite(body),
    onSuccess: (res) => {
      qc.clear();
      tokens.setPair(res);
    },
  });
}

/** Revokes the refresh token (best effort), clears tokens and cached data. */
export function useLogout() {
  const { api, tokens } = useApiContext();
  const qc = useQueryClient();
  return useCallback(async () => {
    const rt = tokens.getRefreshToken();
    if (rt) {
      try {
        await api.auth.logout(rt);
      } catch {
        /* the token may already be expired or revoked */
      }
    }
    tokens.clear();
    qc.clear();
  }, [api, tokens, qc]);
}
