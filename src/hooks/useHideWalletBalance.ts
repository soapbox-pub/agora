import { useCallback } from 'react';
import { useAppContext } from '@/hooks/useAppContext';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { getStorageKey } from '@/lib/storageKey';

/**
 * Shared preference for masking wallet balances (header pill, wallet page,
 * dashboard summary). Persists per appId so forks on the same origin don't
 * clobber each other.
 */
export function useHideWalletBalance() {
  const { config } = useAppContext();
  const [hideBalance, setHideBalance] = useLocalStorage(
    getStorageKey(config.appId, 'hideWalletBalance'),
    false,
  );

  const toggleHideBalance = useCallback(() => {
    setHideBalance((prev) => !prev);
  }, [setHideBalance]);

  return { hideBalance, setHideBalance, toggleHideBalance } as const;
}

/** Fixed-width mask used whenever balances are hidden. */
export const HIDDEN_BALANCE_LABEL = '••••';
