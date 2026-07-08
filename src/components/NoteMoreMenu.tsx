import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { nip19 } from 'nostr-tools';
import { useNavigate } from 'react-router-dom';

import {
  Bookmark,
  BellOff,
  VolumeX,
  Flag,
  Pin,
  FileJson,
  Trash2,
  StickyNote,
  ListPlus,
  PanelLeft,
  Copy,
  Check,
  Radio,
  ShieldBan,
  BadgeCheck,
  EyeOff,
  Eye,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogHeader,
} from '@/components/ui/dialog';
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
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { BanConfirmDialog } from '@/components/BanConfirmDialog';
import { ReportDialog } from '@/components/ReportDialog';
import { CommunityReportDialog } from '@/components/CommunityReportDialog';
import { AddToListDialog } from '@/components/AddToListDialog';
import { CampaignListMembershipDialog } from '@/components/campaign-lists/CampaignListMembershipDialog';
import { VerificationDialog } from '@/components/VerificationDialog';
import { useNostr } from '@nostrify/react';
import { useBookmarks } from '@/hooks/useBookmarks';
import { usePinnedNotes } from '@/hooks/usePinnedNotes';
import { useCampaignListActions } from '@/hooks/useCampaignListActions';
import { useCampaignModeration } from '@/hooks/useCampaignModeration';
import { useCampaignVerifications } from '@/hooks/useCampaignVerifications';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAuthor } from '@/hooks/useAuthor';
import { useMuteList } from '@/hooks/useMuteList';
import { useDeleteEvent } from '@/hooks/useDeleteEvent';
import { useFeedSettings } from '@/hooks/useFeedSettings';
import { useOrganizers } from '@/hooks/useOrganizers';
import { usePinnedPosts } from '@/hooks/usePinnedPosts';
import { useCountryFeed } from '@/contexts/CountryFeedContext';
import { useCommunityModerationContext } from '@/contexts/CommunityModerationContext';
import { type CommunityMenuContext, canBanTarget, getViewerAuthority } from '@/lib/communityUtils';
// NOTE: `CommunityMenuContext` is derived automatically from
// `useCommunityModerationContext()`. Parents install a
// `CommunityModerationContext.Provider` to enable community-aware menu items.
import { isAdmin } from '@/lib/admins';
import { CAMPAIGN_KIND } from '@/lib/campaign';
import { genUserName } from '@/lib/genUserName';
import { toast } from '@/hooks/useToast';
import { impactLight } from '@/lib/haptics';
import { cn } from '@/lib/utils';
import type { NostrEvent } from '@nostrify/nostrify';

interface NoteMoreMenuProps {
  event: NostrEvent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}

function MenuItem({ icon, label, onClick, destructive }: MenuItemProps) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'flex items-center gap-4 w-full px-5 py-3 text-[15px] transition-colors hover:bg-secondary/60',
        destructive ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

/** Encode the NIP-19 identifier for an event — naddr for addressable events, nevent otherwise. */
function encodeEventNip19(event: NostrEvent): string {
  if (event.kind >= 30000 && event.kind < 40000) {
    const dTag = event.tags.find(([n]) => n === 'd')?.[1];
    if (dTag) {
      return nip19.naddrEncode({ kind: event.kind, pubkey: event.pubkey, identifier: dTag });
    }
  }
  return nip19.neventEncode({ id: event.id, author: event.pubkey });
}

interface EventJsonDialogProps {
  event: NostrEvent;
  nip19Id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast({ title: t('noteMoreMenu.toast.copied', { label }) });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleCopy}
      className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
    >
      {copied ? <Check className="size-3.5 text-green-500" /> : <Copy className="size-3.5" />}
    </Button>
  );
}

