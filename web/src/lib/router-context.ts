import type { QueryClient } from "@tanstack/react-query";
import type { TokenStore } from "@/lib/auth";

export interface RouterContext {
  queryClient: QueryClient;
  tokens: TokenStore;
}
