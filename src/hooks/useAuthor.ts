import { type NostrEvent, type NostrMetadata, NSchema as n } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useCacheFirstSeed } from '@/hooks/useCacheFirstSeed';
import { useNostrStorage } from '@/hooks/useNostrStorage';
import { getProfileCached, setProfileCached } from '@/lib/profileCache';

export type AuthorResult = { event?: NostrEvent; metadata?: NostrMetadata };

/** Parse a kind-0 event into metadata + event, or return just the event on parse failure. */
export function parseAuthorEvent(event: NostrEvent): { event: NostrEvent; metadata?: NostrMetadata } {
  try {
    const metadata = n.json().pipe(n.metadata()).parse(event.content);
    return { metadata, event };
  } catch {
    return { event };
  }
}

/** Entries older than this are not trusted at all — show a skeleton instead. */
const MAX_CACHE_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Cache-first profile hook.
 *
 * Being a replaceable event (kind 0), a profile only ever has one canonical
 * version, so the read strategy is cache-first (not merge): render whatever we
 * have locally, then let the network overwrite it with something newer.
 *
 * Two cache layers cooperate:
 *
 *   1. `profileCache` — a synchronous in-memory mirror seeded as TanStack
 *      `initialData`, so the very first render already has data without a
 *      microtask hop.
 *   2. `useNostrStorage` (NIndexedDB) — the offline event store the
 *      NostrBatcher mirrors into. `useCacheFirstSeed` paints it in on mount,
 *      and the query's relay-miss branch falls back to it so a profile we
 *      already hold is never blanked when relays return nothing.
 */
export function useAuthor(pubkey: string | undefined) {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();
  const { store } = useNostrStorage();

  // Read the synchronous in-memory cache so TanStack Query can skip pending.
  const cached = pubkey ? getProfileCached(pubkey) : undefined;

  // Discard entries that are too old to trust.
  const usableCache = cached && (Date.now() - cached.lastFetched < MAX_CACHE_AGE) ? cached : undefined;

  // Seed the query from the IndexedDB event store so a known profile renders
  // immediately, without waiting on the network. Never downgrades a newer entry.
  useCacheFirstSeed<AuthorResult>({
    queryKey: pubkey ? ['author', pubkey] : undefined,
    filter: { kinds: [0], authors: pubkey ? [pubkey] : [] },
    toData: parseAuthorEvent,
    getEvent: (data) => data.event,
  });

  return useQuery<AuthorResult>({
    queryKey: ['author', pubkey ?? ''],
    queryFn: async ({ signal }) => {
      if (!pubkey) {
        return {};
      }

      const [event] = await nostr.query(
        [{ kinds: [0], authors: [pubkey], limit: 1 }],
        { signal },
      );

      if (!event) {
        // Relay returned nothing — never discard a profile we already have:
        // fall back to the query cache, then the locally cached event.
        const existing = queryClient.getQueryData<AuthorResult>(['author', pubkey]);
        if (existing?.event) return existing;
        const [stored] = await store.query([{ kinds: [0], authors: [pubkey] }]);
        if (stored) return parseAuthorEvent(stored);
        return {};
      }

      // Never downgrade to an older profile than one we already hold. Prefer
      // the newest of {relay result, query cache, local store}.
      const existing = queryClient.getQueryData<AuthorResult>(['author', pubkey]);
      const [stored] = await store.query([{ kinds: [0], authors: [pubkey] }]);
      let newest = event;
      if (existing?.event && existing.event.created_at > newest.created_at) newest = existing.event;
      if (stored && stored.created_at > newest.created_at) newest = stored;

      const parsed = parseAuthorEvent(newest);

      // Persist the fresh relay event to both caches (fire-and-forget). The
      // NostrBatcher already mirrors it into NIndexedDB via `shouldCache`, so
      // we only need to update the synchronous in-memory mirror here.
      void setProfileCached(event, parseAuthorEvent(event).metadata);

      return parsed;
    },
    enabled: !!pubkey,
    staleTime: 5 * 60 * 1000,   // 5 minutes
    gcTime: 10 * 60 * 1000,     // 10 minutes
    retry: 1,

    // Seed from the synchronous in-memory cache so the first render already
    // has data. Uses the pre-parsed metadata to avoid re-running Zod on every
    // render. TanStack Query compares initialDataUpdatedAt against staleTime:
    //   - < 5 min old → fresh, no network request
    //   - 5 min – 7 d → renders cached value, background refetch
    //   - > 7 d       → usableCache is undefined, normal pending/skeleton
    ...(usableCache
      ? {
        initialData: { event: usableCache.event, metadata: usableCache.metadata },
        initialDataUpdatedAt: usableCache.lastFetched,
      }
      : {}),
  });
}
