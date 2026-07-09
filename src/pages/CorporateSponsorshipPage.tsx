import { useSeoMeta } from '@unhead/react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  Bitcoin,
  CircleCheck,
  HandHeart,
  Handshake,
  HeartHandshake,
  Megaphone,
  Percent,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { nip19 } from 'nostr-tools';
import { Link } from 'react-router-dom';

import { CampaignCard, CampaignCardSkeleton } from '@/components/CampaignCard';
import { PartnersPressBand } from '@/components/PartnersPressBand';
import { useAppContext } from '@/hooks/useAppContext';
import { useCampaignList } from '@/hooks/useCampaignLists';
import { useCampaigns } from '@/hooks/useCampaigns';
import { TEAM_SOAPBOX_PACK } from '@/lib/helpContent';
import { openUrl } from '@/lib/downloadFile';
import type { ParsedCampaign } from '@/lib/campaign';

/** Where "Get in touch" / "Contact" CTAs send a prospective corporate partner. */
const SPONSOR_CONTACT_MAILTO =
  'mailto:hello@soapbox.pub?subject=Agora%20corporate%20sponsorship';

/**
 * Slug of the curated kind-30003 list that powers the Cause Funds
 * showcase. Its detail page lives at `/campaigns/lists/agora-funds`.
 */
const AGORA_FUNDS_LIST_SLUG = 'agora-funds';

/** Cap on how many Cause Fund campaigns the showcase grid renders. */
const FUNDS_SHOWCASE_CAP = 8;

/**
 * The /sponsors page. A landing-style document for companies that want to
 * partner with the platform. Modeled on AboutPage's section recipe — a dark
 * hero, alternating cream/white section backgrounds, hand-rolled card
 * sub-components, and the canonical Inter-Bold section headings.
 *
 * Three ways to get involved (matching the partnership pitch):
 *   1. Donate to the Agora Cause Funds (BTC or USD, distributed to
 *      verified campaigns) — CTA links to /campaigns/lists/agora-funds
 *   2. Match donations — individual campaigns, featured campaigns, or a
 *      curated list (e.g. political prisoners, women's sovereignty in Africa)
 *   3. Promote donations to your customer base as a philanthropic initiative
 *
 * Routed under the wide FundraiserLayout so sections can span the viewport
 * with their own backgrounds.
 */
