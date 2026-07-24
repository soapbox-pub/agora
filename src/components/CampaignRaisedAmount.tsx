import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Renders a campaign's raised total in Agora's branded display style — the
 * same skewed, stroked, condensed treatment as the wallet balance pill in
 * the top nav (see `WalletBalancePill` in TopNav). Sharing the treatment
 * makes the raised figure read as a headline number rather than body text,
 * which is the whole point of the microphilanthropy layout: a modest total
 * should still look like an achievement.
 *
 * Size and color come from `className` (e.g. `text-3xl text-primary`); the
 * font, letter-stroke, and slant are fixed here so every surface stays in
 * sync with the wallet pill.
 */
export function CampaignRaisedAmount({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'latin-display font-display font-normal uppercase tracking-wide leading-none tabular-nums inline-block',
        className,
      )}
      style={{
        WebkitTextStroke: '0.022em currentColor',
        transform: 'skewX(-6deg) scaleX(1.1)',
        transformOrigin: '0 100%',
      }}
    >
      {children}
    </span>
  );
}
