import { useNostr } from '@nostrify/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useNostrStorage } from '@/hooks/useNostrStorage';
import { CAMPAIGN_KIND, parseCampaign, type ParsedCampaign } from '@/lib/campaign';

interface UseCampaignArgs {
  /** Campaign author hex pubkey. */
  pubkey: string;
  /** Campaign `d` tag (slug). */
  identifier: string;
  /** Optional relay hints from the naddr. */
  relays?: string[];
}

/**
 * Fetches a single campaign by its `(pubkey, identifier)` addressable
 * coordinate. Returns the freshest version found across relays, or `null`
 * if the campaign doesn't exist or fails validation.
 *
 * `relays` is currently accepted for future use (e.g. routing the request to
 * relay hints from the originating naddr) but is not yet wired into the
 * default pool. The hook still works without it; relay hints just become
 * a no-op for now.
 */
export function useCampaign({ pubkey, identifier, relays: _relays }: UseCampaignArgs) {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();
  const { store } = useNostrStorage();

  return useQuery({
    queryKey: ['campaign', pubkey, identifier],
    queryFn: async (c): Promise<ParsedCampaign | null> => {
      const filter = {
        kinds: [CAMPAIGN_KIND],
        authors: [pubkey],
        '#d': [identifier],
        limit: 5,
      };

      // Merge the locally cached copy into the relay response. Campaigns are
      // app-critical and always mirrored into the offline store, so a donor
      // who has seen this campaign before can still open it with no relays
      // reachable. The newest-wins reduce below treats the cached revision as
      // just one more candidate, so a live relay copy still wins when fresher.
      const [events, [cachedEvent]] = await Promise.all([
        nostr.query([filter], { signal: c.signal }),
        store.query([filter]),
      ]);

      const candidates = cachedEvent ? [...events, cachedEvent] : events;

      // Monotonic guard: the query cache may already hold a newer revision than
      // this fetch returns — e.g. an edit we just published and seeded via
      // seedDetailCache that a lagging relay hasn't indexed yet. A natural
      // refetch that returns the OLD revision (or nothing) must not regress
      // that fresher cached value. This extends the newest-wins reduce below
      // to treat the current cache as one more revision source.
      const cached = queryClient.getQueryData<ParsedCampaign | null>([
        'campaign',
        pubkey,
        identifier,
      ]);

      if (candidates.length === 0) {
        // Neither relays nor the offline store returned anything — keep
        // whatever we already have (don't blank a freshly-seeded create/edit
        // to a 404) rather than caching `null`.
        return cached ?? null;
      }
      // Pick the newest version in case multiple relays / the store return
      // different revisions.
      const newest = candidates.reduce((latest, current) =>
        current.created_at > latest.created_at ? current : latest,
      );
      // Never regress: if the cache already holds a revision at least as new
      // as the newest candidate, keep the cached one. Once any source serves
      // the seeded edit (created_at >= cached) it flows through normally, so
      // this only blocks stale regressions, never legitimate updates.
      if (cached && cached.createdAt >= newest.created_at) {
        return cached;
      }
      return parseCampaign(newest);
    },
    enabled: !!pubkey && !!identifier,
    staleTime: 30_000,
  });
}
