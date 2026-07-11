import { useMemo } from 'react';

import { useCampaignLists } from '@/hooks/useCampaignLists';
import { useCampaigns } from '@/hooks/useCampaigns';
import { useAllCampaigns } from '@/hooks/useAllCampaigns';
import { useCampaignModeration } from '@/hooks/useCampaignModeration';
import { CAMPAIGNS_PAGE_LIST_ORDER } from '@/lib/agoraDefaults';
import { SHELF_ROW_COUNT } from '@/components/campaign-lists/CampaignListShelf';
import type { ParsedCampaignList } from '@/lib/campaignLists';
import type { ParsedCampaign } from '@/lib/campaign';

/** One resolved topic-list shelf for the `/campaigns` page. */
export interface CampaignShelf {
  list: ParsedCampaignList;
  /** Visible members of the list, in list order (up to {@link SHELF_ROW_COUNT}). */
  campaigns: ParsedCampaign[];
  /** Total visible (non-hidden) members — drives the "View all N" label. */
  totalCount: number;
}

interface UseCampaignsPageSectionsResult {
  /** Topic-list shelves, in {@link CAMPAIGNS_PAGE_LIST_ORDER} order. */
  shelves: CampaignShelf[];
  /**
   * Campaigns not *shown* in any shelf above and not hidden, ordered by
   * update date (newest first). A campaign that belongs to a shelf's list
   * but fell outside the top {@link SHELF_ROW_COUNT} still appears here.
   */
  newCampaigns: ParsedCampaign[];
  /** Every hidden campaign on the network. */
  hiddenCampaigns: ParsedCampaign[];
  isLoading: boolean;
}

/**
 * Assembles the three sections of the reorganized `/campaigns` page:
 *
 *   1. **Topic-list shelves** — the lists named in
 *      {@link CAMPAIGNS_PAGE_LIST_ORDER}, in that order, each capped to a
 *      row of {@link SHELF_ROW_COUNT}. Lists with no published counterpart
 *      are skipped.
 *   2. **New campaigns** — all other non-hidden campaigns not *shown* in a
 *      shelf above (i.e. excluding the ≤4 cards actually rendered, not the
 *      whole list membership), ordered by update date (newest first).
 *   3. **Hidden** — every hidden campaign (moderator review surface).
 *
 * Hidden campaigns are dropped from shelves and New campaigns for every
 * viewer; the Show-hidden affordance lives with the Hidden section itself.
 */
export function useCampaignsPageSections(): UseCampaignsPageSectionsResult {
  const { data: listsData, isLoading: listsLoading } = useCampaignLists();
  const { data: moderation } = useCampaignModeration();

  // The full network of campaigns (newest-first) — the source for the
  // "New campaigns" section and each shelf's member resolution. Reusing
  // useAllCampaigns keeps a single cached query shared with the discovery
  // machinery elsewhere on the page.
  const { data: allCampaigns, isLoading: allLoading } = useAllCampaigns({
    sort: 'none',
    search: '',
    limit: 200,
  });

  // Resolve the ordered slugs against the published lists.
  const orderedLists = useMemo<ParsedCampaignList[]>(() => {
    const bySlug = new Map(
      (listsData?.lists ?? []).map((l) => [l.slug, l] as const),
    );
    const out: ParsedCampaignList[] = [];
    for (const slug of CAMPAIGNS_PAGE_LIST_ORDER) {
      const found = bySlug.get(slug);
      if (found) out.push(found);
    }
    return out;
  }, [listsData]);

  // Every coordinate referenced by any shelf list — resolved in one query.
  const shelfCoords = useMemo(() => {
    const set = new Set<string>();
    for (const list of orderedLists) {
      for (const coord of list.coords) set.add(coord);
    }
    return [...set];
  }, [orderedLists]);

  const { data: shelfCampaigns, isLoading: shelfLoading } = useCampaigns({
    coordinates: shelfCoords,
    enabled: shelfCoords.length > 0,
  });

  const result = useMemo<UseCampaignsPageSectionsResult>(() => {
    const hidden = moderation?.hiddenCoords ?? new Set<string>();

    // Lookup for shelf members (list-referenced campaigns) plus the full
    // network — a campaign may be referenced by a list but only present in
    // the network query, or vice versa, so we merge both maps.
    const byCoord = new Map<string, ParsedCampaign>();
    for (const c of allCampaigns ?? []) byCoord.set(c.aTag, c);
    for (const c of shelfCampaigns ?? []) if (!byCoord.has(c.aTag)) byCoord.set(c.aTag, c);

    // Build shelves and collect the coords actually SHOWN (the ≤4 rendered
    // cards), which the New section excludes.
    const shown = new Set<string>();
    const shelves: CampaignShelf[] = [];
    for (const list of orderedLists) {
      const visibleMembers: ParsedCampaign[] = [];
      for (const coord of list.coords) {
        if (hidden.has(coord)) continue;
        const campaign = byCoord.get(coord);
        if (!campaign) continue;
        visibleMembers.push(campaign);
      }
      const capped = visibleMembers.slice(0, SHELF_ROW_COUNT);
      for (const c of capped) shown.add(c.aTag);
      shelves.push({
        list,
        campaigns: capped,
        totalCount: visibleMembers.length,
      });
    }

    // New campaigns: non-hidden, not shown in a shelf, newest-first.
    // `allCampaigns` already arrives newest-first from useAllCampaigns.
    const newCampaigns: ParsedCampaign[] = [];
    const hiddenCampaigns: ParsedCampaign[] = [];
    for (const c of allCampaigns ?? []) {
      if (hidden.has(c.aTag)) {
        hiddenCampaigns.push(c);
        continue;
      }
      if (shown.has(c.aTag)) continue;
      newCampaigns.push(c);
    }

    return {
      shelves,
      newCampaigns,
      hiddenCampaigns,
      isLoading:
        listsLoading ||
        allLoading ||
        (shelfCoords.length > 0 && shelfLoading),
    };
  }, [
    orderedLists,
    allCampaigns,
    shelfCampaigns,
    moderation,
    listsLoading,
    allLoading,
    shelfLoading,
    shelfCoords,
  ]);

  return result;
}
