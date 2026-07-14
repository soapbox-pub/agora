import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  Archive,
  ChevronLeft,
  CreditCard,
  HandHeart,
  Pencil,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Wallet,
} from 'lucide-react';

import { AuthorByline } from '@/components/AuthorByline';
import {
  CampaignLedgerHeader,
  CampaignLedgerTransaction,
} from '@/components/CampaignLedger';
import { CampaignVerificationBadge } from '@/components/CampaignVerificationBadge';
import { UnverifiedCampaignBanner } from '@/components/UnverifiedCampaignBanner';
import { HiddenCampaignGate } from '@/components/HiddenCampaignGate';
import { CommentsSection } from '@/components/CommentsSection';
import {
  CampaignWalletDonatePanel,
} from '@/components/CampaignWalletDonatePanel';
import { HDSendBitcoinDialog } from '@/components/HDSendBitcoinDialog';
import { Lightbox } from '@/components/ImageGallery';
import { NoBitcoinDialog } from '@/components/NoBitcoinDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { DetailCommentComposer } from '@/components/DetailCommentComposer';
import { DetailReplySkeleton, DetailStory } from '@/components/DetailStory';
import { PostActionBar } from '@/components/PostActionBar';
import { PinnedCommentHeader } from '@/components/PinnedCommentHeader';
import { PendingBadge } from '@/components/PendingBadge';
import { ReplyComposeModal } from '@/components/ReplyComposeModal';
import { NoteMoreMenu } from '@/components/NoteMoreMenu';
import { NoteCard } from '@/components/NoteCard';
import { Progress } from '@/components/ui/progress';
import { ThreadedReplyList, type ReplyNode } from '@/components/ThreadedReplyList';
import { useAppContext } from '@/hooks/useAppContext';
import { useAddressLedger } from '@/hooks/useAddressLedger';
import { useAuthor } from '@/hooks/useAuthor';
import { useBtcPrice } from '@/hooks/useBtcPrice';
import { useCampaign } from '@/hooks/useCampaign';
import { useCampaignDonations } from '@/hooks/useCampaignDonations';
import { useCampaignModeration } from '@/hooks/useCampaignModeration';
import { useCampaignTrustedVerification } from '@/hooks/useCampaignTrustedVerification';
import { useCampaignTombstone } from '@/hooks/useCampaignTombstone';
import { useComments } from '@/hooks/useComments';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useDeleteEvent } from '@/hooks/useDeleteEvent';
import { useHdWalletAccess } from '@/hooks/useHdWalletAccess';
import { usePinnedEventComments } from '@/hooks/usePinnedEventComments';
import { useShareOrigin } from '@/hooks/useShareOrigin';
import { useNip05Verify } from '@/hooks/useNip05Verify';
import { extractOnchainZapTxid } from '@/hooks/useOnchainZaps';
import { useAppHostDirectory } from '@/hooks/useAppHostDirectory';
import { useToast } from '@/hooks/useToast';
import { useEventTranslation } from '@/hooks/useEventTranslation';
import {
  encodeCampaignNaddr,
  getCampaignCountryLabel,
  getCampaignUrl,
  parseCampaign,
  type ParsedCampaign,
} from '@/lib/campaign';
import { satsToUSDWhole, type AddressTransaction } from '@/lib/bitcoin';
import { AGORA_HOST } from '@/lib/appUrls';
import { formatUsdGoal } from '@/lib/formatCampaignAmount';
import { sanitizeUrl } from '@/lib/sanitizeUrl';
import { openUrl } from '@/lib/downloadFile';
import { cn } from '@/lib/utils';
import NotFound from './NotFound';

interface CampaignDetailPageProps {
  /** Campaign author hex pubkey from the decoded naddr. */
  pubkey: string;
  /** Campaign `d` tag identifier from the decoded naddr. */
  identifier: string;
  /** Optional relay hints from the naddr. */
  relays?: string[];
}

type CampaignActivityItem =
  | { type: 'comment'; node: ReplyNode; timestamp: number }
  | { type: 'transaction'; tx: AddressTransaction; receipt?: NostrEvent; timestamp: number }
  | { type: 'receipt'; receipt: NostrEvent; timestamp: number };

function formatSatsFull(sats: number, btcPrice: number | undefined): string {
  if (btcPrice) return satsToUSDWhole(sats, btcPrice);
  if (sats >= 100_000_000) return `${(sats / 100_000_000).toLocaleString(undefined, { maximumFractionDigits: 4 })} BTC`;
  return `${sats.toLocaleString()} sats`;
}

function collectReplyEvents(nodes: ReplyNode[], out = new Map<string, NostrEvent>()): Map<string, NostrEvent> {
  for (const node of nodes) {
    out.set(node.event.id, node.event);
    collectReplyEvents(node.children, out);
    if (node.hiddenChildren) collectReplyEvents(node.hiddenChildren, out);
  }
  return out;
}

/**
 * Aggregate kind 8333 donation receipts by `(txid, donor)` for the archived
 * campaign view, preserving legacy multi-beneficiary receipt totals.
 */
function aggregateDonationReceipts(receipts: NostrEvent[]): NostrEvent[] {
  type Aggregate = { canonical: NostrEvent; totalSats: number };
  const byDonation = new Map<string, Aggregate>();

  for (const receipt of receipts) {
    const txid = extractOnchainZapTxid(receipt);
    const amountTag = receipt.tags.find(([n]) => n === 'amount')?.[1];
    const amount = amountTag ? Number(amountTag) : NaN;
    if (!txid || !Number.isFinite(amount) || amount <= 0) continue;

    const key = `${txid}:${receipt.pubkey}`;
    const prev = byDonation.get(key);
    const totalSats = (prev?.totalSats ?? 0) + amount;
    const canonical = prev && prev.canonical.created_at >= receipt.created_at
      ? prev.canonical
      : receipt;
    byDonation.set(key, { canonical, totalSats });
  }

  return Array.from(byDonation.values()).map(({ canonical, totalSats }) => ({
    ...canonical,
    tags: [
      ...canonical.tags.filter(([n]) => n !== 'amount'),
      ['amount', String(totalSats)],
    ],
  }));
}

