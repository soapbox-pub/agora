import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { useTranslation } from 'react-i18next';
import { BadgeCheck, EyeOff, HandHeart, PlusCircle, Sparkles } from 'lucide-react';


import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CampaignCard, CampaignCardSkeleton } from '@/components/CampaignCard';
import { CampaignListShelf } from '@/components/campaign-lists/CampaignListShelf';
import { CampaignListsStrip } from '@/components/campaign-lists/CampaignListsStrip';
import { DebouncedSearchInput } from '@/components/DebouncedSearchInput';
import { DiscoverySearchToolbar } from '@/components/DiscoverySearchToolbar';
import { CampaignsHeroShell } from '@/components/CampaignsHeroShell';
import { StartCampaignLink } from '@/components/StartCampaignLink';
import { ModeratorCollapsibleSection } from '@/components/moderation';
import { useCampaignsPageSections } from '@/hooks/useCampaignsPageSections';
import { useAllCampaigns, toQuerySort } from '@/hooks/useAllCampaigns';
import { useCampaignModeration } from '@/hooks/useCampaignModeration';
import { useCampaignModerators } from '@/hooks/useCampaignModerators';
import { useDiscoveryFilters } from '@/hooks/useDiscoveryFilters';
import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { cn } from '@/lib/utils';
import type { ParsedCampaign } from '@/lib/campaign';

/**
 * Browse surface for every campaign on the network.
 *
 * **Idle** (no search / sort / country) — three stacked curated sections:
 *
 *   1. **Topic-list shelves** — the curated lists named in
 *      `CAMPAIGNS_PAGE_LIST_ORDER` (Agora-funds, Africa, Palestine,
 *      Venezuela, Women-and-girls, Democracy, Children), in that order.
 *      Each renders a row of up to four campaigns with a "View all" link
 *      to the list's detail page.
 *   2. **New campaigns** — every other non-hidden campaign not *shown* in a
 *      shelf above (a list member that fell outside the top four still
 *      appears here), ordered by update date, newest first.
 *   3. **Hidden** — a moderator-only collapsible listing every hidden
 *      campaign for review.
 *
 * **Active** (user typed a query, or picked a sort / country) — the
 * curated layout collapses into a single flat results grid ranked /
 * filtered by the hero's search field + the toolbar's Top/New sort and
 * country picker. Searching across curated shelves doesn't make sense,
 * so the whole page becomes "all campaigns matching X."
 *
 * Filter state (`?q=&sort=&country=`) lives in {@link useDiscoveryFilters}
 * with URL persistence so search results stay shareable and survive
 * refresh. Section assembly for the idle view lives in
 * {@link useCampaignsPageSections}.
 */
