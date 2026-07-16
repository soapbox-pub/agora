import { useTranslation } from 'react-i18next';

import { openUrl } from '@/lib/downloadFile';
import { cn } from '@/lib/utils';

/**
 * One entry in a logo rail. Brand names are proper nouns and stay
 * untranslated; assets live in `public/logos/` and are flattened to
 * a single theme-aware ink color via CSS filters, so any transparent-
 * background mark works regardless of its original colors.
 */
interface LogoDef {
  /** Accessible name + alt text. */
  name: string;
  /** Asset path under `public/`. */
  src: string;
  /** External destination the logo links to. */
  href: string;
  /**
   * Tailwind height class for the rendered mark. Per-logo so
   * wide wordmarks and square icons read at similar visual weight.
   */
  imgClass: string;
  /**
   * Optional text rendered beside the mark, for brands whose only
   * official asset is a square icon with no wordmark (Soapbox).
   */
  wordmark?: string;
}

/** "In partnership with:" — big rail, auto-scrolling marquee. */
const PARTNERS: LogoDef[] = [
  {
    name: 'Human Rights Foundation',
    src: '/logos/hrf.png',
    href: 'https://hrf.org',
    imgClass: 'h-9 sm:h-11',
  },
  {
    name: 'World Liberty Congress',
    src: '/logos/world-liberty-congress.png',
    href: 'https://worldlibertycongress.org',
    imgClass: 'h-10 sm:h-12',
  },
  {
    name: 'Soapbox',
    src: '/logos/soapbox.svg',
    href: 'https://soapbox.pub',
    imgClass: 'h-9 sm:h-11',
    wordmark: 'Soapbox',
  },
  {
    name: 'And Other Stuff',
    src: '/logos/and-other-stuff.png',
    href: 'https://andotherstuff.org',
    imgClass: 'h-12 sm:h-14',
  },
];

/** "As seen in:" — smaller static row of press logos linking to coverage. */
const PRESS: LogoDef[] = [
  {
    name: 'Forbes',
    src: '/logos/forbes.svg',
    href: 'https://www.forbes.com/sites/digital-assets/2026/07/16/when-the-financial-system-cant-reach-people-in-crisis-bitcoin-can/',
    imgClass: 'h-5 sm:h-6',
  },
  {
    name: 'NERDS.xyz',
    src: '/logos/nerds.png',
    href: 'https://nerds.xyz/2026/07/venezuela-bitcoin-earthquake-relief/',
    imgClass: 'h-6 sm:h-7',
  },
  {
    name: 'Oslo Freedom Forum',
    src: '/logos/oslo-freedom-forum.svg',
    href: 'https://soapbox.pub/blog/agora-is-live',
    imgClass: 'h-8 sm:h-9',
  },
  {
    name: 'Yahoo Finance',
    src: '/logos/yahoo-finance.svg',
    href: 'https://finance.yahoo.com/markets/crypto/articles/world-liberty-congress-launches-agora-131500558.html',
    imgClass: 'h-4 sm:h-5',
  },
  {
    name: 'Associated Press',
    src: '/logos/ap.svg',
    href: 'https://apnews.com/press-release/pr-newswire/world-liberty-congress-launches-agora-at-oslo-freedom-forum-to-power-global-support-for-human-rights-movements-8ac37ef4848992ef07a67acb9c1ff370',
    imgClass: 'h-6 sm:h-7',
  },
];

/**
 * Number of times the partner set repeats inside the marquee track.
 * Must be even so the `-50%` translate loops seamlessly, and high
 * enough that the track always outruns ultra-wide viewports.
 */
const MARQUEE_COPIES = 4;

/**
 * Theme-aware full-width band with two logo rails:
 *
 *  1. **In partnership with:** — auto-scrolling marquee of partner
 *     org logos (pauses on hover, static rail under reduced motion).
 *  2. **As seen in:** — smaller static row of press logos.
 *
 * Every logo links out to the org's site / the coverage article via
 * `openUrl` (Capacitor-safe). Shared by the home page (below the
 * manifesto section) and /sponsors (below the intro cards).
 */
