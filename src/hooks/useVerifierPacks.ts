import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';

import {
  FOLLOW_PACK_KIND,
  VERIFIER_FOLLOW_PACKS,
} from '@/lib/agoraDefaults';

/**
 * Live union of the `p`-tag members of the two curator follow packs
 * ({@link VERIFIER_FOLLOW_PACKS}) — World Liberty Congress Verified and
 * Team Soapbox. A verification signed by any of these pubkeys promotes a
 * campaign into the home page's **Verified Campaigns** section.
 *
 * **Trust model.** The relay query pins `authors:` to the pack author
 * (Team Soapbox admin) and `#d:` to the two pack identifiers, so a kind
 * 39089 with the same `d` published by anyone else can never widen the
 * verifier set. This mirrors the moderator / list-curator trust gates
 * elsewhere in the app.
 *
 * Unlike `useCampaignModerators` (a hardcoded snapshot on the critical
 * path), the verifier set only gates a *secondary ordering* concern — the
 * home page still renders without it — so we fetch it live rather than
 * baking a snapshot into code that would drift as the packs change.
 */
export function useVerifierPacks() {
  const { nostr } = useNostr();

  const authors = [...new Set(VERIFIER_FOLLOW_PACKS.map((p) => p.pubkey))];
  const identifiers = VERIFIER_FOLLOW_PACKS.map((p) => p.identifier);

  return useQuery({
    queryKey: ['verifier-packs', authors.join(','), identifiers.join(',')],
    queryFn: async ({ signal }): Promise<Set<string>> => {
      const events = await nostr.query(
        [
          {
            kinds: [FOLLOW_PACK_KIND],
            authors,
            '#d': identifiers,
            limit: 100,
          },
        ],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) },
      );

      // Keep only the newest event per (author, d), then union their `p`
      // tags. `VERIFIER_FOLLOW_PACKS` is the allowlist of (pubkey, d) pairs
      // we accept — an event whose coordinate isn't in it is ignored even
      // if it slipped past the relay filter.
      const wanted = new Set(
        VERIFIER_FOLLOW_PACKS.map((p) => `${p.pubkey}:${p.identifier}`),
      );
      const newestByCoord = new Map<string, typeof events[number]>();
      for (const event of events) {
        const d = event.tags.find((t) => t[0] === 'd')?.[1] ?? '';
        const coord = `${event.pubkey}:${d}`;
        if (!wanted.has(coord)) continue;
        const prev = newestByCoord.get(coord);
        if (!prev || event.created_at > prev.created_at) {
          newestByCoord.set(coord, event);
        }
      }

      const members = new Set<string>();
      for (const event of newestByCoord.values()) {
        for (const tag of event.tags) {
          if (tag[0] === 'p' && tag[1]) members.add(tag[1]);
        }
      }
      return members;
    },
    staleTime: 60_000,
  });
}
