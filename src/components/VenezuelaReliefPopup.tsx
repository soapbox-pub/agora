import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { HeartHandshake, Share2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { VenezuelaReliefGoal } from '@/components/VenezuelaReliefGoal';
import { useShareOrigin } from '@/hooks/useShareOrigin';
import { useToast } from '@/hooks/useToast';
import { shareOrCopy } from '@/lib/share';
import {
  VENEZUELA_RELIEF_IMAGES,
  VENEZUELA_RELIEF_PATH,
  VENEZUELA_RELIEF_URL,
  VENEZUELA_RELIEF_POPUP_DISMISSED_KEY,
} from '@/lib/venezuelaRelief';

/**
 * Site-wide Venezuela earthquake relief popup.
 *
 * Mounted once in `AppRouter.tsx` so it surfaces on a fresh load of any
 * route. It carries the same appeal as the home-page hero
 * ({@link VenezuelaReliefBanner}): the same lead photo, headline, and
 * donate CTA, plus a share action and a link to the dedicated relief
 * page.
 *
 * Frequency and suppression rules:
 *
 *  - **Dismissal is permanent.** Closing the popup (via the X, overlay,
 *    escape, or following one of its links) writes a `localStorage` flag
 *    (`VENEZUELA_RELIEF_POPUP_DISMISSED_KEY`); once set, the popup never
 *    opens again on that device.
 *  - **Direct links are respected.** If the visitor lands straight on a
 *    shared NIP-19 URL (someone's campaign `naddr`, a profile, a note…)
 *    or on the relief page itself, the popup stays closed — they came to
 *    see that content, not our appeal, and the relief page already *is*
 *    the appeal.
 *
 * When the relief response winds down, remove `<VenezuelaReliefPopup />`
 * from `AppRouter.tsx`.
 */
/**
 * Module-level guard so the popup's "should I open?" decision is made
 * exactly once per page load, surviving React 19 StrictMode's
 * double-mount (which unmounts and remounts the component, resetting any
 * component state / refs).
 */
let decidedThisLoad = false;
let shouldOpenThisLoad = false;

/**
 * True when the initial URL points straight at shared content — a NIP-19
 * entity route (`/naddr1…` campaign links, `/npub1…` profiles, notes,
 * events) or the dedicated relief page. Visitors following such a link
 * shouldn't be interrupted by the appeal.
 */
function isDirectContentVisit(pathname: string): boolean {
  if (pathname === VENEZUELA_RELIEF_PATH) return true;
  return /^\/(npub|nprofile|note|nevent|naddr)1[a-z0-9]+\/?$/i.test(pathname);
}

export function VenezuelaReliefPopup() {
  const { t } = useTranslation();
  const shareOrigin = useShareOrigin();
  const { toast } = useToast();

  // Decide once per page load (guarded against StrictMode remounts)
  // whether to open: never after a prior dismissal, and never when the
  // visitor landed directly on shared content (e.g. someone's campaign).
  if (!decidedThisLoad) {
    decidedThisLoad = true;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(VENEZUELA_RELIEF_POPUP_DISMISSED_KEY) === '1';
    } catch {
      // localStorage unavailable (private mode / sandbox): show,
      // best-effort, rather than crash.
    }
    shouldOpenThisLoad = !dismissed && !isDirectContentVisit(window.location.pathname);
  }

  const [open, setOpen] = useState(shouldOpenThisLoad);

  const dismiss = () => {
    setOpen(false);
    try {
      localStorage.setItem(VENEZUELA_RELIEF_POPUP_DISMISSED_KEY, '1');
    } catch {
      // localStorage unavailable: dismissal just won't persist.
    }
  };

  const handleShare = async () => {
    const result = await shareOrCopy(
      `${shareOrigin}${VENEZUELA_RELIEF_PATH}`,
      t('campaigns.home.venezuelaRelief.shareTitle'),
    );
    if (result === 'copied') {
      toast({ title: t('campaigns.home.venezuelaRelief.linkCopied') });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : dismiss())}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-md">
        {/* Lead photo from the appeal, with a dark scrim and the headline
            painted over it, echoing the home hero treatment. */}
        <div className="relative h-44 w-full bg-[hsl(220_25%_6%)]">
          <img
            src={VENEZUELA_RELIEF_IMAGES[0]}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-black/20"
          />
          <DialogHeader className="absolute inset-x-0 bottom-0 p-5 text-left">
            <DialogTitle className="font-display italic font-normal uppercase tracking-wide leading-[0.92] text-3xl text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.5)]">
              <Trans
                i18nKey="campaigns.home.venezuelaRelief.title"
                components={[
                  <span
                    key="hl"
                    className="inline-block w-fit ps-0 pe-2 bg-primary text-white leading-[0.95] align-baseline"
                    style={{ textIndent: '-0.06em' }}
                  />,
                ]}
              />
            </DialogTitle>
          </DialogHeader>
        </div>

        <div className="px-5 pb-5 pt-1">
          <DialogDescription className="text-sm leading-relaxed text-foreground/80">
            {t('campaigns.home.venezuelaRelief.popupBody')}
          </DialogDescription>

          {/* Live fundraising progress — the info half of the hybrid. */}
          <VenezuelaReliefGoal variant="card" className="mt-4" />

          <DialogFooter className="mt-5 sm:flex-row sm:justify-start sm:gap-2">
            <Button asChild className="rounded-full font-semibold [&_svg]:size-[18px]">
              <a href={VENEZUELA_RELIEF_URL} onClick={dismiss}>
                <HeartHandshake className="mr-2" />
                {t('campaigns.home.venezuelaRelief.donate')}
              </a>
            </Button>
            <Button
              variant="outline"
              onClick={handleShare}
              className="rounded-full [&_svg]:size-[18px]"
            >
              <Share2 className="mr-2" />
              {t('campaigns.home.venezuelaRelief.share')}
            </Button>
          </DialogFooter>

          <a
            href={VENEZUELA_RELIEF_URL}
            onClick={dismiss}
            className="mt-3 inline-block text-sm font-medium text-primary underline underline-offset-4 hover:text-primary/80"
          >
            {t('campaigns.home.venezuelaRelief.learnMore')}
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default VenezuelaReliefPopup;
