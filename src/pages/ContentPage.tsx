import { useSeoMeta } from '@unhead/react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import {
  UserX,
  Hash,
  MessageSquareOff,
  ExternalLink,
  Trash2,
} from 'lucide-react';

import { PageHeader } from '@/components/PageHeader';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppContext } from '@/hooks/useAppContext';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useMuteList, type MuteListItem } from '@/hooks/useMuteList';
import { useToast } from '@/hooks/useToast';
import { getAvatarShape } from '@/lib/avatarShape';
import { genUserName } from '@/lib/genUserName';

/** Config keyed by mute type: icon + i18n key for the section label. */
const MUTE_TYPE_CONFIG: Record<MuteListItem['type'], { icon: React.ReactNode; labelKey: string }> = {
  pubkey: { icon: <UserX className="size-5" />, labelKey: 'content.muted.types.pubkey' },
  hashtag: { icon: <Hash className="size-5" />, labelKey: 'content.muted.types.hashtag' },
  word: { icon: <MessageSquareOff className="size-5" />, labelKey: 'content.muted.types.word' },
  thread: { icon: <MessageSquareOff className="size-5" />, labelKey: 'content.muted.types.thread' },
};

/** Order the accordion sections deterministically. */
const MUTE_TYPE_ORDER: MuteListItem['type'][] = ['pubkey', 'hashtag', 'word', 'thread'];

/** Renders a muted user's avatar and display name instead of a raw hex pubkey. */
function MutedUserProfile({ pubkey }: { pubkey: string }) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const avatarShape = getAvatarShape(metadata);
  const displayName = metadata?.name ?? metadata?.display_name ?? genUserName(pubkey);

  if (author.isLoading) {
    return (
      <div className="flex items-center gap-2.5 min-w-0">
        <Skeleton className="size-7 rounded-full shrink-0" />
        <Skeleton className="h-3.5 w-24" />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <Avatar shape={avatarShape} className="size-7 shrink-0">
        <AvatarImage src={metadata?.picture} alt={displayName} />
        <AvatarFallback className="bg-primary/20 text-primary text-[10px]">
          {displayName[0]?.toUpperCase() ?? '?'}
        </AvatarFallback>
      </Avatar>
      <span className="text-sm truncate">{displayName}</span>
    </div>
  );
}

/** Renders a muted thread as a clickable link using the nevent identifier. */
function MutedThreadLink({ eventId }: { eventId: string }) {
  // eventId is guaranteed valid hex by parseMuteTags' isNostrId guard, so
  // neventEncode cannot throw here.
  const nevent = nip19.neventEncode({ id: eventId });
  const shortId = `${eventId.slice(0, 8)}…${eventId.slice(-8)}`;

  return (
    <Link
      to={`/${nevent}`}
      className="flex items-center gap-1.5 text-xs font-mono text-primary hover:underline truncate"
      onClick={(e) => e.stopPropagation()}
    >
      <ExternalLink className="size-3 shrink-0" />
      <span className="truncate">{shortId}</span>
    </Link>
  );
}

function MuteTypeSection({
  type,
  items,
  onRemove,
  isPending,
}: {
  type: MuteListItem['type'];
  items: MuteListItem[];
  onRemove: (item: MuteListItem) => void;
  isPending: boolean;
}) {
  const { t } = useTranslation();
  const config = MUTE_TYPE_CONFIG[type];

  return (
    <AccordionItem value={type} className="border-b border-border last:border-b-0">
      <AccordionTrigger className="px-3 py-3.5 hover:no-underline hover:bg-muted/20 transition-colors">
        <span className="flex items-center gap-3 min-w-0">
          <span className="text-muted-foreground shrink-0">{config.icon}</span>
          <span className="text-sm font-medium">{t(config.labelKey)}</span>
          <Badge variant="secondary" className="shrink-0 font-normal">{items.length}</Badge>
        </span>
      </AccordionTrigger>
      <AccordionContent className="pb-0">
        <div className="divide-y divide-border border-t border-border">
          {items.map((item, index) => (
            <div
              key={`${item.type}-${item.value}-${index}`}
              className="flex items-center justify-between py-2.5 px-3 pl-12 hover:bg-muted/20 transition-colors"
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {item.type === 'pubkey' ? (
                  <MutedUserProfile pubkey={item.value} />
                ) : item.type === 'thread' ? (
                  <MutedThreadLink eventId={item.value} />
                ) : (
                  <code className="text-xs truncate font-mono bg-muted px-2 py-1 rounded">
                    {item.value}
                  </code>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onRemove(item)}
                disabled={isPending}
                aria-label={t('content.muted.removeAria', { value: item.value })}
                className="shrink-0 h-8 w-8 p-0"
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

export function ContentPage() {
  const { t } = useTranslation();
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const { muteItems, isLoading, removeMute } = useMuteList();
  const { toast } = useToast();

  useSeoMeta({
    title: `${t('content.title')} | ${t('settings.title')} | ${config.appName}`,
    description: t('content.description'),
  });

  if (!user) {
    return <Navigate to="/settings" replace />;
  }

  const handleRemove = async (item: MuteListItem) => {
    try {
      await removeMute.mutateAsync(item);
      toast({ title: t('content.muted.removed') });
    } catch (error) {
      toast({
        title: t('content.muted.removeFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    }
  };

  const grouped = MUTE_TYPE_ORDER.map((type) => ({
    type,
    items: muteItems.filter((item) => item.type === type),
  })).filter((group) => group.items.length > 0);

  return (
    <main>
      <PageHeader
        backTo="/settings"
        alwaysShowBack
        contentClassName="max-w-2xl mx-auto w-full"
        title={t('content.title')}
      />

      <div className="p-4 max-w-2xl mx-auto w-full">
        <div className="relative px-3 py-3.5">
          <h2 className="text-base font-semibold">{t('content.muted.heading')}</h2>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-primary rounded-full" />
        </div>
        <p className="px-3 pt-3 pb-1 text-xs text-muted-foreground leading-relaxed">
          {t('content.muted.subheading')}
        </p>

        {isLoading ? (
          <div className="space-y-2 px-3 py-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : grouped.length === 0 ? (
          <p className="text-muted-foreground text-center py-12 text-sm">
            {t('content.muted.empty')}
          </p>
        ) : (
          <Accordion type="multiple" defaultValue={grouped.map((g) => g.type)}>
            {grouped.map(({ type, items }) => (
              <MuteTypeSection
                key={type}
                type={type}
                items={items}
                onRemove={handleRemove}
                isPending={removeMute.isPending}
              />
            ))}
          </Accordion>
        )}
      </div>
    </main>
  );
}

export default ContentPage;
