import { useAuthor } from '@/hooks/useAuthor';
import { useNip05Verify } from '@/hooks/useNip05Verify';
import { useAppHostDirectory } from '@/hooks/useAppHostDirectory';
import { getCampaignUrl, type ParsedCampaign } from '@/lib/campaign';
import { AGORA_HOST } from '@/lib/appUrls';

/**
 * Resolve the canonical link path for a campaign, preferring the shortest
 * trusted pretty URL. Precedence (see {@link getCampaignUrl}):
 *
 * 1. **App-host directory** — if the author's pubkey is listed in the
 *    app's own `/.well-known/nostr.json`, link at `/{name}/{d-tag}`
 *    (host suffix omitted). The app server is authoritative for its own
 *    directory, so this needs no per-link verification and overrides the
 *    author's self-declared kind-0 NIP-05.
 * 2. **Verified kind-0 NIP-05** — the author's self-declared identifier,
 *    used only once it verifies back to their pubkey. Host-local
 *    identifiers are shortened (`agora@agora.spot` → `/agora/…`).
 * 3. **`naddr1…` fallback** — so a spoofed NIP-05 can never hijack a link.
 *
 * The returned path is always safe to render immediately — the naddr
 * fallback is available on first render, and the URL upgrades to the
 * pretty form once the directory / verification resolves.
 */
export function useCampaignUrl(campaign: ParsedCampaign): string {
  const author = useAuthor(campaign.pubkey);
  const nip05 = author.data?.metadata?.nip05;
  const { data: verified } = useNip05Verify(nip05, campaign.pubkey);
  const { data: directory } = useAppHostDirectory();

  return getCampaignUrl(campaign, {
    nip05,
    nip05Verified: verified === true,
    directoryName: directory?.get(campaign.pubkey),
    appHost: AGORA_HOST,
  });
}
