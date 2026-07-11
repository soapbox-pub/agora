import { useParams } from 'react-router-dom';

import { CampaignDetailPage, CampaignDetailSkeleton } from './CampaignDetailPage';
import NotFound from './NotFound';
import { useCampaignBySlug } from '@/hooks/useCampaignBySlug';
import { parseCampaignSlugId } from '@/lib/campaign';

/**
 * Resolver for the pretty campaign URL `/campaigns/:slugId`, where
 * `:slugId` is `<slug>-<6 hex of pubkey>` (see `campaignPrettyPath`).
 *
 * The slug alone can't be trusted to identify a campaign — slugs aren't
 * globally unique on Nostr — so this page resolves the `(slug, pubkey
 * prefix)` pair to a concrete author pubkey, then hands off to the
 * regular {@link CampaignDetailPage}, which re-fetches by the exact
 * `(pubkey, identifier)` coordinate and owns loading / tombstone / 404
 * handling from there.
 */
export function CampaignSlugPage() {
  const { slugId } = useParams<{ slugId: string }>();
  const parsed = slugId ? parseCampaignSlugId(slugId) : null;

  const { data: campaign, isLoading, isError } = useCampaignBySlug({
    slug: parsed?.slug ?? '',
    shortId: parsed?.shortId ?? '',
    enabled: !!parsed,
  });

  // Malformed path (no trailing `-<hex>` short-id) — nothing to resolve.
  if (!parsed) return <NotFound />;

  if (isLoading) return <CampaignDetailSkeleton />;

  // No campaign carries this slug + pubkey prefix. Fall through to the
  // detail page anyway would 404 without an author, so surface NotFound
  // directly here.
  if (isError || !campaign) return <NotFound />;

  return (
    <CampaignDetailPage pubkey={campaign.pubkey} identifier={campaign.identifier} />
  );
}

export default CampaignSlugPage;