export function CorporateSponsorshipPage() {
  const { t } = useTranslation();
  const { config } = useAppContext();

  useSeoMeta({
    title: `${t('corporateSponsorship.seoTitle')} | ${config.appName}`,
    description: t('corporateSponsorship.seoDescription', { appName: config.appName }),
  });

  const appName = config.appName;

  // In-app link to the Team Soapbox follow pack, via the addressable
  // /:nip19 route. Encoded once per render (cheap).
  const teamSoapboxNaddr = useMemo(
    () =>
      nip19.naddrEncode({
        kind: TEAM_SOAPBOX_PACK.kind,
        pubkey: TEAM_SOAPBOX_PACK.pubkey,
        identifier: TEAM_SOAPBOX_PACK.identifier,
      }),
    [],
  );

  return (
    <main className="min-h-screen bg-background">
      {/* ── 1. Hero ──────────────────────────────────────────────────────── */}
      <section
        className="relative overflow-hidden bg-[#0a0c14] text-white"
        style={{
          backgroundImage: "url('/about/world-map-bg.png')",
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      >
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-b from-[#0a0c14]/85 via-[#0a0c14]/70 to-[#0a0c14]/95"
        />
        <div
          aria-hidden
          className="absolute -top-32 -right-32 size-[28rem] rounded-full bg-primary/25 blur-3xl"
        />
        <div
          aria-hidden
          className="absolute -bottom-40 -left-32 size-[24rem] rounded-full bg-primary/15 blur-3xl"
        />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-28 lg:py-32">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold tracking-widest uppercase text-primary mb-4">
              {t('corporateSponsorship.hero.eyebrow', { appName })}
            </p>
            <h1 className="font-sans font-bold tracking-tight leading-[1.05] text-white text-4xl sm:text-6xl lg:text-7xl mb-8">
              {t('corporateSponsorship.hero.headlinePart1')}{' '}
              <span className="text-primary">
                {t('corporateSponsorship.hero.headlineHighlight')}
              </span>
            </h1>
            <p className="text-lg lg:text-xl text-gray-300 max-w-2xl leading-relaxed mb-8">
              {t('corporateSponsorship.hero.body', { appName })}
            </p>

            {/* Trust chips */}
            <ul className="mb-10 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-400">
              {[
                t('corporateSponsorship.hero.trustChips.nonCustodial'),
                t('corporateSponsorship.hero.trustChips.transparent'),
                t('corporateSponsorship.hero.trustChips.noFees'),
              ].map((label) => (
                <li key={label} className="flex items-center gap-2">
                  <CircleCheck className="size-4 text-primary" />
                  {label}
                </li>
              ))}
            </ul>

            {/* CTAs */}
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void openUrl(SPONSOR_CONTACT_MAILTO)}
                className="group inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 font-semibold h-12 px-6 text-base shadow-lg shadow-primary/25 transition-all motion-safe:hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              >
                <Handshake className="size-5" />
                {t('corporateSponsorship.hero.ctaPrimary')}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
              </button>
              <a
                href="#ways"
                className="inline-flex items-center justify-center gap-2 rounded-md border border-white/30 bg-white/5 text-white hover:bg-white/10 font-medium h-12 px-6 text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
              >
                {t('corporateSponsorship.hero.ctaSecondary')}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── 2. Why partner (cream / dark navy) ───────────────────────────── */}
      <section className="relative bg-[#faf8f4] dark:bg-[#0a0c14] py-20 md:py-28 overflow-hidden">
        <div
          aria-hidden
          className="hidden dark:block absolute inset-0 opacity-[0.06] pointer-events-none"
          style={{
            backgroundImage: "url('/about/world-map-bg.png')",
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow={t('corporateSponsorship.intro.eyebrow')}
            title={t('corporateSponsorship.intro.title')}
            lede={t('corporateSponsorship.intro.lede')}
          />

          <ul className="grid sm:grid-cols-3 gap-6 lg:gap-8 max-w-5xl mx-auto">
            <FeatureCard
              icon={<Bitcoin className="size-6" />}
              title={t('corporateSponsorship.intro.cards.bitcoin.title')}
              body={t('corporateSponsorship.intro.cards.bitcoin.body')}
            />
            <FeatureCard
              icon={<ShieldCheck className="size-6" />}
              title={t('corporateSponsorship.intro.cards.verified.title')}
              body={t('corporateSponsorship.intro.cards.verified.body')}
            />
            <FeatureCard
              icon={<Percent className="size-6" />}
              title={t('corporateSponsorship.intro.cards.fees.title')}
              body={t('corporateSponsorship.intro.cards.fees.body')}
            />
          </ul>
        </div>
      </section>

      {/* ── 2b. Partners + press logos (dark band) ───────────────────────── */}
      <PartnersPressBand />

      {/* ── 3. Three ways to partner (white / dark navy) ─────────────────── */}
      <section
        id="ways"
        className="relative bg-white dark:bg-[#13181f] py-20 md:py-28 scroll-mt-16 overflow-hidden"
      >
        <div
          aria-hidden
          className="hidden dark:block absolute inset-0 opacity-[0.05] pointer-events-none"
          style={{
            backgroundImage: "url('/about/world-map-bg.png')",
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow={t('corporateSponsorship.ways.eyebrow')}
            title={t('corporateSponsorship.ways.title')}
            lede={t('corporateSponsorship.ways.lede')}
          />

          <div className="grid md:grid-cols-3 gap-6 lg:gap-8 max-w-6xl mx-auto">
            <WayCard
              icon={<Bitcoin className="size-5" />}
              image="/sponsors/way-cause-funds.svg"
              kicker={t('corporateSponsorship.ways.causeFunds.kicker')}
              title={t('corporateSponsorship.ways.causeFunds.title', { appName })}
              description={t('corporateSponsorship.ways.causeFunds.description', { appName })}
              bullets={[
                t('corporateSponsorship.ways.causeFunds.bullet1'),
                t('corporateSponsorship.ways.causeFunds.bullet2'),
                t('corporateSponsorship.ways.causeFunds.bullet3'),
              ]}
              cta={t('corporateSponsorship.ways.causeFunds.cta')}
              to={`/campaigns/lists/${AGORA_FUNDS_LIST_SLUG}`}
            />
            <WayCard
              icon={<HeartHandshake className="size-5" />}
              image="/sponsors/way-matching.svg"
              kicker={t('corporateSponsorship.ways.matching.kicker')}
              title={t('corporateSponsorship.ways.matching.title')}
              description={t('corporateSponsorship.ways.matching.description')}
              bullets={[
                t('corporateSponsorship.ways.matching.bullet1'),
                t('corporateSponsorship.ways.matching.bullet2'),
                t('corporateSponsorship.ways.matching.bullet3', { appName }),
              ]}
              cta={t('corporateSponsorship.ways.matching.cta')}
              onCta={() => void openUrl(SPONSOR_CONTACT_MAILTO)}
            />
            <WayCard
              icon={<Megaphone className="size-5" />}
              image="/sponsors/way-promote.svg"
              kicker={t('corporateSponsorship.ways.promote.kicker')}
              title={t('corporateSponsorship.ways.promote.title', { appName })}
              description={t('corporateSponsorship.ways.promote.description', { appName })}
              bullets={[
                t('corporateSponsorship.ways.promote.bullet1'),
                t('corporateSponsorship.ways.promote.bullet2'),
                t('corporateSponsorship.ways.promote.bullet3'),
              ]}
              cta={t('corporateSponsorship.ways.promote.cta')}
              onCta={() => void openUrl(SPONSOR_CONTACT_MAILTO)}
            />
          </div>
        </div>
      </section>

      {/* ── 4. Cause Funds showcase (cream / dark navy) ──────────────────── */}
      <CauseFundsShowcase />

      {/* ── 5. Contact CTA (white / dark navy) ───────────────────────────── */}
      <section className="bg-white dark:bg-[#13181f] py-20 md:py-28">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="mx-auto mb-6 size-14 rounded-2xl bg-primary/10 dark:bg-primary/20 border border-primary/30 flex items-center justify-center">
            <Sparkles className="size-7 text-primary" />
          </div>
          <p className="text-xs font-semibold tracking-widest uppercase text-primary mb-3">
            {t('corporateSponsorship.cta.eyebrow')}
          </p>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 dark:text-white mb-4">
            {t('corporateSponsorship.cta.title')}
          </h2>
          <p className="text-base sm:text-lg text-gray-600 dark:text-gray-400 leading-relaxed mb-8">
            {t('corporateSponsorship.cta.body')}
          </p>
          <button
            type="button"
            onClick={() => void openUrl(SPONSOR_CONTACT_MAILTO)}
            className="group inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 font-semibold h-12 px-6 text-base shadow-lg shadow-primary/25 transition-all motion-safe:hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <HandHeart className="size-5" />
            {t('corporateSponsorship.cta.button', { appName })}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
          </button>

          <p className="mt-8 text-sm text-muted-foreground">
            {t('corporateSponsorship.cta.followLine')}{' '}
            <Link
              to={`/${teamSoapboxNaddr}`}
              className="font-medium text-primary hover:underline"
            >
              {t('corporateSponsorship.cta.followLink')}
            </Link>
            {t('corporateSponsorship.cta.followSuffix')}
          </p>
        </div>
      </section>
    </main>
  );
}

// ── Building blocks ───────────────────────────────────────────────────────

interface SectionHeaderProps {
  eyebrow: string;
  title: string;
  lede?: string;
}

function SectionHeader({ eyebrow, title, lede }: SectionHeaderProps) {
  return (
    <div className="text-center max-w-3xl mx-auto mb-14">
      <p className="text-xs font-semibold tracking-widest uppercase text-primary mb-3">
        {eyebrow}
      </p>
      <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 dark:text-white mb-4">
        {title}
      </h2>
      {lede && (
        <p className="text-base sm:text-lg leading-relaxed text-gray-600 dark:text-gray-400">
          {lede}
        </p>
      )}
    </div>
  );
}

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  body: string;
}

/**
 * One of the three "why partner" pillars. A gradient icon chip,
 * tight title, and one-line body on a card that lifts and glows
 * on hover — deliberately punchier than a static stat tile.
 */
function FeatureCard({ icon, title, body }: FeatureCardProps) {
  return (
    <li className="group relative overflow-hidden rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1c2230] shadow-sm p-7 transition-all motion-safe:hover:-translate-y-1 hover:shadow-xl hover:border-primary/40">
      {/* Corner glow that blooms on hover. */}
      <div
        aria-hidden
        className="absolute -top-12 -right-12 size-36 rounded-full bg-primary/15 blur-2xl opacity-0 group-hover:opacity-100 transition-opacity"
      />
      {/* Brand hairline across the top edge. */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary to-primary/40"
      />
      <div className="relative">
        <div className="mb-5 inline-flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-white shadow-lg shadow-primary/25 motion-safe:transition-transform motion-safe:group-hover:scale-110">
          {icon}
        </div>
        <h3 className="text-lg font-bold tracking-tight text-gray-900 dark:text-white mb-2 leading-snug">
          {title}
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{body}</p>
      </div>
    </li>
  );
}

/**
 * Live grid of campaigns from the curated `agora-funds` list —
 * the Cause Funds a corporate partner can put money behind today.
 * Mirrors the home page's featured-row data flow: list → coords →
 * `useCampaigns({ coordinates })` → reorder to the curator's order.
 * Always renders the "browse all campaigns" escape hatch, even
 * while loading or if the list is empty.
 */
function CauseFundsShowcase() {
  const { t } = useTranslation();
  const { config } = useAppContext();

  const { list, isLoading: listLoading } = useCampaignList(AGORA_FUNDS_LIST_SLUG);

  const coords = useMemo(
    () => (list?.coords ?? []).slice(0, FUNDS_SHOWCASE_CAP),
    [list],
  );

  const { data: campaigns, isLoading: campaignsLoading } = useCampaigns(
    coords.length > 0 ? { coordinates: coords } : { coordinates: [] },
  );

  const ordered = useMemo<ParsedCampaign[]>(() => {
    if (!campaigns || coords.length === 0) return [];
    const byCoord = new Map(campaigns.map((c) => [c.aTag, c]));
    const out: ParsedCampaign[] = [];
    for (const coord of coords) {
      const found = byCoord.get(coord);
      if (found) out.push(found);
    }
    return out;
  }, [campaigns, coords]);

  const loading = listLoading || (campaignsLoading && coords.length > 0);

  return (
    <section className="bg-[#f5f1eb] dark:bg-[#0a0c14] py-20 md:py-28">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow={t('corporateSponsorship.fundsShowcase.eyebrow')}
          title={t('corporateSponsorship.fundsShowcase.title', { appName: config.appName })}
          lede={t('corporateSponsorship.fundsShowcase.lede')}
        />

        {loading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <CampaignCardSkeleton key={i} variant="compact" />
            ))}
          </div>
        ) : ordered.length > 0 ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {ordered.map((campaign) => (
              <CampaignCard key={campaign.aTag} campaign={campaign} variant="compact" />
            ))}
          </div>
        ) : null}

        <div className="mt-10 text-center">
          <Link
            to="/campaigns"
            className="group inline-flex items-center justify-center gap-2 rounded-full border border-gray-300 dark:border-white/20 bg-white dark:bg-white/5 text-gray-900 dark:text-white hover:border-primary hover:text-primary dark:hover:text-primary font-medium h-11 px-6 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            {t('corporateSponsorship.fundsShowcase.browseAll')}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
          </Link>
        </div>
      </div>
    </section>
  );
}

