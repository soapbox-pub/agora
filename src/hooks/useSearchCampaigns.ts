import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';

import { DITTO_RELAYS } from '@/lib/appRelays';
import { useDebounce } from '@/hooks/useDebounce';
import { CAMPAIGN_KIND, parseCampaign, type ParsedCampaign } from '@/lib/campaign';

/**
 * NIP-50 search over kind 33863 campaigns for the compose `@` autocomplete.
 *
 * Campaigns keep their human-readable label in the `title` tag rather than
 * `content`, and most NIP-50 relays only match `content`. We therefore ask
 * the search-capable Ditto relay group for candidate campaigns and then
 * re-filter client-side against the title/summary tags so typing part of a
 * campaign name surfaces it even when the relay's index missed it.
 *
 * Results are deduped to the newest revision per `(pubkey, d)` coordinate,
 * parsed/validated through {@link parseCampaign} (invalid campaigns are
 * dropped), and capped to a short list suitable for a dropdown.
 */
export function useSearchCampaigns(query: string, limit = 6) {
  const { nostr } = useNostr();
  const debouncedQuery = useDebounce(query, 300);
  const trimmed = debouncedQuery.trim();

  return useQuery<ParsedCampaign[]>({
    queryKey: ['search-campaigns', trimmed, limit],
    enabled: trimmed.length >= 1,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
    queryFn: async ({ signal }) => {
      const group = nostr.group(DITTO_RELAYS);
      const events = await group.query(
        [{ kinds: [CAMPAIGN_KIND], search: trimmed, limit: 40 }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]) },
      );

      // Dedupe to the newest revision per (pubkey, d) coordinate.
      const latestByCoord = new Map<string, typeof events[number]>();
      for (const event of events) {
        const d = event.tags.find(([n]) => n === 'd')?.[1];
        if (!d) continue;
        const key = `${event.pubkey}:${d}`;
        const prev = latestByCoord.get(key);
        if (!prev || event.created_at > prev.created_at) {
          latestByCoord.set(key, event);
        }
      }

      const keyword = trimmed.toLowerCase();
      const results: ParsedCampaign[] = [];
      for (const event of latestByCoord.values()) {
        const campaign = parseCampaign(event);
        if (!campaign) continue;
        // Client-side keyword match against the fields the relay's `content`
        // index tends to miss (title/summary live in tags).
        const haystack = `${campaign.title} ${campaign.summary} ${campaign.story}`.toLowerCase();
        if (!haystack.includes(keyword)) continue;
        results.push(campaign);
      }

      // Newest campaigns first, then trim to the dropdown limit.
      results.sort((a, b) => b.createdAt - a.createdAt);
      return results.slice(0, limit);
    },
  });
}
