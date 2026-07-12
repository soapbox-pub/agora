import { useMemo } from 'react';
import { useParams } from 'react-router-dom';

import { CampaignDetailPage, CampaignDetailSkeleton } from '@/pages/CampaignDetailPage';
import NotFound from '@/pages/NotFound';
import { useCampaignByNip05 } from '@/hooks/useCampaignByNip05';
import { normalizeCampaignNip05 } from '@/lib/campaign';
import { AGORA_HOST } from '@/lib/appUrls';

/**
 * Resolver page for pretty campaign URLs of the form
 * `/{nip05}/{d-tag}` — e.g. `/alex@gleasonator.com/help-me-fund-dev`.
 *
 * The `:nip05` segment is normalized by {@link normalizeCampaignNip05},
 * which expands the app's short-URL conveniences:
 * - `fiatjaf.com` → `_@fiatjaf.com` (bare domain → root user)
 * - `mk` → `mk@agora.spot` (bare local name → the app's own domain)
 * - `alex@gleasonator.com` → unchanged
 *
 * Once the NIP-05 resolves to a hex pubkey, the resolved
 * `(pubkey, d-tag)` is handed straight to {@link CampaignDetailPage},
 * which owns all campaign loading, tombstone, and 404 handling. A failed
 * NIP-05 resolution (unknown domain / name) renders the 404 page.
 */
export function CampaignByNip05Page() {
  const { nip05, dtag } = useParams<{ nip05: string; dtag: string }>();

  const normalized = useMemo(
    () => normalizeCampaignNip05(nip05, AGORA_HOST),
    [nip05],
  );

  const { data: campaign, pubkey, isLoading, isError } = useCampaignByNip05(
    normalized,
    dtag,
  );

  if (isLoading) return <CampaignDetailSkeleton />;

  // NIP-05 didn't resolve to a pubkey, or the campaign coordinate had no
  // live event and no donation tombstone — either way there's nothing to
  // show at this pretty URL.
  if (isError || !pubkey || !dtag) return <NotFound />;

  // Hand the resolved coordinate to the canonical detail page. It re-runs
  // useCampaign (served from cache — useCampaignByNip05 already primed it)
  // and handles its own skeleton / tombstone / 404 states.
  return (
    <CampaignDetailPage
      pubkey={pubkey}
      identifier={dtag}
      // Reuse the already-fetched campaign as a hint via the cache; the
      // detail page's useCampaign shares the same query key.
      key={campaign?.aTag ?? `${pubkey}:${dtag}`}
    />
  );
}

export default CampaignByNip05Page;
