import { useMemo } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';

import { CampaignCard } from '@/components/CampaignCard';
import { parseCampaign } from '@/lib/campaign';
import { cn } from '@/lib/utils';

interface EmbeddedCampaignProps {
  /** The fetched kind 33863 campaign event. */
  event: NostrEvent;
  className?: string;
}

/**
 * Embedded preview for a kind 33863 campaign referenced by a `nostr:naddr`
 * (or an `agora.spot/<naddr>` link rewritten to one).  Renders the same
 * {@link CampaignCard} used across the rest of the site so an attached
 * campaign in a note looks identical to a campaign card in a grid —
 * banner, title, story, progress bar / private notice, and creator byline.
 *
 * Falls back to `null` when the event fails campaign validation; the caller
 * (`EmbeddedNaddr`) then renders its generic naddr card instead.
 */
export function EmbeddedCampaign({ event, className }: EmbeddedCampaignProps) {
  const campaign = useMemo(() => parseCampaign(event), [event]);
  if (!campaign) return null;

  return (
    <div
      // Cap the width to match a small homepage campaign card (a quarter of
      // the max-w-7xl grid ≈ 290px) so an attached campaign reads as a
      // compact card, not a full-width banner stretching the whole note.
      className={cn('not-prose w-full max-w-[300px]', className)}
      // Stop clicks from bubbling to an enclosing clickable note card
      // (feed items navigate on their own onClick). The CampaignCard's inner
      // <Link> handles navigation to the campaign page itself.
      onClick={(e) => e.stopPropagation()}
    >
      <CampaignCard
        campaign={campaign}
        variant="compact"
        // Embedded inside a note — the surrounding note already carries the
        // moderation surface, so suppress the per-card moderator kebab to
        // avoid a redundant menu floating over the banner.
        showModerationMenu={false}
      />
    </div>
  );
}