export function PartnersPressBand({ className }: { className?: string }) {
  const { t } = useTranslation();

  return (
    <section
      aria-label={t('partners.partnersTitle')}
      className={cn(
        'relative overflow-hidden bg-[hsl(38_30%_96%)] text-foreground py-14 md:py-16 dark:bg-[#0a0c14] dark:text-white',
        className,
      )}
    >
      {/* Soft brand glows so the band doesn't read as a flat black slab. */}
      <div
        aria-hidden
        className="absolute -top-24 -left-24 size-72 rounded-full bg-primary/10 blur-3xl pointer-events-none dark:bg-primary/15"
      />
      <div
        aria-hidden
        className="absolute -bottom-24 -right-24 size-72 rounded-full bg-primary/10 blur-3xl pointer-events-none"
      />

      <div className="relative space-y-12 md:space-y-14">
        {/* ── Partners marquee ─────────────────────────────────── */}
        <div>
          <p className="text-center text-xs font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-8 px-4 dark:text-white/60">
            {t('partners.partnersTitle')}
          </p>
          <PartnerMarquee />
        </div>

        {/* ── Press row ────────────────────────────────────────── */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-center text-[11px] font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-7 dark:text-white/50">
            {t('partners.pressTitle')}
          </p>
          <ul className="flex flex-wrap items-center justify-center gap-x-10 sm:gap-x-14 gap-y-6">
            {PRESS.map((logo) => (
              <li key={logo.name}>
                <LogoLink logo={logo} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/**
 * Infinite horizontal marquee of partner logos.
 *
 * The track holds {@link MARQUEE_COPIES} copies of the logo set and
 * translates by -50%, so the loop is seamless at any viewport width.
 * Only the first copy is interactive — duplicates are `aria-hidden`
 * decoration so keyboard users don't tab through the same four links
 * repeatedly. Hover pauses the scroll; `prefers-reduced-motion`
 * disables it entirely and falls back to a swipeable static rail.
 */
function PartnerMarquee() {
  return (
    <div className="group relative overflow-hidden motion-reduce:overflow-x-auto">
      {/* Edge fades so logos slide in/out of the band surface instead of clipping. */}
      <div
        aria-hidden
        className="motion-reduce:hidden absolute inset-y-0 left-0 w-16 sm:w-28 z-10 bg-gradient-to-r from-[hsl(38_30%_96%)] to-transparent pointer-events-none dark:from-[#0a0c14]"
      />
      <div
        aria-hidden
        className="motion-reduce:hidden absolute inset-y-0 right-0 w-16 sm:w-28 z-10 bg-gradient-to-l from-[hsl(38_30%_96%)] to-transparent pointer-events-none dark:from-[#0a0c14]"
      />

      <div className="flex w-max motion-safe:animate-logo-marquee motion-safe:group-hover:[animation-play-state:paused]">
        {Array.from({ length: MARQUEE_COPIES }).map((_, copy) => (
          <ul
            key={copy}
            aria-hidden={copy > 0 || undefined}
            className={cn(
              'flex items-center gap-14 sm:gap-24 pe-14 sm:pe-24',
              copy > 0 && 'motion-reduce:hidden',
            )}
          >
            {PARTNERS.map((logo) => (
              <li key={logo.name} className="shrink-0">
                <LogoLink logo={logo} decorative={copy > 0} />
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}

/**
 * A single theme-inked logo, linked to its destination. `decorative`
 * renders a non-focusable span for marquee duplicates.
 */
function LogoLink({ logo, decorative = false }: { logo: LogoDef; decorative?: boolean }) {
  const content = (
    <>
      <img
        src={logo.src}
        alt={decorative ? '' : logo.name}
        loading="lazy"
        className={cn('w-auto brightness-0 dark:invert', logo.imgClass)}
      />
      {logo.wordmark && (
        <span className="text-2xl font-bold tracking-tight text-foreground dark:text-white" aria-hidden>
          {logo.wordmark}
        </span>
      )}
    </>
  );

  const sharedClass =
    'inline-flex items-center gap-3 opacity-70 transition-opacity motion-safe:transition-transform';

  if (decorative) {
    return <span className={sharedClass}>{content}</span>;
  }

  return (
    <a
      href={logo.href}
      aria-label={logo.name}
      onClick={(e) => {
        e.preventDefault();
        void openUrl(logo.href);
      }}
      className={cn(
        sharedClass,
        'hover:opacity-100 motion-safe:hover:scale-[1.03] rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 dark:focus-visible:ring-white/60 focus-visible:opacity-100',
      )}
    >
      {content}
    </a>
  );
}