function EventJsonDialog({ event, nip19Id, open, onOpenChange }: EventJsonDialogProps) {
  const { t } = useTranslation();
  const { nostr } = useNostr();
  const [broadcasting, setBroadcasting] = useState(false);

  const jsonText = JSON.stringify(event, null, 2);

  const handleBroadcast = async () => {
    setBroadcasting(true);
    try {
      await nostr.event(event, { signal: AbortSignal.timeout(5000) });
      toast({ title: t('noteMoreMenu.toast.eventBroadcast') });
    } catch {
      toast({ title: t('noteMoreMenu.toast.broadcastFailed'), variant: 'destructive' });
    } finally {
      setBroadcasting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85dvh] flex flex-col gap-0 p-0 rounded-2xl overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 shrink-0">
          <DialogTitle className="text-base font-semibold">{t('noteMoreMenu.jsonDialog.title')}</DialogTitle>
        </DialogHeader>

        <div className="px-5 pb-3 shrink-0">
          <p className="text-xs font-medium text-muted-foreground mb-1">{t('noteMoreMenu.jsonDialog.eventId')}</p>
          <div className="relative flex items-center bg-muted rounded-lg px-3 py-2">
            <p className="font-mono text-xs break-all text-foreground/80 flex-1 pr-2 select-all">
              {nip19Id}
            </p>
            <CopyButton text={nip19Id} label={t('noteMoreMenu.jsonDialog.eventIdLabel')} />
          </div>
        </div>

        <div className="px-5 pb-5 flex flex-col flex-1 min-h-0">
          <p className="text-xs font-medium text-muted-foreground mb-1">{t('noteMoreMenu.jsonDialog.rawJson')}</p>
          <div className="relative flex-1 min-h-0 overflow-auto rounded-lg bg-muted border border-border">
            <div className="sticky top-2 right-2 float-right mr-2">
              <CopyButton text={jsonText} label={t('noteMoreMenu.jsonDialog.eventJsonLabel')} />
            </div>
            <pre className="p-4 text-xs font-mono text-foreground/80 whitespace-pre leading-relaxed">
              {jsonText}
            </pre>
          </div>
        </div>

        <div className="px-5 pb-5 shrink-0">
          <Button
            variant="outline"
            className="w-full gap-2"
            onClick={handleBroadcast}
            disabled={broadcasting}
          >
            <Radio className="size-4" />
            {broadcasting ? t('noteMoreMenu.jsonDialog.broadcasting') : t('noteMoreMenu.jsonDialog.broadcast')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function NoteMoreMenu({ event, open, onOpenChange }: NoteMoreMenuProps) {
  const { t } = useTranslation();
  // These states live here (not in NoteMoreMenuContent) so they persist after the menu closes
  const [reportOpen, setReportOpen] = useState(false);
  const [banContentOpen, setBanContentOpen] = useState(false);
  const [addToListOpen, setAddToListOpen] = useState(false);
  const [addToCampaignListOpen, setAddToCampaignListOpen] = useState(false);
  const [verifyConfirmOpen, setVerifyConfirmOpen] = useState(false);
  const [eventJsonOpen, setEventJsonOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // Resolve community context from the React Context. Parents install a
  // `CommunityModerationContext.Provider` (activity feed, community detail
  // page, post detail page) to enable community-aware menu items.
  const { user } = useCurrentUser();
  const communityModCtx = useCommunityModerationContext();
  const communityContext = useMemo<CommunityMenuContext | undefined>(() => {
    if (!communityModCtx || !user) return undefined;
    const viewerMember = getViewerAuthority(user.pubkey, communityModCtx.rankMap, communityModCtx.moderation);
    if (!viewerMember) return undefined;
    return {
      communityATag: communityModCtx.communityATag,
      canBan: canBanTarget(viewerMember, communityModCtx.rankMap.get(event.pubkey)),
    };
  }, [communityModCtx, user, event.pubkey]);

  const { mutate: deleteEvent, isPending: isDeleting } = useDeleteEvent();

  const nip19Id = encodeEventNip19(event);

  // Campaign-specific membership-dialog inputs. Only meaningful when
  // `event.kind === CAMPAIGN_KIND`; the dialog row that uses them is
  // gated inside the menu content the same way.
  const isCampaign = event.kind === CAMPAIGN_KIND;
  const campaignDTag = event.tags.find(([n]) => n === 'd')?.[1] ?? '';
  const campaignCoord = isCampaign
    ? `${CAMPAIGN_KIND}:${event.pubkey}:${campaignDTag}`
    : '';
  const campaignTitle = event.tags.find(([n]) => n === 'title')?.[1] ?? '';

  // Verification lives here (not in NoteMoreMenuContent) so the confirm
  // dialog and its publish survive the menu closing — same pattern as
  // report / delete above. Gated identically to the old hero kebab:
  // `useCampaignVerifications().canVerify` (moderators OR verifiers).
  const { verify } = useCampaignVerifications();

  const handleConfirmVerify = async () => {
    try {
      await verify.mutateAsync({ coord: campaignCoord });
      toast({ title: t('campaignVerification.verified'), description: campaignTitle });
      setVerifyConfirmOpen(false);
    } catch (error) {
      toast({
        title: t('campaignVerification.actionFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    }
  };

  const handleDelete = () => {
    const dTag = event.tags.find(([name]) => name === 'd')?.[1];
    deleteEvent(
      { eventId: event.id, eventKind: event.kind, eventPubkey: event.pubkey, eventDTag: dTag },
      {
        onSuccess: () => {
          setDeleteConfirmOpen(false);
          toast({ title: t('noteMoreMenu.toast.postDeleted') });
        },
        onError: () => {
          toast({ title: t('noteMoreMenu.toast.deleteFailed'), variant: 'destructive' });
        },
      },
    );
  };

  return (
    <>
      {open && (
        <NoteMoreMenuContent
          event={event}
          open={open}
          onOpenChange={onOpenChange}
          communityContext={communityContext}
          onReport={() => {
            onOpenChange(false);
            setTimeout(() => setReportOpen(true), 150);
          }}
          onBanContent={() => {
            onOpenChange(false);
            setTimeout(() => setBanContentOpen(true), 150);
          }}
          onAddToList={() => {
            onOpenChange(false);
            setTimeout(() => setAddToListOpen(true), 150);
          }}
          onAddToCampaignList={() => {
            onOpenChange(false);
            setTimeout(() => setAddToCampaignListOpen(true), 150);
          }}
          onRequestVerify={() => {
            onOpenChange(false);
            setTimeout(() => setVerifyConfirmOpen(true), 150);
          }}
          onViewEventJson={() => {
            onOpenChange(false);
            setTimeout(() => setEventJsonOpen(true), 150);
          }}
          onDelete={() => {
            onOpenChange(false);
            setTimeout(() => setDeleteConfirmOpen(true), 150);
          }}
        />
      )}

      {communityContext ? (
        <CommunityReportDialog
          event={event}
          communityATag={communityContext.communityATag}
          open={reportOpen}
          onOpenChange={setReportOpen}
        />
      ) : (
        <ReportDialog event={event} open={reportOpen} onOpenChange={setReportOpen} />
      )}

      {communityContext?.canBan && (
        <BanConfirmDialog
          eventId={event.id}
          targetPubkey={event.pubkey}
          communityATag={communityContext.communityATag}
          open={banContentOpen}
          onOpenChange={setBanContentOpen}
        />
      )}

      <AddToListDialog
        pubkey={event.pubkey}
        open={addToListOpen}
        onOpenChange={setAddToListOpen}
      />

      {isCampaign && (
        <CampaignListMembershipDialog
          open={addToCampaignListOpen}
          onOpenChange={setAddToCampaignListOpen}
          campaignCoord={campaignCoord}
          campaignTitle={campaignTitle}
        />
      )}

      {isCampaign && (
        <VerificationDialog
          open={verifyConfirmOpen}
          onOpenChange={setVerifyConfirmOpen}
          campaignTitle={campaignTitle}
          isPending={verify.isPending}
          onConfirm={handleConfirmVerify}
        />
      )}

      <EventJsonDialog
        event={event}
        nip19Id={nip19Id}
        open={eventJsonOpen}
        onOpenChange={setEventJsonOpen}
      />

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('noteMoreMenu.deleteDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('noteMoreMenu.deleteDialog.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t('noteMoreMenu.deleteDialog.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? t('noteMoreMenu.deleteDialog.deleting') : t('noteMoreMenu.deleteDialog.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface NoteMoreMenuContentProps extends NoteMoreMenuProps {
  /** Resolved community context (authored upstream from `CommunityModerationContext`). */
  communityContext?: CommunityMenuContext;
  onReport: () => void;
  onBanContent: () => void;
  onAddToList: () => void;
  onAddToCampaignList: () => void;
  /** Open the campaign verification confirmation dialog (hoisted to the menu host). */
  onRequestVerify: () => void;
  onViewEventJson: () => void;
  onDelete: () => void;
}

function NoteMoreMenuContent({ event, open, onOpenChange, communityContext, onReport, onBanContent, onAddToList, onAddToCampaignList, onRequestVerify, onViewEventJson, onDelete }: NoteMoreMenuContentProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { isBookmarked, toggleBookmark } = useBookmarks();
  const bookmarked = isBookmarked(event.id);
  const { isPinned, togglePin } = usePinnedNotes(user?.pubkey);
  const pinned = isPinned(event.id);
  const isOwnPost = user?.pubkey === event.pubkey;

  // Bookmark / Add to list / Add to sidebar don't map cleanly to campaigns
  // (kind 33863 — addressable, with their own dedicated UI). Hide them there.
  const isCampaign = event.kind === CAMPAIGN_KIND;

  // Campaign moderators get a dedicated "Add to list" row that toggles
  // the campaign's membership in the curated topic lists. `isMod` is a
  // synchronous boolean — no loading state to handle.
  const campaignListActions = useCampaignListActions();
  const canManageCampaignLists = isCampaign && campaignListActions.isMod;

  // Country-feed pin/unpin context (organizer/admin action). `useCountryFeed`
  // returns null outside of a country page; we only enable usePinnedPosts when
  // the viewer is actually authorized to pin so we avoid extra relay traffic
  // for read-only viewers.
  const countryFeed = useCountryFeed();
  const countryCode = countryFeed?.countryCode;
  const userIsAdmin = !!user && isAdmin(user.pubkey);
  const { isOrganizer } = useOrganizers();
  const userIsOrganizerHere =
    !!user && !!countryCode && isOrganizer(user.pubkey, countryCode);
  const canPinHere = userIsAdmin || userIsOrganizerHere;
  const {
    isPinned: isPinnedInCountry,
    pinPost,
    unpinPost,
  } = usePinnedPosts(canPinHere ? countryCode : undefined);
  const postIsPinnedInCountry = !!countryCode && isPinnedInCountry(event.id);
  const author = useAuthor(event.pubkey);
  const metadata = author.data?.metadata;
  const displayName = metadata?.name || genUserName(event.pubkey);
  const { addMute, removeMute, isMuted } = useMuteList();
  const userMuted = isMuted('pubkey', event.pubkey);
  const { addToSidebar, removeFromSidebar, orderedItems } = useFeedSettings();

  const nip19Id = encodeEventNip19(event);
  const nostrUri = `nostr:${nip19Id}`;
  const isInSidebar = orderedItems.includes(nostrUri);

  const close = () => onOpenChange(false);

  const handleViewPostDetails = () => {
    navigate(`/${nip19Id}`);
    close();
  };

  const handleBookmark = () => {
    impactLight();
    toggleBookmark.mutate(event.id);
    close();
  };

  const handleToggleSidebar = () => {
    if (isInSidebar) {
      removeFromSidebar(nostrUri);
      toast({ title: t('noteMoreMenu.toast.removedFromSidebar') });
    } else {
      addToSidebar(nostrUri);
      toast({ title: t('noteMoreMenu.toast.addedToSidebar') });
    }
    close();
  };

  const handleTogglePin = () => {
    impactLight();
    togglePin.mutate(event.id, {
      onSuccess: () => {
        toast({ title: pinned ? t('noteMoreMenu.toast.unpinned') : t('noteMoreMenu.toast.pinned') });
      },
      onError: () => {
        toast({ title: t('noteMoreMenu.toast.pinFailed'), variant: 'destructive' });
      },
    });
    close();
  };

  const handleToggleCountryPin = () => {
    if (!countryCode) return;
    impactLight();
    const mutation = postIsPinnedInCountry ? unpinPost : pinPost;
    mutation.mutate(
      { eventId: event.id, countryCode },
      {
        onSuccess: () => {
          toast({
            title: postIsPinnedInCountry
              ? t('noteMoreMenu.toast.countryUnpinned')
              : t('noteMoreMenu.toast.countryPinned'),
          });
        },
        onError: () => {
          toast({
            title: postIsPinnedInCountry
              ? t('noteMoreMenu.toast.countryUnpinFailed')
              : t('noteMoreMenu.toast.countryPinFailed'),
            variant: 'destructive',
          });
        },
      },
    );
    close();
  };

  const handleMuteConversation = () => {
    impactLight();
    const rootTag = event.tags.find(([name, , , marker]) => name === 'e' && marker === 'root');
    const threadId = rootTag?.[1] ?? event.id;
    addMute.mutate(
      { type: 'thread', value: threadId },
      {
        onSuccess: () => {
          toast({ title: t('noteMoreMenu.toast.convoMuted') });
        },
        onError: () => {
          toast({ title: t('noteMoreMenu.toast.convoMuteFailed'), variant: 'destructive' });
        },
      },
    );
    close();
  };

  const handleMuteUser = () => {
    const muteItem = { type: 'pubkey' as const, value: event.pubkey };
    const mutation = userMuted ? removeMute : addMute;
    mutation.mutate(muteItem, {
      onSuccess: () => {
        toast({ title: userMuted ? t('noteMoreMenu.toast.unmuted', { name: displayName }) : t('noteMoreMenu.toast.muted', { name: displayName }) });
      },
      onError: () => {
        toast({ title: userMuted ? t('noteMoreMenu.toast.unmuteFailed') : t('noteMoreMenu.toast.muteFailed'), variant: 'destructive' });
      },
    });
    close();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85dvh] p-0 gap-0 rounded-2xl overflow-y-auto [&>button]:hidden">
        <DialogTitle className="sr-only">{t('noteMoreMenu.title')}</DialogTitle>

        <div className="py-1">
          <MenuItem
            icon={<StickyNote className="size-5" />}
            label={t('noteMoreMenu.viewPost')}
            onClick={handleViewPostDetails}
          />
          <MenuItem
            icon={<FileJson className="size-5" />}
            label={t('noteMoreMenu.viewEventJson')}
            onClick={onViewEventJson}
          />
          {!isCampaign && (
            <MenuItem
              icon={<Bookmark className={cn("size-5", bookmarked && "fill-current")} />}
              label={bookmarked ? t('noteMoreMenu.removeBookmark') : t('noteMoreMenu.bookmark')}
              onClick={handleBookmark}
            />
          )}
          {user && !isCampaign && (
            <MenuItem
              icon={<ListPlus className="size-5" />}
              label={t('noteMoreMenu.addToList')}
              onClick={() => { onAddToList(); }}
            />
          )}
          {!isCampaign && (
            <MenuItem
              icon={isInSidebar ? <Trash2 className="size-5" /> : <PanelLeft className="size-5" />}
              label={isInSidebar ? t('noteMoreMenu.removeFromSidebar') : t('noteMoreMenu.addToSidebar')}
              onClick={handleToggleSidebar}
            />
          )}
          {isOwnPost && (
            <MenuItem
              icon={<Pin className={cn("size-5", pinned && "fill-current")} />}
              label={pinned ? t('noteMoreMenu.unpinProfile') : t('noteMoreMenu.pinProfile')}
              onClick={handleTogglePin}
            />
          )}
          {canPinHere && (
            <MenuItem
              icon={<Pin className={cn('size-5', postIsPinnedInCountry && 'fill-current')} />}
              label={postIsPinnedInCountry ? t('noteMoreMenu.unpinCountry') : t('noteMoreMenu.pinCountry')}
              onClick={handleToggleCountryPin}
            />
          )}
          {!isOwnPost && (
            <MenuItem
              icon={<BellOff className="size-5" />}
              label={isCampaign ? t('noteMoreMenu.muteCampaign') : t('noteMoreMenu.muteConversation')}
              onClick={handleMuteConversation}
            />
          )}
          {!isOwnPost && (
            <MenuItem
              icon={<VolumeX className="size-5" />}
              label={userMuted ? t('noteMoreMenu.unmute', { name: displayName }) : t('noteMoreMenu.mute', { name: displayName })}
              onClick={handleMuteUser}
            />
          )}
          {!isOwnPost && (
            <MenuItem
              icon={<Flag className="size-5" />}
              label={communityContext ? t('noteMoreMenu.reportToGroup') : t('noteMoreMenu.report', { name: displayName })}
              onClick={onReport}
              destructive
            />
          )}
          {!isOwnPost && communityContext?.canBan && (
            <MenuItem
              icon={<ShieldBan className="size-5" />}
              label={t('noteMoreMenu.removeFromGroup')}
              onClick={onBanContent}
              destructive
            />
          )}
          {isOwnPost && (
            <MenuItem
              icon={<Trash2 className="size-5" />}
              label={t('noteMoreMenu.delete')}
              onClick={onDelete}
              destructive
            />
          )}
        </div>

        {isCampaign && user && (
          <CampaignModeratorMenuItems
            coord={`${CAMPAIGN_KIND}:${event.pubkey}:${event.tags.find(([n]) => n === 'd')?.[1] ?? ''}`}
            entityTitle={event.tags.find(([n]) => n === 'title')?.[1] ?? ''}
            canManageCampaignLists={canManageCampaignLists}
            onAddToCampaignList={onAddToCampaignList}
            onRequestVerify={onRequestVerify}
            onClose={close}
          />
        )}

        <Separator />

        <div className="py-1">
          <Button
            variant="ghost"
            className="w-full h-auto py-3 text-[15px] font-medium text-muted-foreground hover:bg-secondary/60 rounded-none"
            onClick={close}
          >
            {t('noteMoreMenu.close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface CampaignModeratorMenuItemsProps {
  /** Addressable coordinate (`kind:pubkey:d`) of the campaign. */
  coord: string;
  /** Campaign title, used for toast feedback. */
  entityTitle: string;
  /** Whether the viewer may manage curated campaign lists (moderator only). */
  canManageCampaignLists: boolean;
  /** Open the campaign list membership dialog (hoisted to the menu host). */
  onAddToCampaignList: () => void;
  /** Open the verification confirmation dialog (hoisted to the menu host). */
  onRequestVerify: () => void;
  /** Close the more-menu after a self-contained action (hide / unhide / unverify). */
  onClose: () => void;
}

/**
 * Campaign moderator actions, rendered inside the {@link NoteMoreMenu}
 * dialog below "Report" and above "Close". This is the dialog-flavored
 * counterpart of the dropdown `ModerationMenu` that used to overlay the
 * campaign hero — same permission gates, same underlying hooks
 * (`useCampaignVerifications`, `useCampaignModeration`,
 * `useCampaignListActions`), just laid out as dialog `MenuItem` rows.
 *
 * Renders `null` (no label, no separator) unless the viewer can perform at
 * least one moderator action:
 * - **Verify / Remove verification** — moderators OR self-declared verifiers.
 * - **Add to list…** and **Hide / Unhide** — moderators only.
 */
function CampaignModeratorMenuItems({
  coord,
  entityTitle,
  canManageCampaignLists,
  onAddToCampaignList,
  onRequestVerify,
  onClose,
}: CampaignModeratorMenuItemsProps) {
  const { t } = useTranslation();
  const { user } = useCurrentUser();
  const {
    data: verificationData,
    canVerify,
    unverify,
  } = useCampaignVerifications();
  const { data: moderationData, moderate } = useCampaignModeration();

  // Moderator-only structural actions (hide) piggyback on
  // `canManageCampaignLists`, which is itself derived from the same
  // moderator allowlist that gates the moderation label writes.
  const isModerator = canManageCampaignLists;

  // Nothing to show unless the viewer can verify or moderate.
  if (!canVerify && !isModerator) return null;

  const mine = user
    ? (verificationData.byCoord.get(coord) ?? []).find((v) => v.pubkey === user.pubkey)
    : undefined;
  const isHidden = moderationData.hiddenCoords.has(coord);

  const handleUnverify = async () => {
    if (!mine) return;
    try {
      await unverify.mutateAsync({ verification: mine });
      toast({ title: t('campaignVerification.unverified'), description: entityTitle });
    } catch (error) {
      toast({
        title: t('campaignVerification.actionFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    }
    onClose();
  };

  const handleToggleHide = async () => {
    try {
      await moderate.mutateAsync({
        coord,
        action: isHidden ? 'unhidden' : 'hidden',
      });
      toast({
        title: isHidden ? t('moderation.menu.toastUnhidden') : t('moderation.menu.toastHidden'),
        description: entityTitle,
      });
    } catch (error) {
      toast({
        title: t('moderation.menu.failedAction', { action: isHidden ? 'unhidden' : 'hidden' }),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    }
    onClose();
  };

  return (
    <>
      <Separator />
      <div className="py-1">
        <p className="px-5 pt-2 pb-1 text-xs font-medium text-muted-foreground">
          {t('moderation.menu.label')}
        </p>
        {canVerify && (
          mine ? (
            <MenuItem
              icon={<BadgeCheck className="size-5" />}
              label={t('campaignVerification.removeVerification')}
              onClick={handleUnverify}
            />
          ) : (
            <MenuItem
              icon={<BadgeCheck className="size-5" />}
              label={t('campaignVerification.verifyCampaign')}
              onClick={onRequestVerify}
            />
          )
        )}
        {isModerator && (
          <MenuItem
            icon={<ListPlus className="size-5" />}
            label={t('campaigns.lists.membershipTitle')}
            onClick={onAddToCampaignList}
          />
        )}
        {isModerator && (
          isHidden ? (
            <MenuItem
              icon={<Eye className="size-5" />}
              label={t('moderation.menu.unhide')}
              onClick={handleToggleHide}
            />
          ) : (
            <MenuItem
              icon={<EyeOff className="size-5" />}
              label={t('moderation.menu.hide')}
              onClick={handleToggleHide}
              destructive
            />
          )
        )}
      </div>
    </>
  );
}
