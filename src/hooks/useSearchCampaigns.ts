import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';

import { DITTO_RELAYS } from '@/lib/appRelays';
import { useDebounce } from '@/hooks/useDebounce';
import { CAMPAIGN_KIND, parseCampaign, type ParsedCampaign } from '@/lib/campaign';

/**
 * NIP-50 search over kind 33863 campaigns for the compose `@` autocomplete.
 *
 * ## Prefix matching via `autocomplete:true`
 *
 * relay.ditto.pub's default NIP-50 index only matches **whole words** — a
 * partial word returns nothing (`"wome"` → 0 results; only the completed
 * `"women"` matches). Autocomplete queries partial words on every keystroke,
 * so a plain `search` comes back empty until the user finishes a word, which
 * reads as "campaigns never show up".
 *
 * The NIP-50 `autocomplete:true` extension switches the relay into
 * prefix-matching mode (`"wome autocomplete:true"` → 3 results), which is
 * exactly what a type-ahead needs. We append it to the search token so every
 * keystroke returns prefix matches.
 *
 * Results are deduped to the newest revision per `(pubkey, d)` coordinate,
 * parsed/validated through {@link parseCampaign} (invalid campaigns are
 * dropped), and capped to a short list suitable for a dropdown.
 */
export function useSearchCampaigns(query: string, limit = 6) {
  const { nostr } = useNostr();
  const debouncedQuery = useDebounce(query, 200);
  const trimmed = debouncedQuery.trim();

  return useQuery<ParsedCampaign[]>({
    queryKey: ['search-campaigns', trimmed, limit],
    enabled: trimmed.length >= 1,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
    queryFn: async ({ signal }) => {
      const group = nostr.group(DITTO_RELAYS);
      const events = await group.query(
        // `autocomplete:true` enables prefix matching so partial words (every
        // keystroke) return results instead of only completed words.
        [{ kinds: [CAMPAIGN_KIND], search: `${trimmed} autocomplete:true`, limit: 40 }],
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
        results.push(campaign);
      }

      // Prefer title-prefix matches, then title matches, then everything
      // else; newest first within each tier.
      results.sort((a, b) => {
        const rank = (c: ParsedCampaign) => {
          const title = c.title.toLowerCase();
          if (title.startsWith(keyword)) return 0;
          if (title.includes(keyword)) return 1;
          return 2;
        };
        const ra = rank(a);
        const rb = rank(b);
        if (ra !== rb) return ra - rb;
        return b.createdAt - a.createdAt;
      });

      return results.slice(0, limit);
    },
  });
}
