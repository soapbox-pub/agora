import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { CampaignCard, CampaignCardSkeleton } from '@/components/CampaignCard';
import { LucideIcon } from '@/components/LucideIcon';
import { CAMPAIGN_CATEGORY_LABEL_KEYS_BY_SLUG } from '@/lib/campaignCategories';
import type { ParsedCampaignList } from '@/lib/campaignLists';
import type { ParsedCampaign } from '@/lib/campaign';

/** How many campaigns a single list shelf shows before "View all". */
export const SHELF_ROW_COUNT = 4;

interface CampaignListShelfProps {
  list: ParsedCampaignList;
  /** The (already hidden-filtered, list-ordered) campaigns to show — capped by the caller. */
  campaigns: ParsedCampaign[];
  /** Total visible members in the list (drives the "View all" affordance). */
  totalCount: number;
  isLoading: boolean;
}

/**
 * A single topic-list shelf on `/campaigns`: a header (icon + title + a
 * "View all N" link to the list detail page) and a responsive row of up
 * to {@link SHELF_ROW_COUNT} campaign cards — 1 column on mobile, 2 on
 * tablet, 4 on desktop.
 *
 * The caller pre-caps `campaigns` to the row count and pre-filters hidden
 * members; this component is purely presentational.
 */
export function CampaignListShelf({
  list,
  campaigns,
  totalCount,
  isLoading,
}: CampaignListShelfProps) {
  const { t } = useTranslation();

  const labelKey = CAMPAIGN_CATEGORY_LABEL_KEYS_BY_SLUG.get(list.slug);
  const title = labelKey ? t(labelKey) : list.title;
  const hasMore = totalCount > campaigns.length;

  // Nothing to show and not loading: render nothing so an empty list
  // doesn't leave a bare header on the page.
  if (!isLoading && campaigns.length === 0) return null;

  return (
    <section className="space-y-4" aria-labelledby={`shelf-${list.slug}`}>
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2
            id={`shelf-${list.slug}`}
            className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2"
          >
            <span className="inline-flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
              <LucideIcon name={list.icon} className="size-4" />
            </span>
            <span className="truncate">{title}</span>
          </h2>
          {list.description && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-1">
              {list.description}
            </p>
          )}
        </div>
        <Button asChild variant="ghost" size="sm" className="shrink-0">
          <Link to={`/campaigns/lists/${list.slug}`}>
            {hasMore
              ? t('campaigns.all.viewAllCount', { count: totalCount })
              : t('campaigns.all.viewAll')}
            <ArrowRight className="ml-1.5 size-4 rtl:rotate-180" />
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {isLoading && campaigns.length === 0
          ? Array.from({ length: SHELF_ROW_COUNT }).map((_, i) => (
              <CampaignCardSkeleton key={i} />
            ))
          : campaigns.map((campaign) => (
              <CampaignCard key={campaign.aTag} campaign={campaign} />
            ))}
      </div>
    </section>
  );
}
