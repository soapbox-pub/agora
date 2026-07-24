import { useQuery } from '@tanstack/react-query';

import { fetchUserCountry } from '@/lib/geo';

/**
 * Resolves the user's ISO 3166-1 alpha-2 country from their IP, for soft
 * region hints only (never for trust or gating). Returns `undefined` while
 * loading or when detection fails — callers should treat that as "unknown"
 * and show everything.
 *
 * The lookup hits a third-party endpoint, so it stays disabled until
 * `enabled` is true (pass the open state of the surface that needs it). The
 * result is cached for the whole session — a user's country doesn't change
 * mid-visit, and there's no reason to re-expose their IP.
 */
export function useUserCountry(enabled = true) {
  return useQuery({
    queryKey: ['user-country'],
    queryFn: ({ signal }) => fetchUserCountry(signal),
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });
}