export function CampaignDetailPage({ pubkey, identifier, relays }: CampaignDetailPageProps) {
  // Drop the default 600px column cap and the default right widget sidebar
  // — this page renders its own GoFundMe-style 2-column layout (article on
  // the left, sticky donate card on the right). We don't pass a custom
  // rightSidebar through MainLayout because the column needs to scroll
  // with the article on mobile (where the sidebar slot is invisible
  // anyway). Keeping everything in one Outlet lets us inline the donate
  // column below the hero on small screens.

  const { data: campaign, isLoading, isError } = useCampaign({ pubkey, identifier, relays });

  if (isLoading) return <CampaignDetailSkeleton />;

  // The coordinate no longer resolves to a live campaign — either it was
  // deleted (NIP-09) or relays dropped it. Before 404ing, check whether
  // donation receipts reference the coordinate; if so, render a read-only
  // tombstone so the public donation record stays reachable in the client.
  if (isError || !campaign) {
    return <CampaignTombstoneGate pubkey={pubkey} identifier={identifier} />;
  }

  return <CampaignDetailContent campaign={campaign} />;
}

function CampaignDetailContent({ campaign }: { campaign: ParsedCampaign }) {
  const { t } = useTranslation();
  const { config } = useAppContext();
  const { user } = useCurrentUser();
  const author = useAuthor(campaign.pubkey);
  const { data: btcPrice } = useBtcPrice();
  // Detail page is a single instance, so live polling here is safe (unlike
  // the card grids, which must not poll — see useCampaignDonations).
  const { data: stats, isLoading: statsLoading } = useCampaignDonations(campaign, {
    refetchInterval: 30_000,
  });
  const navigate = useNavigate();
  const { toast } = useToast();
  const shareOrigin = useShareOrigin();
  const queryClient = useQueryClient();

  const [replyOpen, setReplyOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [coverLightboxOpen, setCoverLightboxOpen] = useState(false);
  const { translatedEvent, translateAction } = useEventTranslation(campaign.event);
  const displayCampaign = useMemo(() => parseCampaign(translatedEvent) ?? campaign, [translatedEvent, campaign]);

  const deleteMutation = useDeleteEvent();

  const { data: commentsData, isLoading: commentsLoading } = useComments(
    campaign.event,
    500,
  );
  const {
    pinnedIds,
    pinnedEvents,
    isPinned,
    canManagePins,
    togglePin,
  } = usePinnedEventComments(campaign.aTag, campaign.pubkey);

  // Verified receipts carry the amount actually paid to this campaign. Keep
  // one display event per txid so retries cannot duplicate a ledger entry.
  const donationReceipts = useMemo(
    (): NostrEvent[] => (stats?.verified ?? []).map(({ event, amountSats }) => ({
      ...event,
      tags: [
        ...event.tags.filter(([name]) => name !== 'amount'),
        ['amount', String(amountSats)],
      ],
    })),
    [stats?.verified],
  );

  const replyTree = useMemo((): ReplyNode[] => {
    const topLevelComments = commentsData?.topLevelComments ?? [];

    const buildCommentNode = (ev: NostrEvent): ReplyNode => {
      const allChildren = commentsData?.getDirectReplies(ev.id) ?? [];
      if (allChildren.length <= 1) {
        return {
          event: ev,
          children: allChildren.map((c) => buildCommentNode(c)),
        };
      }
      const [first, ...rest] = allChildren;
      return {
        event: ev,
        children: [buildCommentNode(first)],
        hiddenChildren: rest.map((c) => buildCommentNode(c)),
      };
    };

    const commentNodes = topLevelComments.map((c) => buildCommentNode(c));
    return commentNodes.sort(
      (a, b) => b.event.created_at - a.event.created_at,
    );
  }, [commentsData]);

  const onchainAddress = campaign.wallets.onchain?.value;
  const ledgerQuery = useAddressLedger(onchainAddress, !!onchainAddress);
  const ledgerTransactions = useMemo(
    () => ledgerQuery.data?.pages.flat() ?? [],
    [ledgerQuery.data?.pages],
  );
  const activityItems = useMemo((): CampaignActivityItem[] => {
    const receiptsByTxid = new Map<string, NostrEvent>();
    for (const receipt of donationReceipts) {
      const txid = extractOnchainZapTxid(receipt);
      if (txid) receiptsByTxid.set(txid, receipt);
    }

    const items: CampaignActivityItem[] = replyTree.map((node) => ({
      type: 'comment',
      node,
      timestamp: node.event.created_at,
    }));

    for (const tx of ledgerTransactions) {
      const receipt = receiptsByTxid.get(tx.txid);
      if (receipt) receiptsByTxid.delete(tx.txid);
      items.push({
        type: 'transaction',
        tx,
        receipt,
        // Esplora has no timestamp for mempool transactions. Keep those at
        // the top, matching the ordering of its address-history endpoint.
        timestamp: tx.blockTime ?? receipt?.created_at ?? Number.MAX_SAFE_INTEGER,
      });
    }

    for (const receipt of receiptsByTxid.values()) {
      items.push({ type: 'receipt', receipt, timestamp: receipt.created_at });
    }

    return items.sort((a, b) => b.timestamp - a.timestamp);
  }, [donationReceipts, ledgerTransactions, replyTree]);

  const feedEventsById = useMemo(() => collectReplyEvents(replyTree), [replyTree]);

  const pinnedNodes = useMemo((): ReplyNode[] => {
    return pinnedIds
      .map((id) => feedEventsById.get(id) ?? pinnedEvents.find((event) => event.id === id))
      .filter((event): event is NostrEvent => !!event)
      .map((event): ReplyNode => ({ event, children: [] }));
  }, [feedEventsById, pinnedEvents, pinnedIds]);

  const authorMetadata = author.data?.metadata;
  const cover = sanitizeUrl(campaign.banner) ?? sanitizeUrl(authorMetadata?.banner) ?? sanitizeUrl(authorMetadata?.picture);

  const countryLabel = getCampaignCountryLabel(campaign);
  const raisedSats = stats?.totalSats ?? 0;
  const pendingSats = stats?.pendingSats ?? 0;
  const inflowCount = stats?.inflowCount ?? 0;

  const isCreator = user?.pubkey === campaign.pubkey;
  const naddr = useMemo(() => encodeCampaignNaddr(campaign), [campaign]);

  // Whether to surface the "not verified by a trusted source" caution UI.
  // Computed once here so the top banner and the hero's mobile toolbar band
  // stay in sync (the band tints amber to merge visually with the banner
  // above it, instead of leaving a stray black strip between banner and
  // cover image on mobile). Suppressed while loading and for trusted-
  // verified campaigns.
  const { isTrustedVerified, isLoading: verificationLoading } =
    useCampaignTrustedVerification(campaign.aTag);
  const showUnverified = !verificationLoading && !isTrustedVerified;

  // Hidden-campaign gate. Campaigns moderators have hidden (an
  // `agora.moderation` `hidden` label) are filtered out of the app's feeds,
  // so this only fires when a visitor arrives via a direct/shared link. We
  // show a soft interstitial (not censorship — one click reveals it) until
  // the visitor chooses to proceed. Gated on `isReady` so a verified-live
  // campaign never flashes the gate before moderation labels resolve.
  const { data: moderation, isReady: moderationReady } = useCampaignModeration();
  const [hiddenRevealed, setHiddenRevealed] = useState(false);
  const isHidden = moderationReady && moderation.hiddenCoords.has(campaign.aTag);
  // Prefer the shortest trusted pretty `/{nip05}/{d-tag}` path — app-host
  // directory name first, then the author's verified kind-0 NIP-05 — and
  // fall back to the naddr URL otherwise (a spoofed NIP-05 can never hijack
  // the shared link). See getCampaignUrl for the full precedence.
  const { data: nip05Verified } = useNip05Verify(authorMetadata?.nip05, campaign.pubkey);
  const { data: hostDirectory } = useAppHostDirectory();
  const campaignPath = getCampaignUrl(campaign, {
    nip05: authorMetadata?.nip05,
    nip05Verified: nip05Verified === true,
    directoryName: hostDirectory?.get(campaign.pubkey),
    appHost: AGORA_HOST,
  });
  const shareUrl = useMemo(() => `${shareOrigin}${campaignPath}`, [shareOrigin, campaignPath]);
  const storyEvent = useMemo(
    () => ({
      ...displayCampaign.event,
      tags: displayCampaign.event.tags.filter(([name]) => !['banner', 'imeta', 'summary', 'title', 'w'].includes(name)),
    }),
    [displayCampaign.event],
  );

  useSeoMeta({
    title: t('campaignsDetail.seoTitle', { title: displayCampaign.title, appName: config.appName }),
    description: displayCampaign.summary || t('campaignsDetail.seoDescriptionFallback', { title: displayCampaign.title, appName: config.appName }),
    ogImage: cover,
  });

  const handleShare = async () => {
    try {
      const nav = typeof navigator !== 'undefined' ? navigator : undefined;
      if (nav?.share) {
        await nav.share({ title: displayCampaign.title, text: displayCampaign.summary, url: shareUrl });
      } else if (nav?.clipboard) {
        await nav.clipboard.writeText(shareUrl);
        toast({ title: t('campaignsDetail.linkCopied') });
      }
    } catch {
      // User likely cancelled the share sheet; nothing to do.
    }
  };

  const handleDeleteCampaign = () => {
    deleteMutation.mutate(
      {
        eventId: campaign.event.id,
        eventKind: campaign.event.kind,
        eventPubkey: campaign.pubkey,
        eventDTag: campaign.identifier,
      },
      {
        onSuccess: () => {
          toast({
            title: t('campaignsDetail.deletedToast'),
            description: t('campaignsDetail.deletedToastDesc'),
          });
          setDeleteConfirmOpen(false);
          void queryClient.invalidateQueries({ queryKey: ['campaign', campaign.pubkey, campaign.identifier] });
          void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
          void queryClient.invalidateQueries({ queryKey: ['campaigns-all'] });
          // Campaigns may be attached to an organization via an `A` tag;
          // refresh the org's activity shelf so the deleted campaign drops
          // off without a page refresh.
          const orgATag = campaign.event.tags.find(([n]) => n === 'A')?.[1];
          if (orgATag) {
            void queryClient.invalidateQueries({ queryKey: ['organization-activity', orgATag] });
          }
          // Country-tagged campaigns surface in the country feed.
          if (campaign.countryCode) {
            void queryClient.invalidateQueries({ queryKey: ['agora-feed-paginated', campaign.countryCode] });
            void queryClient.invalidateQueries({ queryKey: ['agora-feed-new-posts', campaign.countryCode] });
          }
          navigate('/');
        },
        onError: (error: unknown) => {
          const msg = error instanceof Error ? error.message : String(error);
          toast({
            title: t('campaignsDetail.deleteErrorTitle'),
            description: msg,
            variant: 'destructive',
          });
        },
      },
    );
  };

  // ── Donate column ──
  // Rendered twice in the JSX tree below: once inline under the hero on
  // mobile (`lg:hidden`), once as the sticky right column on desktop
  // (`hidden lg:block`). Building it as a const here keeps both call
  // sites in sync — single source of truth for the donate UX.
  const donateColumn = (
    <DonateColumn
      campaign={campaign}
      raisedSats={raisedSats}
      pendingSats={pendingSats}
      inflowCount={inflowCount}
      statsLoading={statsLoading}
      btcPrice={btcPrice}
      onShare={handleShare}
    />
  );

  // Block hidden campaigns behind the soft interstitial until the visitor
  // opts in. The real campaign UI below is not rendered while gated.
  if (isHidden && !hiddenRevealed) {
    return (
      <HiddenCampaignGate
        onBack={() => navigate(-1)}
        onProceed={() => setHiddenRevealed(true)}
      />
    );
  }

  return (
    <main className="min-h-screen pb-16">
      {/* Full-bleed caution strip above the hero for campaigns not verified
          by a trusted source. Desktop-only: on mobile the same notice is
          rendered inside the hero's amber toolbar band (see `CampaignHero`)
          so it merges with the back/admin controls into one region. */}
      {showUnverified && <UnverifiedCampaignBanner className="hidden sm:flex" />}

      {/* Full-bleed cover image. Title, summary, byline, meta, and the
          action bar live in `CampaignHeading` below the banner — the
          image stays unobstructed so banners with baked-in text are
          fully visible. */}
      <CampaignHero
        cover={cover}
        isCreator={isCreator}
        naddr={naddr}
        unverified={showUnverified}
        deleteDisabled={deleteMutation.isPending}
        onBack={() => navigate(-1)}
        onDelete={() => setDeleteConfirmOpen(true)}
        onCoverClick={cover ? () => setCoverLightboxOpen(true) : undefined}
      />

      <CampaignHeading
        campaign={displayCampaign}
        creatorPubkey={campaign.pubkey}
        countryLabel={countryLabel}
        onReply={() => setReplyOpen(true)}
        onMore={() => setMoreMenuOpen(true)}
        shareUrl={shareUrl}
        translateAction={translateAction}
      />

      {/* Body region. Background stays flat — the warmth lives on the
          sidebar and comments surfaces, not in the page itself. The
          hero's `from-black/95` cap is the only transition into the
          body. */}
      <div className="relative">

        {pinnedNodes.length > 0 && (
          <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-6">
            <div className="rounded-2xl bg-card border border-border/60 overflow-hidden">
              <ThreadedReplyList
                roots={pinnedNodes}
                hideCommentContext
                leafCardClassName="py-4"
                renderAuthorBadge={(event) =>
                  event.pubkey === campaign.pubkey ? <CampaignerBadge /> : null
                }
                renderItemHeader={(event) => (
                  <CampaignPinHeader
                    canManagePins={canManagePins}
                    isPinned={isPinned(event.id)}
                    pinPending={togglePin.isPending}
                    onTogglePin={() => handleTogglePin(event)}
                  />
                )}
              />
            </div>
          </div>
        )}

        {/* Two-column body. On mobile the right column collapses inline
            immediately below the hero so the donate CTA stays above the
            fold. On lg+ the right column sticks to the viewport edge of
            the main content while the article scrolls. */}
        <div className="relative max-w-6xl mx-auto px-5 sm:px-6 lg:px-0 py-6 lg:py-10">
        <div className="lg:flex lg:gap-8 lg:items-start">
          {/* Mobile-only inline donate card */}
          <div className="lg:hidden mb-6">{donateColumn}</div>

          {/* Main article column */}
          <div className="flex-1 min-w-0 space-y-8">
            {displayCampaign.story.trim().length > 0 && (
              <CampaignStory storyEvent={storyEvent} />
            )}

            {/* Engagement counters live in the hero PostActionBar only. */}
            <div id="campaign-activity" className="scroll-mt-20">
              {onchainAddress ? (
                <div className="mt-4">
                  <CampaignLedgerHeader address={onchainAddress} />
                </div>
              ) : null}

              <CommentsSection className={onchainAddress ? 'mt-0' : undefined}>
                <DetailCommentComposer
                  event={campaign.event}
                  onSuccess={() => queryClient.invalidateQueries({ queryKey: ['nostr', 'comments'] })}
                />

                {(commentsLoading || statsLoading || ledgerQuery.isLoading) && activityItems.length === 0 ? (
                  <div>
                    {Array.from({ length: 3 }).map((_, i) => (
                      <DetailReplySkeleton key={i} />
                    ))}
                  </div>
                ) : activityItems.length > 0 ? (
                  <div>
                    {activityItems.map((item) => {
                      if (item.type === 'comment') {
                        return (
                          <ThreadedReplyList
                            key={item.node.event.id}
                            roots={[item.node]}
                            hideCommentContext
                            leafCardClassName="py-4"
                            renderAuthorBadge={(event) =>
                              event.pubkey === campaign.pubkey ? <CampaignerBadge /> : null
                            }
                            renderItemHeader={(event) => (
                              <CampaignPinHeader
                                canManagePins={canManagePins}
                                isPinned={isPinned(event.id)}
                                pinPending={togglePin.isPending}
                                onTogglePin={() => handleTogglePin(event)}
                              />
                            )}
                          />
                        );
                      }

                      if (item.type === 'receipt') {
                        return (
                          <ThreadedReplyList
                            key={item.receipt.id}
                            roots={[{ event: item.receipt, children: [] }]}
                            hideCommentContext
                            leafCardClassName="py-4"
                          />
                        );
                      }

                      if (item.receipt) {
                        return (
                          <NoteCard
                            key={item.tx.txid}
                            event={item.receipt}
                            className="py-4"
                            hideCommentContext
                            donationTransaction={item.tx}
                          />
                        );
                      }

                      return (
                        <div key={item.tx.txid} className="border-b border-primary/20 bg-background/40">
                          <CampaignLedgerTransaction
                            tx={item.tx}
                            btcPrice={btcPrice}
                            campaign={displayCampaign}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setReplyOpen(true)}
                    className="block w-full px-6 py-10 text-center hover:bg-foreground/5 transition-colors"
                  >
                    <p className="text-base font-medium text-foreground">
                      {t('campaignsDetail.noCommentsTitle')}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t('campaignsDetail.noCommentsHint')}
                    </p>
                  </button>
                )}

                {ledgerQuery.isError ? (
                  <div className="border-t border-primary/20 px-5 py-4 text-center text-sm text-muted-foreground">
                    {t('campaignsDetail.ledger.error')}
                  </div>
                ) : null}
                {ledgerQuery.hasNextPage ? (
                  <div className="flex justify-center border-t border-primary/20 px-4 py-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void ledgerQuery.fetchNextPage()}
                      disabled={ledgerQuery.isFetchingNextPage}
                    >
                      {ledgerQuery.isFetchingNextPage
                        ? t('campaignsDetail.ledger.loadingMore')
                        : t('campaignsDetail.ledger.loadMore')}
                    </Button>
                  </div>
                ) : null}
              </CommentsSection>
            </div>
          </div>

          {/* Desktop-only donate column. The sticky inner wrapper tracks the
              viewport while there's room to slide. When the donate card is
              taller than the viewport (e.g. a campaign with many
              beneficiaries) the bottom is reachable via the normal page
              scroll: as the user scrolls down the article, the sticky
              wrapper rides along until the flex row ends, exposing the
              bottom of the column. This is preferable to capping the
              column's height with `max-h` + `overflow-y-auto`, which traps
              content behind a second scrollbar and visually clips the
              bottom of the card. */}
          <aside className="hidden lg:block lg:w-[360px] lg:shrink-0 lg:self-start">
            <div className="lg:sticky lg:top-4">{donateColumn}</div>
          </aside>
        </div>
      </div>
      </div>

      <ReplyComposeModal
        event={campaign.event}
        open={replyOpen}
        onOpenChange={setReplyOpen}
      />
      <NoteMoreMenu
        event={campaign.event}
        open={moreMenuOpen}
        onOpenChange={setMoreMenuOpen}
      />

      {cover && coverLightboxOpen && (
        <Lightbox
          images={[cover]}
          currentIndex={0}
          onClose={() => setCoverLightboxOpen(false)}
          onNext={() => {}}
          onPrev={() => {}}
        />
      )}

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('campaignsDetail.deleteDialogTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('campaignsDetail.deleteDialogBody')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDeleteCampaign();
              }}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? t('campaignsDetail.deleting') : t('campaignsDetail.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );

  function handleTogglePin(event: NostrEvent) {
    const wasPinned = isPinned(event.id);
    togglePin.mutate(event.id, {
      onSuccess: () => {
        toast({ title: wasPinned ? t('campaignsDetail.unpinnedToast') : t('campaignsDetail.pinnedToast') });
      },
      onError: () => {
        toast({ title: t('campaignsDetail.pinFailed'), variant: 'destructive' });
      },
    });
  }
}

function CampaignPinHeader({
  canManagePins,
  isPinned,
  pinPending,
  onTogglePin,
}: {
  canManagePins: boolean;
  isPinned: boolean;
  pinPending: boolean;
  onTogglePin: () => void;
}) {
  return (
    <PinnedCommentHeader
      isPinned={isPinned}
      canManagePins={canManagePins}
      pinPending={pinPending}
      onTogglePin={onTogglePin}
    />
  );
}

/**
 * Pill badge marking a comment authored by the campaign's creator.
 * Rendered inside `NoteCard`'s author row via `renderAuthorBadge`, so
 * the marker appears next to the campaigner's display name on every
 * comment they post — not just pinned ones.
 */
function CampaignerBadge() {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary shrink-0">
      <ShieldCheck className="size-3" />
      {t('campaignsDetail.campaigner')}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Hero — full-bleed cover with title, creator, meta, and the
// back / admin controls all overlaid on the image. The banner is the
// page's emotional entry point: the photo carries the campaign's story
// at a glance, and the overlay text makes the pitch readable without
// taking the reader off the image.
// ─────────────────────────────────────────────────────────────────────

interface CampaignHeroProps {
  cover: string | undefined;
  isCreator: boolean;
  naddr: string;
  /** When true, the mobile toolbar band tints amber so it merges with the
      unverified caution strip rendered directly above the hero. */
  unverified?: boolean;
  deleteDisabled: boolean;
  onBack: () => void;
  onDelete: () => void;
  /** Click the cover image to open it in the fullscreen Lightbox. Pass
      `undefined` to disable (e.g. when there is no cover image). */
  onCoverClick: (() => void) | undefined;
}

function CampaignHero({
  cover,
  isCreator,
  naddr,
  unverified = false,
  deleteDisabled,
  onBack,
  onDelete,
  onCoverClick,
}: CampaignHeroProps) {
  const { t } = useTranslation();

  return (
    <>
      {/* Band ABOVE the banner. On mobile it hosts the back / admin
          toolbar so the chips sit on a plain surface instead of overlaying
          the banner image (and any baked-in text). On `sm:` upward the
          toolbar moves inside the header (chip overlay), but this band stays
          as a thin strip above the banner so the banner reads as a framed
          window into the image rather than a floating block on the page
          background.

          When the campaign is unverified, this band becomes the mobile home
          of the caution notice: it tints amber and renders the warning text
          as a second row directly beneath the toolbar, so the back arrow,
          admin actions, and warning read as one cohesive amber region. The
          standalone full-width `UnverifiedCampaignBanner` is desktop-only
          (`sm:`+); on mobile the message lives here instead. */}
      <div
        className={cn(
          unverified
            ? 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100'
            : 'bg-black text-white',
        )}
      >
        <div className="sm:hidden px-3 pt-[max(var(--safe-area-inset-top,env(safe-area-inset-top,0px)),0.5rem)] pb-2">
          {/* Single row: back arrow on the left, then the caution message
              inline beside it (when unverified), then admin actions on the
              right — so the arrow and warning read as one connected unit
              rather than stacked rows. */}
          <div className="flex items-center gap-2">
            <button
              onClick={onBack}
              className={cn(
                'inline-flex shrink-0 items-center justify-center size-10 -ml-2 rounded-full focus-visible:outline-none focus-visible:ring-2 motion-safe:transition-colors',
                unverified
                  ? 'text-amber-900 hover:bg-amber-900/10 focus-visible:ring-amber-500 dark:text-amber-100 dark:hover:bg-amber-100/10'
                  : 'text-white hover:bg-white/10 focus-visible:ring-white/80',
              )}
              aria-label={t('common.goBack')}
            >
              <ChevronLeft className="size-5 rtl:rotate-180" />
            </button>

            {/* Caution message, inline beside the arrow. Takes the remaining
                width so the admin actions stay pinned right. */}
            {unverified && (
              <p className="flex-1 min-w-0 flex items-start gap-1.5 text-[13px] leading-snug">
                <ShieldAlert aria-hidden className="mt-px size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>
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
                </span>
              </p>
            )}

            <div className={cn('flex items-center gap-1.5 shrink-0', !unverified && 'ml-auto')}>
              {isCreator && (
                <>
                  <Button
                    asChild
                    size="sm"
                    variant="ghost"
                    className={cn(
                      'h-10 rounded-full',
                      unverified
                        ? 'text-amber-900 hover:bg-amber-900/10 hover:text-amber-900 dark:text-amber-100 dark:hover:bg-amber-100/10 dark:hover:text-amber-100'
                        : 'text-white hover:bg-white/10 hover:text-white',
                    )}
                  >
                    <Link to={`/campaigns/new?edit=${encodeURIComponent(naddr)}`} aria-label={t('campaignsDetail.edit')}>
                      <Pencil className="size-4" />
                    </Link>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={onDelete}
                    disabled={deleteDisabled}
                    aria-label={t('campaignsDetail.delete')}
                    className={cn(
                      'h-10 rounded-full',
                      unverified
                        ? 'text-amber-900 hover:bg-destructive/20 hover:text-amber-900 dark:text-amber-100 dark:hover:text-amber-100'
                        : 'text-white hover:bg-destructive/30 hover:text-white',
                    )}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Full-bleed banner that respects the source image. The section
          stretches edge to edge of the viewport and takes its height
          from the contained image (capped at 70vh so an extreme
          portrait banner can't eat the whole screen). The blurred,
          scaled backdrop fills that full width so the banner never
          reads as a floating box. The sharp `object-contain`
          foreground image is capped to the same `max-w-6xl` reading
          column and centered, so the actual banner pixels are never
          cropped — anything outside the image's natural frame is the
          soft blurred bleed. */}
      <header className="relative isolate w-full overflow-hidden bg-black shadow-lg shadow-black/25">
        {cover ? (
          <>
            {/* Blurred bleed: a scaled-up, soft copy of the same image
                fills the full-bleed gutters around the contained
                foreground. `scale-110` hides the soft edges left by
                `blur-2xl`. `brightness-75` keeps the bleed shadowy so
                the centered sharp image visually dominates.
                `aria-hidden` because the foreground image already
                conveys the content. */}
            <img
              src={cover}
              alt=""
              aria-hidden
              className="absolute inset-0 size-full object-cover scale-110 blur-2xl brightness-75"
            />
            {/* Side vignette — soft horizontal shadow that darkens the
                left and right gutters specifically, so the bleed
                recedes and the contained image reads as the subject. */}
            <div
              aria-hidden
              className="absolute inset-0 bg-gradient-to-r from-black/55 via-transparent to-black/55"
            />
            {/* Sharp foreground capped to the reading column and to
                70vh so it dictates the banner's height. `mx-auto`
                centers it horizontally; `object-contain` guarantees
                the source image is shown in its entirety, never
                cropped. Wrapped in a button so clicking the banner
                opens it fullscreen via the shared Lightbox.
                `cursor-zoom-in` signals the affordance. */}
            <button
              type="button"
              onClick={onCoverClick}
              aria-label={t('campaignsDetail.openCover')}
              className="relative block w-full max-w-6xl max-h-[70vh] mx-auto cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            >
              <img
                src={cover}
                alt=""
                className="block w-full max-h-[70vh] mx-auto object-contain"
              />
            </button>
          </>
        ) : (
          // No banner: a full-bleed decorative placeholder. Its height is a
          // fixed responsive band capped at 40vh rather than a width-driven
          // aspect ratio — on a wide desktop a `16/9` full-bleed region grows
          // taller than the viewport, so use an explicit, screen-relative
          // height instead.
          <div className="flex items-center justify-center h-48 sm:h-56 md:h-64 max-h-[40vh] bg-gradient-to-br from-primary/30 via-primary/10 to-secondary">
            <HandHeart className="size-20 text-primary" />
          </div>
        )}

        {/* Desktop top controls (sm+) — back left, admin right.
            Absolutely positioned over the banner inside the same
            max-w-6xl column as the heading block below so the back
            button aligns with the title's left edge. Chip-style
            backdrops so they read on top of an arbitrary blurred
            bleed without an opaque pill. On mobile we use the plain
            toolbar above the banner instead so chips can't cover
            baked-in image text. */}
        <div className="hidden sm:block absolute inset-x-0 top-0 z-10 px-5 sm:px-6 lg:px-0 pt-[max(var(--safe-area-inset-top,env(safe-area-inset-top,0px)),1rem)]">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
            <button
              onClick={onBack}
              className="inline-flex items-center gap-1.5 h-10 pl-2 pr-3.5 rounded-full bg-black/30 text-white backdrop-blur-md hover:bg-black/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 motion-safe:transition-colors"
              aria-label={t('common.goBack')}
            >
              <ChevronLeft className="size-5 rtl:rotate-180" />
              <span className="text-sm font-medium">{t('campaignsDetail.back')}</span>
            </button>

            {isCreator && (
              <div className="flex items-center gap-1.5">
                <Button
                  asChild
                  size="sm"
                  className="h-10 rounded-full bg-black/30 text-white backdrop-blur-md shadow-none hover:bg-black/45 focus-visible:ring-white/80"
                >
                  <Link to={`/campaigns/new?edit=${encodeURIComponent(naddr)}`}>
                    <Pencil className="size-4 mr-2" />
                    <span>{t('campaignsDetail.edit')}</span>
                  </Link>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={onDelete}
                  disabled={deleteDisabled}
                  className="h-10 rounded-full bg-black/30 text-white backdrop-blur-md shadow-none hover:bg-destructive/70 focus-visible:ring-white/80"
                >
                  <Trash2 className="size-4 mr-2" />
                  <span>{t('campaignsDetail.delete')}</span>
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>
    </>
  );
}

interface CampaignHeadingProps {
  campaign: ParsedCampaign;
  creatorPubkey: string;
  countryLabel: string | undefined;
  onReply: () => void;
  onMore: () => void;
  shareUrl: string;
  translateAction: ReactNode;
}

function CampaignHeading({
  campaign,
  creatorPubkey,
  countryLabel,
  onReply,
  onMore,
  shareUrl,
  translateAction,
}: CampaignHeadingProps) {
  const { t } = useTranslation();

  return (
    // Title / summary / byline / meta / action bar sit in normal page
    // flow on `bg-background`, so they can grow to whatever length the
    // campaign needs without overflowing or being clipped. Same
    // max-w-6xl column the rest of the page uses, so the left edge of
    // the title aligns with the body content.
    <section className="max-w-6xl mx-auto px-5 sm:px-6 lg:px-0 pt-6 sm:pt-8">
      <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold leading-[1.1] tracking-tight max-w-4xl">
        {campaign.title}
      </h1>

      {campaign.summary && (
        <p className="mt-3 text-base sm:text-lg leading-relaxed text-muted-foreground max-w-2xl">
          {campaign.summary}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <AuthorByline pubkey={creatorPubkey} />
        <CampaignVerificationBadge
          coord={campaign.aTag}
          title={campaign.title}
          variant="inline"
        />
      </div>

      {(countryLabel) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs sm:text-sm font-medium text-muted-foreground">
          {countryLabel && (
            <span className="inline-flex items-center gap-1.5">
              {countryLabel}
            </span>
          )}
        </div>
      )}

      {/* Action bar (comment / repost / react / share / more) sits
          directly under the heading on the page surface — default
          PostActionBar styling against `bg-background`. */}
      <div className="mt-4 pt-3 border-t border-border/60">
        <PostActionBar
          event={campaign.event}
          replyLabel={t('campaignsDetail.commentLabel')}
          hideZap
          showShareInSidebar
          shareUrl={shareUrl}
          onReply={onReply}
          onMore={onMore}
          translateAction={translateAction}
        />
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Story
// ─────────────────────────────────────────────────────────────────────

function CampaignStory({
  storyEvent,
}: {
  storyEvent: NostrEvent;
}) {
  const { t } = useTranslation();
  return (
    <DetailStory
      event={storyEvent}
      hasContent
      heading={t('campaignsDetail.storyHeading')}
      headingId="campaign-story-heading"
      emptyText=""
    />
  );
}

// ─────────────────────────────────────────────────────────────────────
// Donate column
// ─────────────────────────────────────────────────────────────────────

interface DonateColumnProps {
  campaign: ParsedCampaign;
  raisedSats: number;
  /**
   * Unconfirmed mempool delta in sats. Positive = inbound pending, negative
   * = beneficiary spending. Displayed as a pending badge under the raised
   * total when non-zero.
   */
  pendingSats: number;
  /**
   * Confirmed on-chain inflows to the campaign address (Esplora
   * `funded_txo_count`). Aligns with the chain portion of raised — each
   * output ever paid to the address, with or without a kind 8333 receipt.
   */
  inflowCount: number;
  statsLoading: boolean;
  btcPrice: number | undefined;
  onShare: () => void;
}

function DonateColumn({
  campaign,
  raisedSats,
  pendingSats,
  inflowCount,
  statsLoading,
  btcPrice,
  onShare,
}: DonateColumnProps) {
  const { t } = useTranslation();
  const { user } = useCurrentUser();
  const hdAccess = useHdWalletAccess();
  const [sendOpen, setSendOpen] = useState(false);
  const [noBitcoinOpen, setNoBitcoinOpen] = useState(false);
  const isSilentPayment = !campaign.wallets.onchain;

  // The in-app "Pay with Agora" button opens HDSendBitcoinDialog
  // pre-filled with the campaign's on-chain address. The donor enters a
  // USD amount and signs with their nsec-derived HD wallet — same flow
  // they'd use from /wallet to send Bitcoin to anywhere else.
  //
  // Hide the button when:
  //   - the donor is the campaign owner (paying yourself is a foot-gun).
  //   - the campaign is silent-payment-only (no on-chain address to
  //     prefill; SP donations require a BIP-352-aware wallet that derives
  //     a fresh one-time output, which the in-app Taproot signer doesn't
  //     do).
  //   - the HD wallet isn't available for this login (extension/bunker
  //     logins don't expose the secret key, so we can't derive child
  //     keys — see useHdWalletAccess).
  const canPayInApp =
    !!user &&
    !isSilentPayment &&
    user.pubkey !== campaign.pubkey &&
    hdAccess.status === 'available';

  // Optional fiat card-payment link (`pay` tag). Sanitized here at the
  // render site (the parser only https-filters); `undefined` for a
  // missing/invalid URL hides the button entirely. When the endpoint
  // reports a JSON total it's folded into the raised figure by
  // useCampaignDonations; the button itself is just the hand-off link.
  const payUrl = useMemo(() => sanitizeUrl(campaign.payUrl), [campaign.payUrl]);

  return (
    // On mobile we drop the surface chrome (no rounded background) so
    // the donate content flows inline with the page instead of being a
    // floating box stacked between the hero and the story. On lg+ the
    // sticky right sidebar uses `bg-card` with a brand-orange border
    // on all four sides — same color family as the composer's
    // top-and-sides border in the comments region, so both columns of
    // the body read as siblings sharing one focal treatment.
    <Card className="overflow-hidden border-0 shadow-none bg-transparent lg:bg-[hsl(24_100%_99%)] dark:lg:bg-[hsl(24_30%_12%)] lg:border lg:border-primary/40">
      <CardContent className="p-0 lg:p-5 space-y-5">
        {/* Raised stats + progress. Silent-payment campaigns hide all
            aggregate numbers by design (per NIP.md Kind 33863) — only
            the goal target (if any) is shown. */}
        {isSilentPayment ? (
          campaign.goalUsd && campaign.goalUsd > 0 ? (
            <div className="text-xs text-muted-foreground">
              {t('campaignsDetail.target', { amount: formatUsdGoal(campaign.goalUsd) })}
            </div>
          ) : null
        ) : statsLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="text-2xl font-bold tracking-tight">
                {formatSatsFull(raisedSats, btcPrice)}
                <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                  {t('campaignsDetail.raised')}
                </span>
              </div>
              {campaign.goalUsd ? (
                <div className="text-xs text-muted-foreground">
                  {t('campaignsDetail.ofGoal', { amount: formatUsdGoal(campaign.goalUsd) })}
                  {inflowCount > 0 && (
                    <>
                      {' · '}
                      {t('campaignsDetail.paymentCount', { count: inflowCount })}
                    </>
                  )}
                </div>
              ) : inflowCount > 0 ? (
                <div className="text-xs text-muted-foreground">
                  {t('campaignsDetail.paymentCount', { count: inflowCount })}
                </div>
              ) : null}
              {pendingSats !== 0 && (
                <PendingBadge
                  amountLabel={formatSatsFull(Math.abs(pendingSats), btcPrice)}
                  className="flex"
                />
              )}
            </div>
            {campaign.goalUsd && raisedUsd(raisedSats, btcPrice) !== undefined && (
              <Progress
                value={Math.min(
                  100,
                  Math.round((raisedUsd(raisedSats, btcPrice)! / campaign.goalUsd) * 100),
                )}
                // `bg-foreground/15` overrides the primitive's default
                // `bg-secondary` track for legibility against the card
                // surface — matches the treatment in CampaignCard.
                className="h-2 bg-foreground/15"
              />
            )}
          </div>
        )}

        {/* Primary actions */}
        {
          // Donors can either pay from their in-app Agora wallet (HD
          // send dialog prefilled with the campaign address) or scan the
          // QR from any external wallet. Both routes terminate at the
          // same `w`-tag address on-chain. The in-app pay button is
          // injected into the donate panel so it sits directly above
          // "Open external wallet" — only one primary CTA stacked.
          <div className="space-y-3">
            <CampaignWalletDonatePanel
              wallets={campaign.wallets}
              primaryAction={
                canPayInApp ? (
                  <Button
                    size="lg"
                    className="w-full"
                    onClick={() => setSendOpen(true)}
                  >
                    <Wallet className="size-5 mr-2" />
                    {t('campaignsDetail.payWithAgoraWallet')}
                  </Button>
                ) : null
              }
            />
            {payUrl && (
              <Button
                size="lg"
                variant="outline"
                className="w-full border-green-600/40 bg-green-600 text-white hover:bg-green-700 hover:text-white dark:border-green-500/40"
                onClick={() => void openUrl(payUrl)}
              >
                <CreditCard className="size-5 mr-2" />
                {t('campaignsDetail.payWithCard')}
              </Button>
            )}
            <Button variant="outline" size="lg" className="w-full" onClick={onShare}>
              <Share2 className="size-4 mr-2" />
              {t('campaignsDetail.share')}
            </Button>
          </div>
        }

        {/* For donors who don't already hold Bitcoin: a low-emphasis text
            link (no button chrome) that opens an instructional dialog
            pointing at a mainstream on-ramp. Kept visually quiet so it
            never competes with the primary on-chain CTA above. */}
        <div className="text-center">
          <button
            type="button"
            onClick={() => setNoBitcoinOpen(true)}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm transition-colors"
          >
            {t('noBitcoin.trigger')}
          </button>
        </div>
      </CardContent>
      {canPayInApp && campaign.wallets.onchain && (
        <HDSendBitcoinDialog
          isOpen={sendOpen}
          onClose={() => setSendOpen(false)}
          walletScope="public"
          btcPrice={btcPrice}
          /* When the campaign exposes both an on-chain address and a
             silent-payment code, prefill with a combined `bitcoin:`
             BIP-21 URI so the picker's dropdown surfaces both rows and
             the donor explicitly picks privacy vs. compatibility.
             Otherwise prefill with the single address; the picker
             accepts bare `bc1…` / `sp1…` inputs directly. */
          initialRecipient={
            campaign.wallets.sp?.value
              ? `bitcoin:${campaign.wallets.onchain.value}?sp=${campaign.wallets.sp.value}`
              : campaign.wallets.onchain.value
          }
        />
      )}
      <NoBitcoinDialog open={noBitcoinOpen} onOpenChange={setNoBitcoinOpen} />
    </Card>
  );
}

/** Convert sats to USD via the live BTC price; undefined when price unknown. */
function raisedUsd(sats: number, btcPrice: number | undefined): number | undefined {
  if (!btcPrice || !Number.isFinite(btcPrice) || btcPrice <= 0) return undefined;
  return (sats / 100_000_000) * btcPrice;
}

// ─────────────────────────────────────────────────────────────────────
// Tombstone — public donation archive for deleted campaigns
// ─────────────────────────────────────────────────────────────────────

/**
 * Decides between a 404 and a tombstone once the campaign coordinate no
 * longer resolves. If kind 8333 receipts reference the coordinate, the
 * donation record is preserved as a read-only archive (per NIP.md, receipts
 * MAY still be rendered against a deleted campaign coordinate). Even with
 * zero receipts, the author's own kind 5 deletion proves the campaign
 * existed and was deliberately removed — that still gets a tombstone
 * notice, just without the archive section. Only when neither is found
 * does the page fall back to the regular NotFound.
 */
function CampaignTombstoneGate({ pubkey, identifier }: { pubkey: string; identifier: string }) {
  const { data, isLoading } = useCampaignTombstone({ pubkey, identifier, enabled: true });

  const donations = useMemo(
    () => aggregateDonationReceipts(data?.receipts ?? []),
    [data?.receipts],
  );

  if (isLoading) return <CampaignDetailSkeleton />;
  if (donations.length === 0 && !data?.deletion) return <NotFound />;

  return <CampaignTombstoneView pubkey={pubkey} donations={donations} deletion={data?.deletion ?? null} />;
}

function CampaignTombstoneView({
  pubkey,
  donations,
  deletion,
}: {
  /** Campaign author hex pubkey (from the naddr). */
  pubkey: string;
  /** Aggregated kind 8333 receipts, one synthetic event per `(txid, donor)`. May be empty. */
  donations: NostrEvent[];
  /** The author's NIP-09 deletion request, when a relay still serves it. */
  deletion: NostrEvent | null;
}) {
  const { t, i18n } = useTranslation();
  const { config } = useAppContext();
  const { data: btcPrice } = useBtcPrice();
  const navigate = useNavigate();

  useSeoMeta({
    title: t('campaignsDetail.tombstone.seoTitle', { appName: config.appName }),
    description: donations.length > 0
      ? t('campaignsDetail.tombstone.archiveIntro')
      : t('campaignsDetail.tombstone.unavailableNotice'),
  });

  const totalSats = useMemo(
    () =>
      donations.reduce((sum, ev) => {
        const amount = Number(ev.tags.find(([n]) => n === 'amount')?.[1]);
        return Number.isFinite(amount) && amount > 0 ? sum + amount : sum;
      }, 0),
    [donations],
  );

  const donationNodes = useMemo(
    (): ReplyNode[] =>
      donations
        .map((event): ReplyNode => ({ event, children: [] }))
        .sort((a, b) => b.event.created_at - a.event.created_at),
    [donations],
  );

  const deletedDate = deletion
    ? new Date(deletion.created_at * 1000).toLocaleDateString(i18n.language, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : undefined;

  return (
    <main className="min-h-screen pb-16">
      <div className="max-w-3xl mx-auto px-5 sm:px-6 py-6 lg:py-10 space-y-6">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate(-1)}>
          <ChevronLeft className="size-4 mr-1" aria-hidden="true" />
          {t('campaignsDetail.back')}
        </Button>

        <Card className="border-dashed">
          <CardContent className="py-8 px-6 sm:px-8 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
                <Archive className="size-5 text-muted-foreground" aria-hidden="true" />
              </div>
              <h1 className="text-xl sm:text-2xl font-bold leading-tight">
                {t('campaignsDetail.tombstone.title')}
              </h1>
            </div>
            <p className="text-muted-foreground">
              {deletedDate
                ? t('campaignsDetail.tombstone.deletedNotice', { date: deletedDate })
                : t('campaignsDetail.tombstone.unavailableNotice')}
              {donations.length > 0 && <> {t('campaignsDetail.tombstone.archiveIntro')}</>}
            </p>
            <AuthorByline pubkey={pubkey} />
          </CardContent>
        </Card>

        {donations.length > 0 && (
          <section aria-labelledby="tombstone-archive-heading" className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 id="tombstone-archive-heading" className="text-lg font-semibold">
                {t('campaignsDetail.tombstone.receiptsHeading')}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t('campaignsDetail.tombstone.totalRecorded', {
                  amount: formatSatsFull(totalSats, btcPrice),
                })}
                {' · '}
                {t('campaignsDetail.donationCount', { count: donations.length })}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('campaignsDetail.tombstone.unverifiedCaveat')}
            </p>
            <div className="pt-2">
              <ThreadedReplyList roots={donationNodes} hideCommentContext leafCardClassName="py-4" />
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Skeletons
// ─────────────────────────────────────────────────────────────────────

export function CampaignDetailSkeleton() {
  return (
    <main className="min-h-screen pb-16">
      <Skeleton className="w-full min-h-[78svh] sm:min-h-0 sm:aspect-[21/9] lg:aspect-[24/9] rounded-none" />
      <div className="max-w-6xl mx-auto px-5 sm:px-6 lg:px-0 py-6 lg:py-10">
        <div className="lg:flex lg:gap-8 lg:items-start">
          <div className="flex-1 min-w-0 space-y-3">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-4/5" />
            <Skeleton className="h-5 w-5/6" />
            <Skeleton className="h-5 w-3/4" />
          </div>
          <div className="hidden lg:block lg:w-[360px] lg:shrink-0 space-y-3">
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        </div>
      </div>
    </main>
  );
}
