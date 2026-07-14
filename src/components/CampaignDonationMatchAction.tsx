import { useState } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HandCoins } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  HDSendBitcoinDialog,
  type HDSendBitcoinResult,
} from '@/components/HDSendBitcoinDialog';
import { useAppContext } from '@/hooks/useAppContext';
import { useBtcPrice } from '@/hooks/useBtcPrice';
import { useCampaign } from '@/hooks/useCampaign';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useHdWalletAccess } from '@/hooks/useHdWalletAccess';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { verifyOnchainZap } from '@/hooks/useOnchainZaps';
import { CAMPAIGN_KIND, type ParsedCampaign } from '@/lib/campaign';
import { withAgoraTag } from '@/lib/agoraNoteTags';
import { cn } from '@/lib/utils';

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/;

/** Prefill USD for match-send, capped to cents so the picker stays tidy. */
function matchPrefillUsd(amountSats: number, btcPrice: number): number {
  return Math.round((amountSats / 100_000_000) * btcPrice * 100) / 100;
}

function parseCampaignCoordinate(event: NostrEvent): { pubkey: string; identifier: string } | null {
  if (event.kind !== 8333 || event.tags.some(([name]) => name === 'p')) return null;
  const value = event.tags.find(([name]) => name === 'a')?.[1];
  if (!value) return null;
  const [kind, pubkey, ...identifierParts] = value.split(':');
  const identifier = identifierParts.join(':');
  if (kind !== String(CAMPAIGN_KIND) || !HEX_PUBKEY_RE.test(pubkey ?? '') || !identifier) {
    return null;
  }
  return { pubkey, identifier };
}

/** Shared inputs for the match-send chip (8333 receipts and bare ledger rows). */
export interface CampaignMatchTarget {
  aTag: string;
  title: string;
  campaignPubkey: string;
  wallet: string;
  amountSats: number;
}

/**
 * Compact primary chip that opens Send Bitcoin prefilled to a campaign's
 * on-chain address for `amountSats`. Renders nothing unless the viewer is
 * logged in, holds an HD wallet, and isn't the campaign author.
 */
export function CampaignMatchSendButton({
  target,
  className,
}: {
  target: CampaignMatchTarget;
  className?: string;
}) {
  const { t } = useTranslation();
  const { user } = useCurrentUser();
  const { data: btcPrice } = useBtcPrice();
  const hdAccess = useHdWalletAccess();
  const queryClient = useQueryClient();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const [sendOpen, setSendOpen] = useState(false);

  if (
    !btcPrice ||
    !user ||
    user.pubkey === target.campaignPubkey ||
    hdAccess.status !== 'available' ||
    target.amountSats <= 0
  ) {
    return null;
  }

  const handleBroadcast = async (result: HDSendBitcoinResult) => {
    if (result.recipient.kind !== 'address' || result.recipient.address !== target.wallet) {
      throw new Error(t('campaignMatch.errors.wrongSettlementAddress'));
    }
    await publishEvent({
      kind: 8333,
      content: '',
      tags: withAgoraTag([
        ['i', `bitcoin:tx:${result.txid}`],
        ['amount', String(result.amountSats)],
        ['a', target.aTag],
        ['K', String(CAMPAIGN_KIND)],
        ['alt', `Donation to ${target.title}: ${result.amountSats.toLocaleString()} sats`],
      ]),
    });
    void queryClient.invalidateQueries({ queryKey: ['campaign-donations'] });
    void queryClient.invalidateQueries({ queryKey: ['bitcoin-balance'] });
    void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    void queryClient.invalidateQueries({ queryKey: ['campaigns-all'] });
    void queryClient.invalidateQueries({ queryKey: ['agora-feed'] });
    void queryClient.invalidateQueries({ queryKey: ['mixed-feed'] });
    void queryClient.invalidateQueries({ queryKey: ['address-ledger'] });
  };

  return (
    <span className={cn('inline-flex', className)} onClick={(clickEvent) => clickEvent.stopPropagation()}>
      <button
        type="button"
        title={t('campaignMatch.action')}
        onClick={() => setSendOpen(true)}
        className={cn(
          'inline-flex items-center gap-1.5 h-6 text-sm font-semibold text-primary whitespace-nowrap leading-none',
          'hover:underline underline-offset-2',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm',
          'active:opacity-80 motion-safe:transition-opacity',
        )}
      >
        <HandCoins className="size-3.5 shrink-0" aria-hidden />
        {t('campaignMatch.action')}
      </button>
      <HDSendBitcoinDialog
        isOpen={sendOpen}
        onClose={() => setSendOpen(false)}
        walletScope="public"
        btcPrice={btcPrice}
        initialRecipient={target.wallet}
        initialAmountUsd={matchPrefillUsd(target.amountSats, btcPrice)}
        onBroadcast={handleBroadcast}
      />
    </span>
  );
}

/** Match chip for a verified kind-8333 campaign donation receipt. */
export function CampaignDonationMatchAction({
  event,
  className,
}: {
  event: NostrEvent;
  className?: string;
}) {
  const { config } = useAppContext();
  const targetCoord = parseCampaignCoordinate(event);
  const { data: campaign } = useCampaign({
    pubkey: targetCoord?.pubkey ?? '',
    identifier: targetCoord?.identifier ?? '',
  });
  const wallet = campaign?.wallets.onchain?.value;
  const verification = useQuery({
    queryKey: ['campaign-donation-match', event.id, wallet ?? '', config.esploraApis],
    queryFn: ({ signal }) => verifyOnchainZap(event, config.esploraApis, wallet, signal),
    enabled: !!targetCoord && !!wallet,
    staleTime: 30_000,
  });

  if (!campaign || !wallet || !verification.data) return null;

  return (
    <CampaignMatchSendButton
      className={className}
      target={{
        aTag: campaign.aTag,
        title: campaign.title,
        campaignPubkey: campaign.pubkey,
        wallet,
        amountSats: verification.data.amountSats,
      }}
    />
  );
}

/** Match chip for a bare on-chain ledger inflow (no kind-8333 receipt). */
export function CampaignLedgerMatchAction({
  campaign,
  amountSats,
  className,
}: {
  campaign: ParsedCampaign;
  amountSats: number;
  className?: string;
}) {
  const wallet = campaign.wallets.onchain?.value;
  if (!wallet || amountSats <= 0) return null;

  return (
    <CampaignMatchSendButton
      className={className}
      target={{
        aTag: campaign.aTag,
        title: campaign.title,
        campaignPubkey: campaign.pubkey,
        wallet,
        amountSats,
      }}
    />
  );
}
