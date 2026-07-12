import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { nip19 } from 'nostr-tools';
import { useTranslation } from 'react-i18next';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthor } from '@/hooks/useAuthor';
import { useLoginActions } from '@/hooks/useLoginActions';
import { getAvatarShape } from '@/lib/avatarShape';

interface QuickLoginDialogProps {
  isOpen: boolean;
  pubkey: string;
  onClose: () => void;
  onOtherLogin: () => void;
}

export function QuickLoginDialog({
  isOpen,
  pubkey,
  onClose,
  onOtherLogin,
}: QuickLoginDialogProps) {
  const { t } = useTranslation();
  const author = useAuthor(pubkey);
  const login = useLoginActions();
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState('');

  const metadata = author.data?.metadata;
  const displayName = metadata?.display_name || metadata?.name || genericName(pubkey);
  const picture = metadata?.picture;
  const avatarShape = getAvatarShape(metadata);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    setError('');
    try {
      await login.extension();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('auth.errorExtensionFailed'));
      setIsLoggingIn(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] sm:max-w-sm rounded-2xl">
        <DialogTitle className="sr-only">
          {t('auth.login')}
        </DialogTitle>

        <div className="flex flex-col items-center gap-3 pt-4 pb-3">
          {author.isLoading ? (
            <>
              <Skeleton className="size-20 rounded-full" />
              <Skeleton className="h-5 w-32" />
            </>
          ) : (
            <>
              <Avatar shape={avatarShape} className="size-20 ring-4 ring-primary/10">
                <AvatarImage src={picture} alt={displayName} proxyWidth={160} />
                <AvatarFallback className="bg-primary/15 text-xl font-semibold text-primary">
                  {displayName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <p className="text-lg font-semibold leading-none text-center break-words max-w-full">
                {displayName}
              </p>
            </>
          )}
        </div>

        {error && (
          <p className="text-sm text-destructive text-center" role="alert">
            {error}
          </p>
        )}

        <div className="flex flex-col items-center gap-2">
          <Button
            className="w-full h-12 rounded-full"
            onClick={handleLogin}
            disabled={isLoggingIn}
          >
            {isLoggingIn ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                {t('auth.loggingIn')}
              </>
            ) : (
              t('auth.login')
            )}
          </Button>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="text-muted-foreground"
            onClick={onOtherLogin}
            disabled={isLoggingIn}
          >
            {t('auth.moreLoginOptions')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function genericName(pubkey: string): string {
  try {
    const npub = nip19.npubEncode(pubkey);
    return `${npub.slice(0, 10)}…${npub.slice(-4)}`;
  } catch {
    return 'Nostr user';
  }
}
