import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Upload,
  ChevronDown,
  Loader2,
  ExternalLink,
  QrCode,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { QRCodeCanvas } from '@/components/ui/qrcode';
import { AgoraBoltIcon } from '@/components/icons/AgoraBoltIcon';
import { useAppContext } from '@/hooks/useAppContext';
import {
  useLoginActions,
  generateNostrConnectParams,
  generateNostrConnectURI,
  type NostrConnectParams,
  type NostrConnectStatus,
} from '@/hooks/useLoginActions';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useToast } from '@/hooks/useToast';
import { useOnboarding } from '@/contexts/onboardingContextDef';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface AuthDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * The dialog covers the login paths only — nsec, NIP-07 extension, bunker URI,
 * and NIP-46 nostrconnect. New-account signup is handled by the captive
 * `<OnboardingGate>` flow; the "Create account" link closes this dialog and
 * hands off to that flow.
 */
const validateNsec = (nsec: string) => /^nsec1[a-zA-Z0-9]{58}$/.test(nsec);
const validateBunkerUri = (uri: string) => uri.startsWith('bunker://');

/** Check if running on an actual mobile device (not just a small screen). */
function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

const AuthDialog: React.FC<AuthDialogProps> = ({ isOpen, onClose }) => {
  // Login state
  const [loginInput, setLoginInput] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState('');

  // Nostrconnect / bunker state
  const [nostrConnectParams, setNostrConnectParams] = useState<NostrConnectParams | null>(null);
  const [nostrConnectUri, setNostrConnectUri] = useState('');
  const [connectError, setConnectError] = useState<string | null>(null);
  // Progress status for the nostrconnect handshake. `null` means the user
  // hasn't kicked off the handshake yet (or they canceled) — we show the QR
  // / "Open signer app" button. Once the handshake advances we swap in a
  // spinner with a live status line so the user knows something is working.
  const [connectStatus, setConnectStatus] = useState<NostrConnectStatus | null>(null);
  // Tracks whether the user has explicitly initiated the handshake from the
  // mobile UI. The listen subscription itself starts the moment params are
  // generated — without this flag we'd flip into the progress view before
  // they've launched the signer app.
  // Desktop doesn't need this: it stays on the QR until the handshake
  // advances past `awaiting-connect`.
  const [hasOpenedSigner, setHasOpenedSigner] = useState(false);
  const [showQr, setShowQr] = useState(false);

  const login = useLoginActions();
  const { config } = useAppContext();
  const { startSignup } = useOnboarding();
  const { toast } = useToast();
  const { t } = useTranslation();

  const connectStatusLabel = (status: NostrConnectStatus | null): string => {
    switch (status) {
      case 'awaiting-connect':
        return t('auth.waitingForSigner');
      case 'getting-public-key':
        return t('auth.gettingPublicKey');
      default:
        return '';
    }
  };
  // Stable refs so the nostrconnect listening effect below doesn't restart on
  // every parent render. Parents typically pass inline arrow functions for
  // onClose, and useLoginActions returns a fresh object each render — without
  // stable refs, an effect depending on them would tear down the in-flight
  // subscription on every render and cause approved logins to be swallowed.
  const loginRef = useRef(login);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    loginRef.current = login;
  }, [login]);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMobile = useIsMobile();

  const hasExtension = typeof window !== 'undefined' && 'nostr' in window;

  // Reset state when the dialog closes.
  // This is the "reset state when a prop changes" pattern; the usual
  // React-preferred alternative is a `key` prop on the caller, but the
  // public API of this component is a simple open/close boolean, so we
  // reset here. The multiple setState calls are intentional.
  useEffect(() => {
    if (!isOpen) {
      setLoginInput('');
      setIsLoggingIn(false);
      setLoginError('');
      setNostrConnectParams(null);
      setNostrConnectUri('');
      setConnectError(null);
      setConnectStatus(null);
      setHasOpenedSigner(false);
      setShowQr(false);
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    }
  }, [isOpen]);

  // Generate a nostrconnect session (QR code data).
  const generateConnectSession = useCallback((): string => {
    const relayUrls = login.getRelayUrls();
    const params = generateNostrConnectParams(relayUrls);
    const uri = generateNostrConnectURI(params, {
      name: config.appName,
      callback: isMobileDevice() ? `${window.location.origin}/remoteloginsuccess` : undefined,
    });
    setNostrConnectParams(params);
    setNostrConnectUri(uri);
    setConnectError(null);
    return uri;
  }, [login, config.appName]);

  // Start listening for a nostrconnect response once params are set.
  //
  // Deps are intentionally limited to `nostrConnectParams` so that parent
  // re-renders (which produce fresh onClose closures and a fresh `login`
  // object from useLoginActions) do NOT tear down an in-flight
  // subscription. An earlier version used a `cancelled` flag flipped by
  // the effect's cleanup, which caused a successful nostrconnect response
  // to be silently swallowed after the signer approved — the subscription
  // was re-created mid-handshake and the first instance's success branch
  // saw `cancelled === true`.
  //
  // Cancellation is handled explicitly by the `isOpen` effect (on dialog
  // close) and by handleConnectRetry() (on user cancel/retry).
  useEffect(() => {
    if (!nostrConnectParams) return;

    const startListening = async () => {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        await loginRef.current.nostrconnect(
          nostrConnectParams,
          controller.signal,
          (status) => {
            if (controller.signal.aborted) return;
            setConnectStatus(status);
          },
        );
        // If the dialog was explicitly closed (handled by the isOpen
        // effect, which aborts the controller), don't try to re-close it.
        // Otherwise the user is logged in — close the dialog.
        if (controller.signal.aborted) return;
        onCloseRef.current();
      } catch (error) {
        // AbortError means we intentionally aborted (dialog closed or retry)
        if (error instanceof Error && error.name === 'AbortError') return;
        if (controller.signal.aborted) return;
        console.error('Nostrconnect failed:', error);
        setConnectStatus(null);
        setConnectError(error instanceof Error ? error.message : String(error));
      }
    };

    startListening();

    // No cleanup here: we do NOT want a re-render-triggered effect teardown
    // to cancel the in-flight subscription.
  }, [nostrConnectParams]);

  const handleConnectRetry = useCallback(() => {
    abortControllerRef.current?.abort();
    setNostrConnectParams(null);
    setNostrConnectUri('');
    setConnectError(null);
    setConnectStatus(null);
    setHasOpenedSigner(false);
    setShowQr(false);
    setTimeout(() => generateConnectSession(), 0);
  }, [generateConnectSession]);

  const handleConnectCancel = useCallback(() => {
    abortControllerRef.current?.abort();
    setNostrConnectParams(null);
    setNostrConnectUri('');
    setConnectError(null);
    setConnectStatus(null);
    setHasOpenedSigner(false);
    setShowQr(false);
  }, []);

  const handleOpenSignerApp = () => {
    setLoginError('');
    // Flip into the progress view *synchronously* before navigating so that
    // when the user returns from the signer app, the dialog is already
    // showing "Waiting for signer connection…" — not the original button
    // they're worried they need to re-tap.
    setHasOpenedSigner(true);
    const uri = nostrConnectUri || generateConnectSession();
    window.location.href = uri;
  };

  const handleShowQr = () => {
    setLoginError('');
    if (!nostrConnectParams && !connectError) {
      generateConnectSession();
    }
    setShowQr(true);
  };

  /**
   * Hand off from this login-focused dialog to the captive signup flow.
   * Closes the dialog first so the captive overlay isn't competing with a
   * still-open dialog (the captive overlay's z-50 would visually win, but
   * leaving the dialog mounted would keep stale login state around when the
   * dialog re-opens for any reason).
   */
  const goToSignup = useCallback(() => {
    onClose();
    startSignup();
  }, [onClose, startSignup]);

  // Login: submit the entered nsec or bunker URI.
  const handleLogin = () => {
    const value = loginInput.trim();
    if (!value) {
      setLoginError(t('auth.errorEnterLoginInput'));
      return;
    }

    if (validateBunkerUri(value)) {
      setIsLoggingIn(true);
      setLoginError('');
      login.bunker(value)
        .then(() => onClose())
        .catch(() => {
          setLoginError(t('auth.errorBunkerConnect'));
          setIsLoggingIn(false);
        });
      return;
    }

    if (!validateNsec(value)) {
      setLoginError(t('auth.errorInvalidLoginInput'));
      return;
    }

    setIsLoggingIn(true);
    setLoginError('');
    // Timeout gives the UI a chance to repaint before the synchronous login.
    setTimeout(() => {
      try {
        login.nsec(value);
        onClose();
      } catch {
        setLoginError(t('auth.errorLoginFailed'));
        setIsLoggingIn(false);
      }
    }, 50);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content && validateNsec(content.trim())) {
        setLoginInput(content.trim());
        setLoginError('');
      } else {
        setLoginError(t('auth.errorFileNoKey'));
      }
    };
    reader.onerror = () => setLoginError(t('auth.errorFileRead'));
    reader.readAsText(file);
  };

  const handleExtensionLogin = async () => {
    if (!hasExtension) return;
    setIsLoggingIn(true);
    try {
      await login.extension();
      onClose();
    } catch (e) {
      toast({
        variant: 'destructive',
        title: t('auth.extensionErrorTitle'),
        description: e instanceof Error ? e.message : t('auth.errorExtensionFailed'),
      });
      setIsLoggingIn(false);
    }
  };

  // Decide whether to render the progress view in place of the QR/button.
  // Mobile: flip in as soon as the user taps "Open signer app" (tracked by
  // `hasOpenedSigner`) so they see feedback the moment they return from the
  // signer. Desktop: keep the QR visible through the `awaiting-connect`
  // phase (it's still actionable — they might scan with another device) and
  // only swap in once the signer has acknowledged and we're fetching the
  // pubkey.
  const showProgressView = connectStatus === 'getting-public-key' ||
    (isMobile && hasOpenedSigner);
  const showLoginOptions = !connectError && !showProgressView && !showQr;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] sm:max-w-sm max-h-[90dvh] p-0 gap-0 overflow-hidden rounded-2xl overflow-y-auto">
        <div className="px-6 pb-4 pt-8 text-center">
          <div className="flex items-center justify-center">
            <AgoraBoltIcon className="size-20 drop-shadow-md" />
            <DialogTitle
              className="latin-display font-display font-normal tracking-wide leading-none uppercase text-6xl text-primary inline-block -ml-0.5"
              style={{
                WebkitTextStroke: '0.022em currentColor',
                transform: 'skewX(-6deg) scaleX(1.1)',
                transformOrigin: '0 100%',
              }}
            >
              {config.appName}
            </DialogTitle>
          </div>
        </div>

        <div className="px-6 pb-6 space-y-4">
          {connectError ? (
            <div className="flex flex-col items-center space-y-3 py-4">
              <p className="text-sm text-destructive text-center">{connectError}</p>
              <Button variant="outline" onClick={handleConnectRetry} className="rounded-full">
                {t('auth.tryAgain')}
              </Button>
            </div>
          ) : showProgressView ? (
            <div className="flex flex-col items-center space-y-4 py-6 w-full">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground text-center min-h-[1.25rem]">
                {connectStatusLabel(connectStatus) || t('auth.waitingForSigner')}
              </p>
              <button
                type="button"
                onClick={handleConnectCancel}
                className="text-sm text-primary hover:underline underline-offset-4 font-medium"
              >
                {t('auth.cancel')}
              </button>
            </div>
          ) : showQr ? (
            <div className="flex flex-col items-center space-y-4">
              {nostrConnectUri ? (
                <div className="p-4 bg-white rounded-xl">
                  <QRCodeCanvas value={nostrConnectUri} size={180} level="M" />
                </div>
              ) : (
                <div className="flex items-center justify-center h-[180px]">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
              )}
              <p className="text-sm text-muted-foreground text-center">
                {t('auth.scanSignerPrompt')}
              </p>
              <button
                type="button"
                onClick={handleConnectCancel}
                className="text-sm text-muted-foreground hover:text-foreground motion-safe:transition-colors"
              >
                {t('auth.back')}
              </button>
            </div>
          ) : showLoginOptions ? (
            <>
              <LoginForm
                loginInput={loginInput}
                setLoginInput={setLoginInput}
                loginError={loginError}
                setLoginError={setLoginError}
                isLoggingIn={isLoggingIn}
                onSubmit={handleLogin}
                onFileChange={handleFileUpload}
                onExtensionLogin={handleExtensionLogin}
                onOpenSignerApp={handleOpenSignerApp}
                onShowQr={handleShowQr}
                fileInputRef={fileInputRef}
                hasExtension={hasExtension}
                isMobile={isMobile}
                t={t}
              />

              <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                <span>{t('auth.or')}</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={goToSignup}
                className="w-full h-12 rounded-full border-primary/30 text-primary hover:bg-primary/10 hover:text-primary"
              >
                {t('auth.createNewAccount')}
              </Button>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
};

/** Combined nsec/bunker login form with Ditto-style secondary options. */
interface LoginFormProps {
  loginInput: string;
  setLoginInput: (v: string) => void;
  loginError: string;
  setLoginError: (v: string) => void;
  isLoggingIn: boolean;
  onSubmit: () => void;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onExtensionLogin: () => void;
  onOpenSignerApp: () => void;
  onShowQr: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  hasExtension: boolean;
  isMobile: boolean;
  t: (key: string) => string;
}

const LoginForm: React.FC<LoginFormProps> = ({
  loginInput,
  setLoginInput,
  loginError,
  setLoginError,
  isLoggingIn,
  onSubmit,
  onFileChange,
  onExtensionLogin,
  onOpenSignerApp,
  onShowQr,
  fileInputRef,
  hasExtension,
  isMobile,
  t,
}) => (
  <form
    onSubmit={(e) => {
      e.preventDefault();
      onSubmit();
    }}
    className="space-y-3"
    data-nsec-allowed
  >
    <div className="relative">
      <Input
        type="password"
        value={loginInput}
        onChange={(e) => {
          setLoginInput(e.target.value);
          if (loginError) setLoginError('');
        }}
        placeholder={t('auth.loginInputPlaceholder')}
        autoComplete="off"
        className={cn(
          'h-12 pr-12 text-base md:text-sm',
          loginError && 'border-destructive focus-visible:ring-destructive',
        )}
      />
      <input
        type="file"
        accept=".txt"
        className="hidden"
        ref={fileInputRef}
        onChange={onFileChange}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-0 top-0 h-full w-11 rounded-l-none border-l border-input bg-muted/40 hover:bg-muted"
            title={t('auth.moreLoginOptions')}
            aria-label={t('auth.moreLoginOptions')}
          >
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="z-[300]">
          <DropdownMenuItem
            onSelect={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 cursor-pointer"
          >
            <Upload className="h-4 w-4" />
            {t('auth.uploadKeyFile')}
          </DropdownMenuItem>
          {hasExtension && (
            <DropdownMenuItem
              onSelect={onExtensionLogin}
              className="flex items-center gap-2 cursor-pointer"
            >
              <ExternalLink className="h-4 w-4" />
              {t('auth.loginWithExtension')}
            </DropdownMenuItem>
          )}
          {isMobile ? (
            <DropdownMenuItem
              onSelect={onOpenSignerApp}
              className="flex items-center gap-2 cursor-pointer"
            >
              <ExternalLink className="h-4 w-4" />
              {t('auth.openSignerApp')}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onSelect={onShowQr}
              className="flex items-center gap-2 cursor-pointer"
            >
              <QrCode className="h-4 w-4" />
              {t('auth.useRemoteSigner')}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    {loginError && <p className="text-sm text-destructive">{loginError}</p>}

    <Button
      type="submit"
      disabled={isLoggingIn || !loginInput.trim()}
      className="w-full h-12 rounded-full"
    >
      {isLoggingIn ? t('auth.loggingIn') : t('auth.login')}
    </Button>
  </form>
);

export default AuthDialog;
