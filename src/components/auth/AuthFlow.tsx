import { useEffect, useState } from 'react';
import AuthDialog from './AuthDialog';
import { QuickLoginDialog } from './QuickLoginDialog';

interface Nip07Provider {
  getPublicKey(): Promise<string>;
}

function getNip07Provider(): Nip07Provider | undefined {
  if (typeof window === 'undefined' || !('nostr' in window)) return undefined;
  const provider = (window as { nostr?: unknown }).nostr;
  if (
    provider &&
    typeof (provider as Nip07Provider).getPublicKey === 'function'
  ) {
    return provider as Nip07Provider;
  }
  return undefined;
}

interface AuthFlowProps {
  isOpen: boolean;
  onClose: () => void;
}

type View = 'probing' | 'quick' | 'full';

export function AuthFlow({ isOpen, onClose }: AuthFlowProps) {
  const [view, setView] = useState<View>('probing');
  const [quickLoginPubkey, setQuickLoginPubkey] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setView('probing');
      setQuickLoginPubkey(null);
      return;
    }

    let cancelled = false;

    const probe = async () => {
      const provider = getNip07Provider();
      if (provider) {
        try {
          const pubkey = await provider.getPublicKey();
          if (cancelled) return;
          if (pubkey) {
            setQuickLoginPubkey(pubkey);
            setView('quick');
            return;
          }
        } catch {
          // Extension declined or errored; fall back to the full login dialog.
        }
      }
      if (!cancelled) setView('full');
    };

    probe();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  return (
    <>
      {quickLoginPubkey && (
        <QuickLoginDialog
          isOpen={isOpen && view === 'quick'}
          pubkey={quickLoginPubkey}
          onClose={onClose}
          onOtherLogin={() => setView('full')}
        />
      )}

      <AuthDialog
        isOpen={isOpen && view === 'full'}
        onClose={onClose}
      />
    </>
  );
}
