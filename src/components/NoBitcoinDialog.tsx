import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';

import { openUrl } from '@/lib/downloadFile';
import { cn } from '@/lib/utils';
import { ONRAMPS, isOnrampAvailable, type Onramp } from '@/lib/onramps';
import { useUserCountry } from '@/hooks/useUserCountry';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface NoBitcoinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Logo (when we have one) or a brand-colored monogram fallback. */
function OnrampTile({ onramp }: { onramp: Onramp }) {
  return (
    <span
      className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl text-lg font-bold"
      style={{ backgroundColor: onramp.color, color: onramp.fg ?? '#ffffff' }}
    >
      {onramp.logo ? (
        <img
          src={onramp.logo}
          alt=""
          aria-hidden
          draggable={false}
          className="size-11 object-cover"
        />
      ) : (
        onramp.name.charAt(0)
      )}
    </span>
  );
}

/**
 * For donors who don't already hold Bitcoin: a shortlist of on-ramps where
 * they can buy some and send it on. Agora never custodies or converts funds;
 * these just point at mainstream services the donor controls.
 *
 * We make a best-effort IP guess at the donor's country and float the
 * services we think operate there to the top, dimming the rest. The guess
 * is soft — dimmed entries stay fully clickable, since a VPN, travel, or a
 * stale coverage list can make us wrong.
 */
export function NoBitcoinDialog({ open, onOpenChange }: NoBitcoinDialogProps) {
  const { t } = useTranslation();
  // Only expose the donor's IP to the geo endpoint once they actually open
  // the dialog; cached for the rest of the session thereafter.
  const { data: country } = useUserCountry(open);

  const items = useMemo(
    () =>
      ONRAMPS.map((onramp, index) => ({
        onramp,
        index,
        available: isOnrampAvailable(onramp, country),
      })).sort(
        (a, b) => Number(b.available) - Number(a.available) || a.index - b.index,
      ),
    [country],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle>{t('noBitcoin.title')}</DialogTitle>
          <DialogDescription>{t('noBitcoin.description')}</DialogDescription>
        </DialogHeader>

        <div className="-mx-1 max-h-[60vh] space-y-2 overflow-y-auto px-1">
          {items.map(({ onramp, available }) => (
            <button
              key={onramp.id}
              type="button"
              onClick={() => void openUrl(onramp.url)}
              aria-label={`${t('noBitcoin.buyOn')} ${onramp.name}`}
              className={cn(
                'group flex w-full items-center gap-3 rounded-xl border border-border/70 bg-card p-3 text-left transition-all hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                // Dimmed when we think it's unavailable — but still clickable,
                // and it brightens on hover/focus so a wrong guess never traps
                // the donor.
                !available && 'opacity-55 grayscale hover:opacity-100 hover:grayscale-0 focus-visible:opacity-100 focus-visible:grayscale-0',
              )}
            >
              <OnrampTile onramp={onramp} />
              <span className="flex min-w-0 flex-col">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t('noBitcoin.buyOn')}
                </span>
                <span className="truncate text-base font-semibold leading-tight">
                  {onramp.name}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {t(`noBitcoin.onramp.${onramp.descKey}`)}
                  {!available && ` · ${t('noBitcoin.mayBeUnavailable')}`}
                </span>
              </span>
              <ExternalLink className="ml-auto size-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