export function AllCampaignsPage() {
  const { t } = useTranslation();
  const { config } = useAppContext();
  const { user } = useCurrentUser();

  const { data: moderators } = useCampaignModerators();
  const isMod = !!user && !!moderators && moderators.includes(user.pubkey);

  // URL-persisted search / sort / country. Drives the active-search view.
  const filters = useDiscoveryFilters({ urlPrefix: '', enableCountry: true });
  const activeQuery = filters.debouncedSearch.trim();
  const isSearching =
    activeQuery !== '' || filters.sort !== 'default' || !!filters.country;

  // Curated idle sections (shelves + New + Hidden).
  const { shelves, newCampaigns, hiddenCampaigns, isLoading } =
    useCampaignsPageSections();

  const { data: moderation } = useCampaignModeration();

  // Active-search results: the full ranked / filtered set, minus hidden.
  const { data: searchCampaigns, isLoading: searchLoading } = useAllCampaigns({
    sort: toQuerySort(filters.sort),
    search: activeQuery,
    countryCode: filters.country,
    limit: 200,
    enabled: isSearching,
  });

  const searchResults = useMemo<ParsedCampaign[]>(() => {
    if (!isSearching) return [];
    const all = searchCampaigns ?? [];
    const hidden = moderation?.hiddenCoords ?? new Set<string>();
    return all.filter((c) => !hidden.has(c.aTag));
  }, [isSearching, searchCampaigns, moderation]);

  useSeoMeta({
    title: `${t('campaigns.all.seoTitle')} | ${config.appName}`,
    description: t('campaigns.all.description'),
  });

  return (
    <main className="min-h-screen pb-16">
      <AllCampaignsHero
        searchInput={filters.searchInput}
        onSearchChange={filters.setSearchInput}
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 lg:py-14 space-y-12">
        {isSearching ? (
          <SearchResultsSection
            query={activeQuery}
            results={searchResults}
            isLoading={searchLoading}
            filters={filters}
          />
        ) : (
          <>
            {/* Quick-nav strip of all curated topic lists. Moderators can
                create / edit / reorder lists here. */}
            <CampaignListsStrip />

            {/* Topic-list shelves, in the configured order. */}
            {isLoading && shelves.length === 0 ? (
              <div className="space-y-12">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="space-y-4">
                    <div className="h-7 w-48 bg-muted rounded animate-pulse" />
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                      {Array.from({ length: 4 }).map((_, j) => (
                        <CampaignCardSkeleton key={j} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              shelves.map((shelf) => (
                <CampaignListShelf
                  key={shelf.list.slug}
                  list={shelf.list}
                  campaigns={shelf.campaigns}
                  totalCount={shelf.totalCount}
                  isLoading={false}
                />
              ))
            )}

            {/* New campaigns — everything not shown above, newest first. */}
            <section className="space-y-5" aria-labelledby="new-campaigns">
              <div>
                <h2
                  id="new-campaigns"
                  className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2"
                >
                  <Sparkles className="size-5 sm:size-6 text-primary shrink-0" aria-hidden="true" />
                  {t('campaigns.all.newTitle')}
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {t('campaigns.all.newDesc')}
                </p>
              </div>

              {isLoading && newCampaigns.length === 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <CampaignCardSkeleton key={i} />
                  ))}
                </div>
              ) : newCampaigns.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="py-12 px-8 text-center space-y-4">
                    <HandHeart className="size-10 text-muted-foreground mx-auto" />
                    <div className="space-y-1.5">
                      <h3 className="text-lg font-semibold">
                        {t('campaigns.all.empty')}
                      </h3>
                      <p className="text-muted-foreground max-w-sm mx-auto">
                        {t('campaigns.all.emptyHint')}
                      </p>
                    </div>
                    <Button asChild>
                      <StartCampaignLink>
                        <PlusCircle className="size-4 mr-2" />
                        {t('campaigns.all.startCampaign')}
                      </StartCampaignLink>
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                  {newCampaigns.map((campaign) => (
                    <CampaignCard key={campaign.aTag} campaign={campaign} />
                  ))}
                </div>
              )}
            </section>

            {/* Moderator-only: every hidden campaign on the network. */}
            {isMod && (
              <ModeratorCollapsibleSection
                icon={<EyeOff className="size-4" />}
                title={t('campaigns.home.hidden')}
                description={t('campaigns.home.hiddenDesc')}
                count={hiddenCampaigns.length}
                isLoading={!moderation}
                emptyText={t('campaigns.home.hiddenEmpty')}
                skeleton={
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <CampaignCardSkeleton key={i} />
                    ))}
                  </div>
                }
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                  {hiddenCampaigns.map((campaign) => (
                    <CampaignCard key={campaign.aTag} campaign={campaign} />
                  ))}
                </div>
              </ModeratorCollapsibleSection>
            )}
          </>
        )}
      </div>
    </main>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Active-search results
// ═══════════════════════════════════════════════════════════════════════════════

interface SearchResultsSectionProps {
  query: string;
  results: ParsedCampaign[];
  isLoading: boolean;
  filters: ReturnType<typeof useDiscoveryFilters>;
}

/**
 * The flat results grid shown whenever a search / sort / country filter is
 * active. Carries the sort + country toolbar so the user can refine
 * without leaving the results view.
 */
function SearchResultsSection({
  query,
  results,
  isLoading,
  filters,
}: SearchResultsSectionProps) {
  const { t } = useTranslation();

  return (
    <section className="space-y-5">
      <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
            {query ? t('common.search') : t('campaigns.all.title')}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {t('common.searchResultsCount', { count: results.length })}
          </p>
        </div>
        <DiscoverySearchToolbar
          query={filters.searchInput}
          onQueryChange={filters.setSearchInput}
          sort={filters.sort}
          onSortChange={filters.setSort}
          sortOptions={['top', 'new']}
          searchPlaceholderKey="campaigns.all.searchPlaceholder"
          searchAriaLabelKey="campaigns.all.searchAriaLabel"
          country={filters.country}
          onCountryChange={filters.setCountry}
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <CampaignCardSkeleton key={i} />
          ))}
        </div>
      ) : results.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 px-8 text-center space-y-4">
            <HandHeart className="size-10 text-muted-foreground mx-auto" />
            <div className="space-y-1.5">
              <h3 className="text-lg font-semibold">
                {query
                  ? t('campaigns.all.noMatch', { query })
                  : t('campaigns.all.empty')}
              </h3>
              <p className="text-muted-foreground max-w-sm mx-auto">
                {query
                  ? t('campaigns.all.noMatchHint')
                  : t('campaigns.all.emptyHint')}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {results.map((campaign) => (
            <CampaignCard key={campaign.aTag} campaign={campaign} />
          ))}
        </div>
      )}
    </section>
  );
}

