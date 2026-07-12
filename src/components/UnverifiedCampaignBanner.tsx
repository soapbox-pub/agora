import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShieldAlert } from 'lucide-react';

import { cn } from '@/lib/utils';

interface UnverifiedCampaignBannerProps {
  className?: string;
}

/**
 * Full-bleed caution strip rendered above the hero on a campaign's detail
 * page — spanning the entire viewport width — when the campaign has **not**
 * been verified by a trusted source (no member of the curator follow packs,
 * World Liberty Congress Verified + Team Soapbox, has signed an
 * `agora.verified` label for it).
 *
 * This is the **desktop** presentation (the caller passes `hidden sm:flex`).
 * On mobile the same notice is rendered inside the hero's amber toolbar band
 * so it merges with the back/admin controls into one cohesive region; see
 * `CampaignHero` in `CampaignDetailPage`.
 *
 * Visibility is decided by the caller (`CampaignDetailContent`), which
 * computes the trusted-verification state once via
 * {@link useCampaignTrustedVerification} and shares it with the hero. This
 * component therefore renders unconditionally when mounted and takes no
 * `coord`.
 *
 * The "Learn more" link deep-links to the verification FAQ chapter on the
 * About page (`/about#faq-verification`).
 */
export function UnverifiedCampaignBanner({ className }: UnverifiedCampaignBannerProps) {
  const { t } = useTranslation();

  return (
    <div
      role="note"
      className={cn(
        'flex w-full items-center justify-center gap-3 border-b border-amber-300/70 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-100',
        className,
      )}
    >
      <ShieldAlert aria-hidden className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
      <p className="text-sm leading-relaxed text-center">
        {t(
          'campaignVerification.unverifiedBanner',
          'This campaign has not been verified by a trusted source.',
        )}{' '}
        <Link
          to="/about#faq-verification"
          className="font-semibold underline underline-offset-2 hover:text-amber-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:hover:text-white"
        >
          {t('campaignVerification.unverifiedBannerReadMore', 'Learn more')}
        </Link>
      </p>
    </div>
  );
}
