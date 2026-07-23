import { useEffect, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { nip19 } from 'nostr-tools';
import type { AddressPointer } from 'nostr-tools/nip19';

import { CampaignCard, CampaignCardSkeleton } from '@/components/CampaignCard';
import { useCampaign } from '@/hooks/useCampaign';
import { CAMPAIGN_KIND } from '@/lib/campaign';

/**
 * Standalone, chrome-less campaign card for third-party embedding.
 *
 * Rendered at `/embed/campaign/:nip19` (an `naddr1…` pointing at a kind
 * {@link CAMPAIGN_KIND} event) *outside* the app's `FundraiserLayout`, so it
 * ships no top nav, footer, or side rails — just the {@link CampaignCard} a
 * host site drops into an `<iframe>`. The snippet is produced by the
 * "Copy embeddable widget" action in a campaign's overflow menu.
 *
 * Two embed-specific behaviours layer on top of the normal card:
 *
 * 1. **Break out of the frame.** The card's internal `<Link>` would navigate
 *    *inside* the iframe; instead we capture the click and open the campaign
 *    on Agora in a new top-level tab.
 * 2. **Report height.** A `ResizeObserver` posts the content height to the
 *    parent window (`{ type: 'agora:embed:height' }`) so a host-side loader
 *    can auto-size the iframe. Harmless when no parent is listening.
 */
export function EmbedCampaignPage() {
  const { t } = useTranslation();
  const { nip19: identifier } = useParams<{ nip19: string }>();
  const containerRef = useRef<HTMLDivElement>(null);

  const addr = useMemo<AddressPointer | null>(() => {
    if (!identifier) return null;
    try {
      const decoded = nip19.decode(identifier);
      if (decoded.type !== 'naddr') return null;
      const data = decoded.data as AddressPointer;
      if (data.kind !== CAMPAIGN_KIND) return null;
      return data;
    } catch {
      return null;
    }
  }, [identifier]);

  const { data: campaign, isLoading } = useCampaign({
    pubkey: addr?.pubkey ?? '',
    identifier: addr?.identifier ?? '',
    relays: addr?.relays,
  });

  // Report content height to a host-side embed loader so it can size the
  // iframe to fit. Runs regardless of whether a parent is listening.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const post = () => {
      const height = Math.ceil(el.getBoundingClientRect().height);
      window.parent?.postMessage({ type: 'agora:embed:height', height }, '*');
    };

    const observer = new ResizeObserver(post);
    observer.observe(el);
    post();
    return () => observer.disconnect();
  }, [campaign]);

  // Intercept the card's internal navigation and open the campaign on Agora
  // in a new top-level tab, so a click inside the iframe doesn't replace the
  // widget with a client-side route render.
  const handleOpenInNewTab = (e: React.MouseEvent) => {
    if (!identifier) return;
    e.preventDefault();
    const url = `${window.location.origin}/${identifier}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="min-h-dvh w-full bg-transparent p-3">
      <div ref={containerRef} className="mx-auto w-full max-w-[420px]">
        {addr === null ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {t('embedCampaign.notFound')}
          </div>
        ) : isLoading && !campaign ? (
          <CampaignCardSkeleton variant="compact" />
        ) : !campaign ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {t('embedCampaign.notFound')}
          </div>
        ) : (
          <div onClickCapture={handleOpenInNewTab}>
            <CampaignCard campaign={campaign} variant="compact" showModerationMenu={false} />
          </div>
        )}
      </div>
    </div>
  );
}

export default EmbedCampaignPage;
