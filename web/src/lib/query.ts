import { isApiError } from "@ams/shared";
import { QueryClient } from "@tanstack/react-query";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // 4xx are final; 503 means "not configured" for Open Wearables endpoints.
          if (isApiError(error) && ((error.status >= 400 && error.status < 500) || error.status === 503)) return false;
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}
