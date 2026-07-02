import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { CAMPAIGN_KIND } from '@/lib/campaign';

interface UseCampaignTombstoneArgs {
  /** Campaign author hex pubkey from the decoded naddr. */
  pubkey: string;
  /** Campaign `d` tag (slug) from the decoded naddr. */
  identifier: string;
  /**
   * Only run once the primary campaign query has settled to "not found" —
   * this hook exists solely to decide between a 404 and a tombstone.
   */
  enabled: boolean;
}

export interface CampaignTombstoneData {
  /** Kind 8333 donation receipts referencing the deleted coordinate, newest first. */
  receipts: NostrEvent[];
  /**
   * The author's own NIP-09 deletion request for this coordinate, if any
   * relay still serves it. Gives the tombstone a "removed on {date}" line.
   * `null` when no kind 5 was found (relays may have pruned it, or the
   * campaign simply never existed).
   */
  deletion: NostrEvent | null;
}

/**
 * Archive lookup for a campaign coordinate that no longer resolves to a
 * kind 33863 event (deleted via NIP-09, or dropped by relays).
 *
 * Per NIP.md, historical kind 8333 receipts MAY still be rendered against a
 * deleted campaign coordinate so donors can find their past donations. This
 * hook fetches, in a single relay round-trip:
 *
 *  1. kind 8333 receipts tagging the `33863:<pubkey>:<d>` coordinate, and
 *  2. the author's own kind 5 deletion request for it (filtered by
 *     `authors` — anyone can publish a kind 5 with an arbitrary `a` tag,
 *     but only the author's is meaningful).
 *
 * If receipts exist, the caller renders a read-only tombstone ledger
 * instead of a 404, preserving the public donation record in the client.
 * With zero receipts but an authored deletion, the caller still renders
 * a tombstone notice ("removed on {date}") — the kind 5 proves the
 * campaign existed and was deliberately taken down, which is more useful
 * than a generic 404.
 */
export function useCampaignTombstone({ pubkey, identifier, enabled }: UseCampaignTombstoneArgs) {
  const { nostr } = useNostr();
  const aTag = `${CAMPAIGN_KIND}:${pubkey}:${identifier}`;

  return useQuery({
    queryKey: ['campaign-tombstone', pubkey, identifier],
    queryFn: async (c): Promise<CampaignTombstoneData> => {
      const events = await nostr.query(
        [
          { kinds: [8333], '#a': [aTag], limit: 500 },
          { kinds: [5], authors: [pubkey], '#a': [aTag], limit: 5 },
        ],
        { signal: c.signal },
      );

      const receipts = events
        .filter((e) => e.kind === 8333)
        .sort((a, b) => b.created_at - a.created_at);

      const deletions = events.filter((e) => e.kind === 5);
      const deletion = deletions.length > 0
        ? deletions.reduce((latest, current) => (current.created_at > latest.created_at ? current : latest))
        : null;

      return { receipts, deletion };
    },
    enabled: enabled && !!pubkey && !!identifier,
    staleTime: 60_000,
  });
}
