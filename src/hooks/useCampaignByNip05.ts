import { useCampaign } from '@/hooks/useCampaign';
import { useNip05Resolve } from '@/hooks/useNip05Resolve';

/**
 * Resolve a campaign from a `(nip05, d-tag)` pair, as used by the pretty
 * `/{nip05}/{d-tag}` route.
 *
 * Composes {@link useNip05Resolve} (NIP-05 → hex pubkey) with
 * {@link useCampaign} (`(pubkey, d-tag)` → campaign). The resolver
 * hex-validates the pubkey before it reaches `useCampaign`'s `authors`
 * filter, so the campaign query stays author-filtered and trust-safe.
 *
 * The `nip05` argument MUST already be a full identifier (`user@domain` or
 * `_@domain` — normalize bare names/domains via `normalizeCampaignNip05`
 * before calling). `useCampaign` self-disables while the pubkey is still
 * resolving (empty string), so no premature query fires.
 */
export function useCampaignByNip05(nip05: string | undefined, identifier: string | undefined) {
  const {
    data: pubkey,
    isLoading: resolving,
    isError: resolveError,
    // `null` means the domain answered but the name isn't listed — a
    // definitive "not found", distinct from a transient network error.
    isSuccess: resolved,
  } = useNip05Resolve(nip05);

  const campaign = useCampaign({
    pubkey: pubkey ?? '',
    identifier: identifier ?? '',
  });

  // The NIP-05 resolved successfully but to nothing (name not in the
  // domain's nostr.json) — treat as a hard 404 without waiting on the
  // downstream campaign query, which stays disabled with an empty pubkey.
  const resolvedToNothing = resolved && !pubkey;

  return {
    data: campaign.data,
    pubkey: pubkey ?? undefined,
    isLoading: resolving || (!!pubkey && campaign.isLoading),
    isError: resolveError || resolvedToNothing || (!!pubkey && campaign.isError),
  };
}
