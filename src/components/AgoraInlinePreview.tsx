import type { NostrEvent } from '@nostrify/nostrify';
import type { ReactNode } from 'react';
import { useRef } from 'react';
import { CalendarClock, HandHeart, MapPin, Megaphone, ShieldCheck, Users } from 'lucide-react';
import { nip19 } from 'nostr-tools';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { CampaignRaisedAmount } from '@/components/CampaignRaisedAmount';
import { ProxiedImage } from '@/components/ProxiedImage';
import { useBtcPrice } from '@/hooks/useBtcPrice';
import { useCampaignDonations } from '@/hooks/useCampaignDonations';
import { useAuthor } from '@/hooks/useAuthor';
import { useNip05Verify } from '@/hooks/useNip05Verify';
import { useAppHostDirectory } from '@/hooks/useAppHostDirectory';
import { useInView } from '@/hooks/useInView';
import { parseAction } from '@/hooks/useActions';
import { getGeoDisplayName } from '@/lib/countries';
import { parseCampaign, getCampaignCountryLabel, getCampaignUrl } from '@/lib/campaign';
import { AGORA_HOST } from '@/lib/appUrls';
import { parseCommunityEvent } from '@/lib/communityUtils';
import { formatCampaignAmount, formatUsdGoal } from '@/lib/formatCampaignAmount';
import { formatCompactPledgeDeadline, formatPledgeAmount } from '@/lib/pledges';
import { sanitizeUrl } from '@/lib/sanitizeUrl';
import { cn } from '@/lib/utils';

function InlineShell({
  image,
  fallbackIcon,
  title,
  description,
  meta,
}: {
  image?: string;
  fallbackIcon: ReactNode;
  title: string;
  description?: string;
  meta?: ReactNode;
}) {
  return (
    <div className="mt-3 space-y-3">
      <div className="overflow-hidden rounded-xl bg-gradient-to-br from-primary/15 via-primary/5 to-secondary">
        {image ? (
          <ProxiedImage src={image} width={600} gated alt="" loading="lazy" className="aspect-[16/7] w-full object-cover" />
        ) : (
          <div className="flex aspect-[16/7] items-center justify-center text-primary/45">
            {fallbackIcon}
          </div>
        )}
      </div>
      <div className="space-y-2">
        <h3 className="text-base font-bold leading-tight tracking-tight line-clamp-2">{title}</h3>
        {description?.trim() ? (
          <p className="text-sm leading-relaxed text-muted-foreground line-clamp-3">{description}</p>
        ) : null}
        {meta}
      </div>
    </div>
  );
}

