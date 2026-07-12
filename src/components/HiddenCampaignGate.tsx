import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, ArrowLeft, Eye } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface HiddenCampaignGateProps {
  /** Go back / leave the campaign (e.g. `() => navigate(-1)`). */
  onBack: () => void;
  /** Dismiss the gate and reveal the campaign anyway. */
  onProceed: () => void;
}

/**
 * Full-column interstitial shown when a user opens a campaign that Agora
 * moderators have **hidden** (an `agora.moderation` `hidden` label — see
 * {@link useCampaignModeration}). Typically reached via a shared/deep link,
 * since hidden campaigns are filtered out of the app's own feeds.
 *
 * This is a *soft* gate, not censorship: the campaign is one click away. It
 * exists only to give donors context before they engage. The moderation
 * label carries no machine-readable reason, so the copy stays generic
 * ("hidden by Agora moderators") and points to the verification FAQ for the
 * why. The two actions are **Back** (leave) and **Proceed anyway** (reveal).
 *
 * The real campaign UI is not rendered until the user proceeds — the parent
 * (`CampaignDetailContent`) short-circuits to this gate.
 */
export function HiddenCampaignGate({ onBack, onProceed }: HiddenCampaignGateProps) {
  const { t } = useTranslation();

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 py-16 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
          <ShieldAlert aria-hidden className="size-7" />
        </div>

        <h1 className="mt-6 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          {t('campaignHidden.title', 'This campaign has been hidden')}
        </h1>

        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          {t(
            'campaignHidden.body',
            'This campaign has been hidden by Agora moderators, usually because it looks like spam, a scam, or an impersonation. You can still choose to view it.',
          )}{' '}
          <Link
            to="/about#faq-verification"
            className="font-semibold text-primary underline underline-offset-2 hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t('campaignHidden.learnMore', 'Learn more')}
          </Link>
        </p>

        <div className="mt-8 flex w-full flex-col-reverse gap-3 sm:flex-row sm:justify-center">
          <Button
            type="button"
            variant="outline"
            className="gap-2 rounded-full px-6"
            onClick={onBack}
          >
            <ArrowLeft aria-hidden className="size-4 rtl:rotate-180" />
            {t('campaignHidden.back', 'Back')}
          </Button>
          <Button
            type="button"
            className="gap-2 rounded-full px-6"
            onClick={onProceed}
          >
            <Eye aria-hidden className="size-4" />
            {t('campaignHidden.proceed', 'Proceed anyway')}
          </Button>
        </div>
      </div>
    </main>
  );
}