export default AllCampaignsPage;

// ═══════════════════════════════════════════════════════════════════════════════
// Hero
// ═══════════════════════════════════════════════════════════════════════════════

interface AllCampaignsHeroProps {
  /** Search input value (undebounced) bound to the hero search field. */
  searchInput: string;
  /** Called on every keystroke in the hero search field. */
  onSearchChange: (next: string) => void;
}

/**
 * Photo-led hero for the All-Campaigns page. Mirrors the Pledges /
 * Communities hero recipe (rotating banner + atmospheric tint + scrims
 * + overlay copy + glassy CTA) so the three discovery pages share the
 * same visual shape. The campaign home (`/campaigns`) keeps its bespoke
 * lightning-map hero as the brand-leading entry point; this surface
 * gets the photo-led treatment because it's the actual browseable index.
 *
 * The center of the hero hosts the primary search field — typing there
 * flips the whole page from the curated shelves view into a flat
 * results grid (see {@link AllCampaignsPage}).
 */
function AllCampaignsHero({
  searchInput,
  onSearchChange,
}: AllCampaignsHeroProps) {
  const { t } = useTranslation();

  return (
    <CampaignsHeroShell>
      <div className="relative space-y-3 max-w-3xl">
        <p className="text-xs sm:text-sm font-semibold uppercase tracking-[0.18em] text-white/85 drop-shadow">
          {t('campaigns.all.heroKicker')}
        </p>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.05] text-white drop-shadow-[0_2px_12px_rgb(0_0_0/0.55)]">
          {t('campaigns.all.heroHeading')}
          <br className="sm:hidden" /> {t('campaigns.all.heroHeadingLine2')}
        </h1>
        <p className="text-base sm:text-lg text-white/85 max-w-2xl mx-auto drop-shadow-[0_1px_6px_rgb(0_0_0/0.5)]">
          {t('campaigns.all.heroBody')}
        </p>
      </div>

      <div className="flex-1 min-h-[100px] sm:min-h-[120px]" aria-hidden="true" />

      {/* Primary search field — glassy to match the hero chrome. Typing
          here flips the page into the flat results view. */}
      <div className="relative w-full max-w-xl mx-auto">
        <DebouncedSearchInput
          value={searchInput}
          onChange={onSearchChange}
          placeholder={t('campaigns.all.searchPlaceholder')}
          ariaLabel={t('campaigns.all.searchAriaLabel')}
          clearLabel={t('common.clearSearch')}
          className={cn(
            '[&_input]:h-12 [&_input]:rounded-full [&_input]:pl-11',
            '[&_input]:bg-black/30 [&_input]:backdrop-blur-xl [&_input]:backdrop-saturate-150',
            '[&_input]:border-white/25 [&_input]:text-white [&_input]:placeholder:text-white/70',
            '[&_input]:shadow-lg [&_input]:shadow-amber-500/10',
            '[&_input:focus-visible]:border-white/40 [&_input]:text-base',
            '[&_svg]:text-white/80',
          )}
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        <Button
          asChild
          size="lg"
          className={cn(
            'relative rounded-full text-white font-semibold text-base h-12 px-7 [&_svg]:size-[18px]',
            'bg-gradient-to-br from-white/14 via-amber-100/10 to-rose-100/10 hover:from-white/20 hover:via-amber-100/14 hover:to-rose-100/14',
            'backdrop-blur-xl backdrop-saturate-150',
            'border border-white/25 hover:border-white/35',
            'shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08),0_10px_28px_-12px_hsl(24_85%_45%/0.4)]',
            'hover:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12),0_12px_32px_-10px_hsl(24_85%_45%/0.5)]',
            'motion-safe:transition-colors motion-safe:duration-200',
          )}
        >
          <StartCampaignLink>
            <PlusCircle className="mr-2" />
            {t('campaigns.all.startCampaign')}
          </StartCampaignLink>
        </Button>
        <Button
          asChild
          size="lg"
          variant="outline"
          className={cn(
            'rounded-full text-white font-semibold text-base h-12 px-7 [&_svg]:size-[18px]',
            'bg-white/5 hover:bg-white/10 backdrop-blur-xl backdrop-saturate-150',
            'border border-white/25 hover:border-white/35',
            'motion-safe:transition-colors motion-safe:duration-200',
          )}
        >
          <Link to="/verify">
            <BadgeCheck className="mr-2" />
            {t('campaigns.all.verifyCampaigns')}
          </Link>
        </Button>
      </div>
    </CampaignsHeroShell>
  );
}
