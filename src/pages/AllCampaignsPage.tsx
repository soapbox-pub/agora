import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { useTranslation } from 'react-i18next';
import { BadgeCheck, EyeOff, HandHeart, PlusCircle, Sparkles } from 'lucide-react';


import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CampaignCard, CampaignCardSkeleton } from '@/components/CampaignCard';
import { CampaignListShelf } from '@/components/campaign-lists/CampaignListShelf';
import { CampaignListsStrip } from '@/components/campaign-lists/CampaignListsStrip';
import { HeroAtmosphere } from '@/components/HeroAtmosphere';
import { HeroBanner } from '@/components/HeroBanner';
import { StartCampaignLink } from '@/components/StartCampaignLink';
import { ModeratorCollapsibleSection } from '@/components/moderation';
import { useCampaignsPageSections } from '@/hooks/useCampaignsPageSections';
import { useCampaignModeration } from '@/hooks/useCampaignModeration';
import { useCampaignModerators } from '@/hooks/useCampaignModerators';
import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { HOPE_PALETTE } from '@/lib/hopePalette';
import { cn } from '@/lib/utils';

/**
 * Browse surface for every campaign on the network, reorganized into three
 * stacked sections:
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
 * The moderator-curated topic-list strip stays at the top as a quick
 * navigation affordance. Section assembly lives in
 * {@link useCampaignsPageSections}; this page is the presentation shell.
 */
export function AllCampaignsPage() {
  const { t } = useTranslation();
  const { config } = useAppContext();
  const { user } = useCurrentUser();

  const { data: moderators } = useCampaignModerators();
  const isMod = !!user && !!moderators && moderators.includes(user.pubkey);

  const { shelves, newCampaigns, hiddenCampaigns, isLoading } =
    useCampaignsPageSections();

  const { data: moderation } = useCampaignModeration();

  const totalCount =
    newCampaigns.length +
    shelves.reduce((n, s) => n + s.totalCount, 0);

  useSeoMeta({
    title: `${t('campaigns.all.seoTitle')} | ${config.appName}`,
    description: t('campaigns.all.description'),
  });

  return (
    <main className="min-h-screen pb-16">
      <AllCampaignsHero campaignCount={totalCount} />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 lg:py-14 space-y-12">
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
      </div>
    </main>
  );
}

export default AllCampaignsPage;

// ═══════════════════════════════════════════════════════════════════════════════
// Hero
// ═══════════════════════════════════════════════════════════════════════════════

interface AllCampaignsHeroProps {
  /** Total campaigns currently loaded — fuels the live stat pill. */
  campaignCount: number;
}

/**
 * Photo-led hero for the All-Campaigns page. Mirrors the Pledges /
 * Communities hero recipe (rotating banner + atmospheric tint + scrims
 * + overlay copy + glassy CTA) so the three discovery pages share the
 * same visual shape. The campaign home (`/campaigns`) keeps its bespoke
 * lightning-map hero as the brand-leading entry point; this surface
 * gets the photo-led treatment because it's the actual browseable index.
 */
function AllCampaignsHero({ campaignCount }: AllCampaignsHeroProps) {
  const { t } = useTranslation();
  // Cycle through warm hues on the same cadence as the banner so the
  // whole hero feels like one coordinated moment instead of two
  // unrelated rotations.
  const [hueIndex, setHueIndex] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      setHueIndex((i) => (i + 1) % HOPE_PALETTE.length);
    }, 9_000);
    return () => window.clearInterval(id);
  }, []);
  const activeHue = HOPE_PALETTE[hueIndex];

  return (
    <section className="relative overflow-hidden border-b border-border bg-secondary/30">
      {/* Rotating photo banner — uses the default WLC photo set so this
          page matches the Communities hero's photographic vocabulary. */}
      <HeroBanner />

      {/* Warm atmosphere — campaigns-side hue, same as the Pledges hero. */}
      <HeroAtmosphere hue={activeHue} />

      {/* Top scrim so the headline stays legible across every photo. */}
      <div
        className="absolute inset-x-0 top-0 h-64 sm:h-80 pointer-events-none bg-gradient-to-b from-black/70 via-black/40 to-transparent"
        aria-hidden="true"
      />

      {/* Bottom scrim so the stat pill + CTA stay legible. */}
      <div
        className="absolute inset-x-0 bottom-0 h-56 sm:h-72 pointer-events-none bg-gradient-to-t from-black/70 via-black/35 to-transparent"
        aria-hidden="true"
      />

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-12 lg:py-14 min-h-[380px] sm:min-h-[420px] lg:min-h-[460px] flex flex-col items-center text-center">
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

        {/* Live stat pill — campaigns-on-network count. */}
        <div
          className="relative w-full max-w-md mx-auto rounded-full bg-black/30 backdrop-blur-xl backdrop-saturate-150 border border-white/20 px-5 py-3 shadow-lg shadow-amber-500/10"
          aria-live="polite"
        >
          <div className="flex items-center justify-center gap-3">
            <HandHeart
              className="size-5 text-amber-200 shrink-0 drop-shadow"
              aria-hidden
            />
            <span className="text-sm sm:text-base font-semibold tracking-tight text-white drop-shadow-[0_1px_4px_rgb(0_0_0/0.5)]">
              {campaignCount.toLocaleString()}
            </span>
            <span className="text-xs sm:text-sm text-white/85 line-clamp-1 drop-shadow-[0_1px_4px_rgb(0_0_0/0.5)]">
              {t('campaigns.all.campaignsCount', { count: campaignCount })}
            </span>
          </div>
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
      </div>
    </section>
  );
}
