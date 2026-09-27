import { QueryClient } from "@tanstack/react-query";

// Single QueryClient: main.jsx provides it, authStore clears it on sign-out /
// expiry so no data from one account survives into the next session.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30000,
    },
  },
});

export default queryClient;
