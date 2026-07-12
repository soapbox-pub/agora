import { useMemo } from 'react';

import { useCampaignVerifications } from '@/hooks/useCampaignVerifications';
import { useVerifierPacks } from '@/hooks/useVerifierPacks';

export interface CampaignTrustedVerification {
  /**
   * True when at least one verifier of this campaign is a member of the
   * curator follow packs (World Liberty Congress Verified + Team Soapbox).
   * This is the same "trusted source" gate the home page's Verified
   * Campaigns section uses — an open `agora.verified` label from a random
   * account does *not* satisfy it.
   */
  isTrustedVerified: boolean;
  /**
   * Still fetching either the verification labels or the follow-pack member
   * set. Callers should suppress any "unverified" UI while true to avoid a
   * flash of the warning on a campaign that is in fact trusted-verified.
   */
  isLoading: boolean;
}

/**
 * Whether a campaign has been verified by a **trusted source** — i.e. an
 * account that belongs to one of the {@link VERIFIER_FOLLOW_PACKS}.
 *
 * The verification fold ({@link foldVerificationLabels}) already drops
 * self-verifications, so this only has to intersect the campaign's verifier
 * pubkeys with the live pack-member set. This deliberately mirrors the
 * qualifying rule in `useHomeVerifiedCampaigns` so "verified" means the same
 * thing on the detail page banner as it does in the home page shelf.
 *
 * @param coord Campaign coordinate `33863:<pubkey>:<d>` (a campaign's `aTag`).
 */
export function useCampaignTrustedVerification(
  coord: string | undefined,
): CampaignTrustedVerification {
  const { data: verifications, isLoading: verifLoading } =
    useCampaignVerifications();
  const { data: packMembers, isLoading: packsLoading } = useVerifierPacks();

  const isTrustedVerified = useMemo(() => {
    if (!coord) return false;
    const members = packMembers ?? new Set<string>();
    if (members.size === 0) return false;
    const verifiers = verifications.byCoord.get(coord) ?? [];
    return verifiers.some((v) => members.has(v.pubkey));
  }, [coord, verifications, packMembers]);

  return {
    isTrustedVerified,
    isLoading: verifLoading || packsLoading,
  };
}
