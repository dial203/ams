import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { FullPageSpinner } from "@/components/states";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiContext } from "@/lib/api-context";
import { createAuthedApiClient, createTokenStore } from "@/lib/auth";
import { apiBaseUrl } from "@/lib/config";
import { createQueryClient } from "@/lib/query";
import { ThemeProvider } from "@/lib/theme";
import { routeTree } from "./routeTree.gen";
import "./index.css";

const queryClient = createQueryClient();
const tokens = createTokenStore();

const router = createRouter({
  routeTree,
  context: { queryClient, tokens },
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
  defaultPendingComponent: FullPageSpinner,
});

const api = createAuthedApiClient({
  baseUrl: apiBaseUrl(),
  store: tokens,
  onLogout: () => {
    queryClient.clear();
    const here = router.state.location;
    if (here.pathname !== "/login" && here.pathname !== "/accept-invite") {
      void router.navigate({ to: "/login", search: { redirect: here.href } });
    }
  },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <ApiContext.Provider value={{ api, tokens }}>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <RouterProvider router={router} />
          </TooltipProvider>
        </QueryClientProvider>
      </ApiContext.Provider>
    </ThemeProvider>
  </StrictMode>,
);
