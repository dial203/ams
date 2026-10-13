import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { createRouter, RouterProvider, type RouterHistory } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { FullPageSpinner } from "@/components/states";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiContext } from "@/lib/api-context";
import { createAuthedApiClient, createTokenStore, type TokenStore } from "@/lib/auth";
import { apiBaseUrl } from "@/lib/config";
import { DemoModeContext } from "@/lib/demo-mode";
import { createQueryClient } from "@/lib/query";
import { ThemeProvider } from "@/lib/theme";
import { routeTree } from "./routeTree.gen";
import "./index.css";

/** `VITE_DEMO=1` builds the in-browser demo (src/demo); the flag is constant, so normal builds drop that code. */
const DEMO = import.meta.env.VITE_DEMO === "1";

function createAppRouter(queryClient: QueryClient, tokens: TokenStore, history?: RouterHistory) {
  return createRouter({
    routeTree,
    context: { queryClient, tokens },
    ...(history ? { history } : {}),
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
    defaultPendingComponent: FullPageSpinner,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}

async function start() {
  // Demo: fake API in the browser, hash routing (static hosting at any path), banner, role sign-in.
  const demo = DEMO ? (await import("./demo")).setupDemo() : null;

  const queryClient = createQueryClient();
  const tokens = createTokenStore();
  const router = createAppRouter(queryClient, tokens, demo?.history);

  const api = createAuthedApiClient({
    baseUrl: demo ? demo.apiBase : apiBaseUrl(),
    ...(demo ? { fetch: demo.fetch } : {}),
    store: tokens,
    onLogout: () => {
      queryClient.clear();
      const here = router.state.location;
      if (here.pathname !== "/login" && here.pathname !== "/accept-invite") {
        void router.navigate({ to: "/login", search: { redirect: here.href } });
      }
    },
  });

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ThemeProvider>
        <ApiContext.Provider value={{ api, tokens }}>
          <DemoModeContext.Provider value={demo ? demo.mode : null}>
            <QueryClientProvider client={queryClient}>
              <TooltipProvider>
                {demo && <demo.Banner />}
                <RouterProvider router={router} />
              </TooltipProvider>
            </QueryClientProvider>
          </DemoModeContext.Provider>
        </ApiContext.Provider>
      </ThemeProvider>
    </StrictMode>,
  );
}

void start();
