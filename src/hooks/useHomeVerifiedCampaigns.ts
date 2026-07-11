import { useMemo } from 'react';

import { useCampaigns } from '@/hooks/useCampaigns';
import { useCampaignVerifications } from '@/hooks/useCampaignVerifications';
import { useCampaignModeration } from '@/hooks/useCampaignModeration';
import { useVerifierPacks } from '@/hooks/useVerifierPacks';
import { useCampaignList } from '@/hooks/useCampaignLists';
import { VERIFICATION_PRIORITY } from '@/lib/agoraDefaults';
import type { ParsedCampaign } from '@/lib/campaign';

/** Slug of the curated list that positions verified campaigns first. */
export const FEATURED_LIST_SLUG = 'featured-campaigns';

/**
 * Sentinel rank for a verifier who isn't in {@link VERIFICATION_PRIORITY}
 * — i.e. "anyone else on either pack." Sorts after every listed verifier.
 */
const UNRANKED_VERIFIER = Number.MAX_SAFE_INTEGER;

interface UseHomeVerifiedCampaignsResult {
  campaigns: ParsedCampaign[];
  isLoading: boolean;
}

/**
 * Ordered list of **verified campaigns** for the home page.
 *
 * A campaign qualifies when at least one member of the verifier follow
 * packs ({@link useVerifierPacks}) has published an `agora.verified` label
 * for it. Hidden campaigns (a moderator `hidden` label) are dropped.
 *
 * **Ordering** (the product spec):
 *   1. Campaigns positioned by the `featured-campaigns` list come first,
 *      in the list's declared order. (So a verified campaign that's also
 *      first on the featured list shows first.)
 *   2. Remaining verified campaigns are ranked by the highest-priority
 *      verifier that vouched for them ({@link VERIFICATION_PRIORITY}); a
 *      verifier not in that list ranks after every listed one. Ties break
 *      by campaign `created_at`, newest first.
 */
export function useHomeVerifiedCampaigns(): UseHomeVerifiedCampaignsResult {
  const { data: verifications, isLoading: verifLoading } =
    useCampaignVerifications();
  const { data: packMembers, isLoading: packsLoading } = useVerifierPacks();
  const { data: moderation } = useCampaignModeration();
  const { list: featuredList, isLoading: listLoading } =
    useCampaignList(FEATURED_LIST_SLUG);

  // Priority rank lookup: verifier pubkey -> index in the priority order.
  const priorityRank = useMemo(() => {
    const map = new Map<string, number>();
    VERIFICATION_PRIORITY.forEach((pk, i) => map.set(pk, i));
    return map;
  }, []);

  // Coordinates verified by a pack member (the qualifying set), each paired
  // with its best (lowest) verifier priority rank.
  const qualifying = useMemo(() => {
    const members = packMembers ?? new Set<string>();
    const out = new Map<string, number>();
    for (const [coord, verifiers] of verifications.byCoord) {
      let best = Infinity;
      let hasPackVerifier = false;
      for (const v of verifiers) {
        if (!members.has(v.pubkey)) continue;
        hasPackVerifier = true;
        const rank = priorityRank.get(v.pubkey) ?? UNRANKED_VERIFIER;
        if (rank < best) best = rank;
      }
      if (hasPackVerifier) out.set(coord, best);
    }
    return out;
  }, [verifications, packMembers, priorityRank]);

  // Featured-list placement: coord -> index in the list's declared order.
  const featuredPlacement = useMemo(() => {
    const map = new Map<string, number>();
    (featuredList?.coords ?? []).forEach((coord, i) => map.set(coord, i));
    return map;
  }, [featuredList]);

  // Resolve every qualifying coordinate into a full campaign. `useCampaigns`
  // with an empty allowlist short-circuits without a relay round-trip.
  const coords = useMemo(() => [...qualifying.keys()], [qualifying]);
  const { data: campaigns, isLoading: campaignsLoading } = useCampaigns({
    coordinates: coords,
    enabled: coords.length > 0,
  });

  const ordered = useMemo<ParsedCampaign[]>(() => {
    if (!campaigns || campaigns.length === 0) return [];
    const hidden = moderation?.hiddenCoords ?? new Set<string>();

    const visible = campaigns.filter((c) => !hidden.has(c.aTag));

    return [...visible].sort((a, b) => {
      const aFeatured = featuredPlacement.get(a.aTag);
      const bFeatured = featuredPlacement.get(b.aTag);

      // 1) Featured-list members first, in list order.
      const aInFeatured = aFeatured !== undefined;
      const bInFeatured = bFeatured !== undefined;
      if (aInFeatured && bInFeatured) return aFeatured - bFeatured;
      if (aInFeatured) return -1;
      if (bInFeatured) return 1;

      // 2) Then by best verifier priority (lower rank = higher priority).
      const aRank = qualifying.get(a.aTag) ?? UNRANKED_VERIFIER;
      const bRank = qualifying.get(b.aTag) ?? UNRANKED_VERIFIER;
      if (aRank !== bRank) return aRank - bRank;

      // 3) Tie-break: newest campaign first.
      return b.createdAt - a.createdAt;
    });
  }, [campaigns, moderation, featuredPlacement, qualifying]);

  const isLoading =
    verifLoading ||
    packsLoading ||
    listLoading ||
    (coords.length > 0 && campaignsLoading);

  return { campaigns: ordered, isLoading };
}
