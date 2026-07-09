import type { QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * Seed a detail-read query cache with a freshly-signed event (or its parsed
 * form) right after publishing, so navigating to that entity's page renders
 * immediately instead of racing the relays — which have almost certainly not
 * indexed the just-published event yet.
 *
 * **Why this exists — the relay race, and the invalidate footgun.**
 *
 * `nostr.event()` publishes to the write relays but returns without waiting
 * for them to index the event, and without reading it back. If, right after
 * publishing, we `invalidateQueries` the detail key we just seeded, TanStack
 * forces an *immediate* background refetch. That refetch beats the relay: the
 * queryFn re-reads the OLD state (empty for a create → the page 404s; or the
 * previous revision for an edit → the page silently reverts to pre-edit
 * content) and overwrites the value we just seeded. The user sees their
 * change flash in, then vanish, until the relay catches up.
 *
 * The fix — codified here so it can't be re-introduced per call site — is to
 * seed the detail key with {@link QueryClient.setQueryData} and then **not**
 * invalidate that same key. The query's `staleTime` lets a natural refetch
 * reconcile with the relay's canonical view once it has actually indexed the
 * event. This mirrors the optimistic-update pattern in
 * `useCampaignVerifications` and `useNotifications`.
 *
 * List/feed keys are a different matter: they're separate queries, so
 * invalidating them does not clobber this seed. Invalidate those directly at
 * the call site (they *should* refetch so the new/edited entity appears in
 * lists), but never the detail key passed here.
 *
 * For addressable events, a lagging relay could still win a *natural* refetch
 * later and return an older revision. Guard the read query itself with a
 * monotonic `created_at` check (see `useCampaign`) so a stale relay copy can
 * never regress a newer cached revision — the seed and the guard together
 * fully close the window.
 *
 * @param queryClient The TanStack Query client.
 * @param detailKey   The exact query key the detail-page read hook uses.
 * @param value       The freshly-signed event or its parsed representation,
 *                    exactly as the read hook's `queryFn` would return it.
 */
export function seedDetailCache<TValue>(
  queryClient: QueryClient,
  detailKey: QueryKey,
  value: TValue,
): void {
  queryClient.setQueryData<TValue>(detailKey, value);
}
