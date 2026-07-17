import { useCallback, useSyncExternalStore } from 'react';
import { useAppContext } from '@/hooks/useAppContext';
import { getStorageKey } from '@/lib/storageKey';

const CHANGE_EVENT = 'agora:hide-wallet-balance';

function readHideBalance(key: string): boolean {
  try {
    const item = localStorage.getItem(key);
    if (item === null) return false;
    return JSON.parse(item) === true;
  } catch {
    return false;
  }
}

function writeHideBalance(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage unavailable
  }
  // Notify same-tab listeners (`storage` only fires across tabs).
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { key } }));
}

function subscribeHideBalance(key: string, onStoreChange: () => void): () => void {
  const onCustom = (e: Event) => {
    if (e instanceof CustomEvent && e.detail?.key && e.detail.key !== key) return;
    onStoreChange();
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== key) return;
    onStoreChange();
  };
  window.addEventListener(CHANGE_EVENT, onCustom);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onCustom);
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * Shared preference for masking wallet balances (header pill, wallet page,
 * dashboard summary). Persists per appId so forks on the same origin don't
 * clobber each other. Same-tab consumers stay in sync via a custom event.
 */
export function useHideWalletBalance() {
  const { config } = useAppContext();
  const key = getStorageKey(config.appId, 'hideWalletBalance');

  const hideBalance = useSyncExternalStore(
    (onStoreChange) => subscribeHideBalance(key, onStoreChange),
    () => readHideBalance(key),
    () => false,
  );

  const setHideBalance = useCallback(
    (value: boolean | ((prev: boolean) => boolean)) => {
      const prev = readHideBalance(key);
      const next = typeof value === 'function' ? value(prev) : value;
      if (next === prev) return;
      writeHideBalance(key, next);
    },
    [key],
  );

  const toggleHideBalance = useCallback(() => {
    setHideBalance((prev) => !prev);
  }, [setHideBalance]);

  return { hideBalance, setHideBalance, toggleHideBalance } as const;
}

/** Mask body for hidden amounts (suffix after `$` / before unit labels). */
export const HIDDEN_BALANCE_MASK = '***';

/** Hidden USD balance keeps the leading `$` visible. */
export const HIDDEN_USD_LABEL = `$${HIDDEN_BALANCE_MASK}`;

/** Hidden BTC secondary line. */
export const HIDDEN_BTC_LABEL = `${HIDDEN_BALANCE_MASK} BTC`;
