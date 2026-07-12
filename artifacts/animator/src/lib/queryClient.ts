import { QueryClient } from "@tanstack/react-query";

/** Shared React Query client for the gallery/lobby API hooks. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});
