import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';

import { useNostrStorage } from '@/hooks/useNostrStorage';
import { CAMPAIGN_KIND, parseCampaign, type ParsedCampaign } from '@/lib/campaign';

interface UseCampaignBySlugArgs {
  /** The campaign's `d`-tag slug, parsed out of the pretty URL. */
  slug: string;
  /** Leading hex characters of the author pubkey (disambiguator). */
  shortId: string;
  enabled?: boolean;
}

/**
 * Resolves a pretty campaign URL (`/campaigns/<slug>-<shortId>`) to a
 * concrete campaign.
 *
 * A slug alone is not globally unique on Nostr — any author can publish a
 * campaign with the same `d` tag — so we query every campaign carrying
 * that exact slug and pick the one whose pubkey starts with `shortId`.
 * With a 6-hex-char short-id and same-slug competition only, a collision
 * is astronomically unlikely; in the pathological case where two matches
 * share the prefix, we return the newest so the link still resolves to a
 * real campaign rather than 404ing.
 *
 * The offline store is merged in the same way `useCampaign` does, so a
 * previously-seen campaign still opens with no relays reachable.
 */
export function useCampaignBySlug({ slug, shortId, enabled = true }: UseCampaignBySlugArgs) {
  const { nostr } = useNostr();
  const { store } = useNostrStorage();

  return useQuery({
    queryKey: ['campaign-by-slug', slug, shortId],
    queryFn: async (c): Promise<ParsedCampaign | null> => {
      const filter = {
        kinds: [CAMPAIGN_KIND],
        '#d': [slug],
        // A slug can be shared by a handful of authors at most; cap the
        // fan-out so a griefer republishing the same slug can't blow up
        // the response.
        limit: 50,
      };

      const [events, cached] = await Promise.all([
        nostr.query([filter], { signal: c.signal }),
        store.query([filter]),
      ]);

      const prefix = shortId.toLowerCase();
      const matches = [...events, ...cached].filter(
        (e) => e.pubkey.toLowerCase().startsWith(prefix),
      );
      if (matches.length === 0) return null;

      // Newest-wins: dedupes revisions of the same campaign and, in the
      // unlikely event two different authors share both slug and prefix,
      // still yields a valid campaign to render.
      const newest = matches.reduce((latest, current) =>
        current.created_at > latest.created_at ? current : latest,
      );
      return parseCampaign(newest);
    },
    enabled: enabled && !!slug && !!shortId,
    staleTime: 30_000,
  });
}
