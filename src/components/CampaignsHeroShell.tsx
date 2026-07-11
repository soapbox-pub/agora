import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { HeroAtmosphere } from '@/components/HeroAtmosphere';
import { HeroBanner } from '@/components/HeroBanner';
import { HOPE_PALETTE } from '@/lib/hopePalette';
import { sanitizeUrl } from '@/lib/sanitizeUrl';

interface CampaignsHeroShellProps {
  /**
   * Optional single cover image URL. When provided (and a valid https
   * URL), it's rendered as a still full-bleed banner. When omitted, the
   * hero falls back to {@link fallbackCover} if given, otherwise the
   * default rotating WLC photo set.
   */
  cover?: string;
  /**
   * Optional still image to show when no `cover` is set, instead of the
   * default rotating WLC gallery. Used by the campaign-list detail page
   * so lists without a cover get a consistent branded backdrop rather
   * than the cycling hero photos.
   */
  fallbackCover?: string;
  /** Centered overlay content (kicker, headline, description, controls). */
  children: ReactNode;
}

/**
 * Shared photo-led hero shell used by the All-Campaigns page and the
 * campaign-list detail page, so a curated list's cover image renders in
 * exactly the same layout as the /campaigns header: a full-bleed banner
 * with warm atmosphere, top/bottom legibility scrims, and centered
 * overlay copy.
 *
 * The banner is the caller's single `cover` image, else `fallbackCover`
 * (both rendered as a still), else the default rotating WLC gallery. The
 * atmosphere hue cycles on the same 9s cadence so the whole hero feels
 * coordinated.
 */
export function CampaignsHeroShell({ cover, fallbackCover, children }: CampaignsHeroShellProps) {
  const [hueIndex, setHueIndex] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      setHueIndex((i) => (i + 1) % HOPE_PALETTE.length);
    }, 9_000);
    return () => window.clearInterval(id);
  }, []);
  const activeHue = HOPE_PALETTE[hueIndex];

  const coverUrl = sanitizeUrl(cover) ?? sanitizeUrl(fallbackCover);

  return (
    <section className="relative overflow-hidden border-b border-border bg-secondary/30">
      {/* Banner: the caller's cover / fallback (still) or the default
          rotating WLC photo set. A single-element array renders as a still. */}
      <HeroBanner images={coverUrl ? [coverUrl] : undefined} />

      {/* Warm atmosphere — campaigns-side hue, same as the Pledges hero. */}
      <HeroAtmosphere hue={activeHue} />

      {/* Top scrim so the headline stays legible across every photo. */}
      <div
        className="absolute inset-x-0 top-0 h-64 sm:h-80 pointer-events-none bg-gradient-to-b from-black/70 via-black/40 to-transparent"
        aria-hidden="true"
      />

      {/* Bottom scrim so the controls stay legible. */}
      <div
        className="absolute inset-x-0 bottom-0 h-56 sm:h-72 pointer-events-none bg-gradient-to-t from-black/70 via-black/35 to-transparent"
        aria-hidden="true"
      />

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-12 lg:py-14 min-h-[380px] sm:min-h-[420px] lg:min-h-[460px] flex flex-col items-center text-center">
        {children}
      </div>
    </section>
  );
}