interface WayCardProps {
  icon: React.ReactNode;
  /**
   * Illustration shown under the kicker band — a 16:9 brand-styled
   * SVG from `public/sponsors/` visualizing the partnership mode.
   * Decorative (empty alt): the title, description, and bullets
   * carry the full meaning.
   */
  image: string;
  kicker: string;
  title: string;
  description: string;
  bullets: string[];
  cta: string;
  /** In-app destination — renders the CTA as a router Link. */
  to?: string;
  /** Click handler — renders the CTA as a button. Ignored when `to` is set. */
  onCta?: () => void;
}

function WayCard({ icon, image, kicker, title, description, bullets, cta, to, onCta }: WayCardProps) {
  const ctaClass =
    'group inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 font-semibold text-sm h-10 px-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50';

  return (
    <div className="h-full rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1c2230] shadow-sm overflow-hidden flex flex-col">
      <div className="bg-gradient-to-r from-primary to-primary/80 px-6 py-5 text-white">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-white/15">
            {icon}
          </span>
          <span className="text-xs font-semibold uppercase tracking-widest">{kicker}</span>
        </div>
      </div>

      <img src={image} alt="" loading="lazy" className="block w-full aspect-video object-cover" />

      {/* `gap-5` instead of `space-y-5`: space-y is margin-based and its
          selector out-specifies `mt-auto`, which would pin the CTA to the
          content instead of the card bottom. */}
      <div className="p-6 flex-1 flex flex-col gap-5">
        <div>
          <h3 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white mb-2 leading-snug">
            {title}
          </h3>
          <p className="text-gray-600 dark:text-gray-300 leading-relaxed text-[15px]">
            {description}
          </p>
        </div>

        <ul className="space-y-2.5">
          {bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <CircleCheck className="size-4 shrink-0 mt-0.5 text-emerald-600" />
              <span className="text-gray-700 dark:text-gray-300 text-sm leading-snug">{b}</span>
            </li>
          ))}
        </ul>

        <div className="mt-auto pt-2">
          {to ? (
            <Link to={to} className={ctaClass}>
              {cta}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
            </Link>
          ) : (
            <button type="button" onClick={onCta} className={ctaClass}>
              {cta}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