export function CampaignInlinePreview({ event }: { event: NostrEvent }) {
  const { t } = useTranslation();
  const campaign = parseCampaign(event);
  const { data: btcPrice } = useBtcPrice();
  // Defer the Esplora-backed donation lookup until the preview scrolls into
  // view — feeds can render many of these, and fetching all of them eagerly
  // contributed to the Esplora rate-limiting storm.
  const previewRef = useRef<HTMLAnchorElement>(null);
  const inView = useInView(previewRef);
  const { data: stats } = useCampaignDonations(campaign ?? undefined, { enabled: inView });
  const author = useAuthor(event.pubkey);
  const authorNip05 = author.data?.metadata?.nip05;
  const { data: nip05Verified } = useNip05Verify(authorNip05, event.pubkey);
  const { data: directory } = useAppHostDirectory();
  if (!campaign) return null;

  const authorMetadata = author.data?.metadata;
  const cover = sanitizeUrl(campaign.banner)
    ?? sanitizeUrl(authorMetadata?.banner)
    ?? sanitizeUrl(authorMetadata?.picture);
  const campaignUrl = getCampaignUrl(campaign, {
    nip05: authorNip05,
    nip05Verified: nip05Verified === true,
    directoryName: directory?.get(event.pubkey),
    appHost: AGORA_HOST,
  });
  const countryLabel = getCampaignCountryLabel(campaign);
  const isSilentPayment = !campaign.wallets.onchain;
  const hasSp = !!campaign.wallets.sp;
  const goalLabel = campaign.goalUsd && campaign.goalUsd > 0 ? formatUsdGoal(campaign.goalUsd) : undefined;
  const raisedSats = stats?.totalSats ?? 0;
  const hasRaised = raisedSats > 0;

  return (
    <Link ref={previewRef} to={campaignUrl} onClick={(e) => e.stopPropagation()} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background">
      <InlineShell
        image={cover}
        fallbackIcon={<HandHeart className="size-12" />}
        title={campaign.title}
        description={campaign.story}
        meta={(
          <div className="space-y-1 pt-1">
            {isSilentPayment ? (
              <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="size-3.5 shrink-0" />
                {goalLabel
                  ? t('campaignsDetail.target', { amount: goalLabel })
                  : t('campaignsDetail.privateCampaign')}
              </div>
            ) : (
              <>
                {hasRaised ? (
                  <div>
                    <CampaignRaisedAmount className="text-lg text-primary">
                      {formatCampaignAmount(raisedSats, btcPrice)}
                    </CampaignRaisedAmount>
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {hasSp ? t('campaignsDetail.raisedPublicly') : t('campaignsDetail.raised')}
                    </span>
                  </div>
                ) : (
                  <div className="text-sm font-bold leading-tight text-primary">
                    {t('campaignsDetail.beFirstDonor')}
                  </div>
                )}
                {goalLabel && (
                  <div className="text-xs text-muted-foreground">
                    {hasRaised
                      ? t('campaignsDetail.ofGoal', { amount: goalLabel })
                      : t('campaignsDetail.goalAmount', { amount: goalLabel })}
                  </div>
                )}
              </>
            )}
            {countryLabel && (
              <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                {countryLabel}
              </div>
            )}
          </div>
        )}
      />
    </Link>
  );
}

export function PledgeInlinePreview({ event }: { event: NostrEvent }) {
  const { t } = useTranslation();
  const pledge = parseAction(event);
  const { data: btcPrice } = useBtcPrice();
  if (!pledge) return null;

  const naddr = nip19.naddrEncode({ kind: 36639, pubkey: pledge.pubkey, identifier: pledge.id });
  const countryLabel = pledge.countryCode ? getGeoDisplayName(pledge.countryCode) : undefined;
  const deadline = pledge.deadline ? formatCompactPledgeDeadline(pledge.deadline) : undefined;

  return (
    <Link to={`/${naddr}`} onClick={(e) => e.stopPropagation()} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background">
      <InlineShell
        image={pledge.image}
        fallbackIcon={<Megaphone className="size-12" />}
        title={pledge.title}
        description={pledge.description}
        meta={(
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 text-xs text-muted-foreground">
            <span className="inline-flex items-baseline gap-1.5">
              <span className="font-semibold uppercase tracking-wide text-primary">{t('pledges.card.pledged')}</span>
              <span className="text-sm font-bold text-foreground">{formatPledgeAmount(pledge.bounty, btcPrice)}</span>
            </span>
            {countryLabel && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-3.5" />
                {countryLabel}
              </span>
            )}
            {deadline && (
              <span className={cn('inline-flex items-center gap-1.5', deadline.isPast && 'text-destructive')}>
                <CalendarClock className="size-3.5" />
                {deadline.label}
              </span>
            )}
          </div>
        )}
      />
    </Link>
  );
}

export function GroupInlinePreview({ event }: { event: NostrEvent }) {
  const { t } = useTranslation();
  const group = parseCommunityEvent(event);
  if (!group) return null;

  const naddr = nip19.naddrEncode({ kind: event.kind, pubkey: event.pubkey, identifier: group.dTag });
  const countryLabel = group.countryCode ? getGeoDisplayName(group.countryCode) : undefined;

  return (
    <Link to={`/${naddr}`} onClick={(e) => e.stopPropagation()} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background">
      <InlineShell
        image={group.image}
        fallbackIcon={<Users className="size-12" />}
        title={group.name}
        description={group.description}
        meta={(
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Users className="size-3.5" />
              {t('groups.create.moderatorsCount', { count: group.moderatorPubkeys.length })}
            </span>
            {countryLabel && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-3.5" />
                {countryLabel}
              </span>
            )}
          </div>
        )}
      />
    </Link>
  );
}
