import { useAuthor } from '@/hooks/useAuthor';
import { useNip05Verify } from '@/hooks/useNip05Verify';
import { getCampaignUrl, type ParsedCampaign } from '@/lib/campaign';

/**
 * Resolve the canonical link path for a campaign, preferring the pretty
 * `/{nip05}/{d-tag}` form when the author has a **verified** NIP-05.
 *
 * Fetches the author's kind-0 metadata and verifies its `nip05` resolves
 * back to the campaign author's pubkey. Only then does it emit the pretty
 * path; otherwise (unverified, missing, still loading, or mismatched) it
 * falls back to the addressable `naddr1…` path so a spoofed NIP-05 can
 * never redirect a campaign link. See {@link getCampaignUrl}.
 *
 * The returned path is always safe to render immediately — the naddr
 * fallback is available on the first render, and the URL upgrades to the
 * pretty form once verification completes.
 */
export function useCampaignUrl(campaign: ParsedCampaign): string {
  const author = useAuthor(campaign.pubkey);
  const nip05 = author.data?.metadata?.nip05;
  const { data: verified } = useNip05Verify(nip05, campaign.pubkey);
  return getCampaignUrl(campaign, nip05, verified === true);
}
