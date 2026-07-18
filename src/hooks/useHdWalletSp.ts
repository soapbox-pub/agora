import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNostr } from '@nostrify/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useHdWalletAccess } from '@/hooks/useHdWalletAccess';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { fetchFreshEvent } from '@/lib/fetchFreshEvent';
import {
  deriveSilentPaymentKeys,
  type SilentPaymentKeys,
} from '@/lib/hdwallet/derivation';
import { fetchBlockTime, fetchTxOutputs, fetchUtxoSpentStatus } from '@/lib/hdwallet/blockbook';
import { bytesToHex, derivePkFromStoredTweak, hexToBytes } from '@/lib/hdwallet/sp/crypto';
import { fetchTipHeight } from '@/lib/hdwallet/sp/indexer';
import { fetchBlockEntriesCached } from '@/lib/hdwallet/sp/blockCache';
import { scanBatch, type SPMatchedUtxo } from '@/lib/hdwallet/sp/scanner';
import { createSpScanWorker } from '@/lib/hdwallet/sp/scanWorkerClient';
import {
  EMPTY_SP_STORAGE,
  archiveSpentUtxos,
  matchedUtxoToStored,
  mergeUtxos,
  parseSPStorage,
  pruneSpUtxos,
  serializeSPStorage,
  type SpentOutpoint,
  type SPStorageDocument,
  type SPStoredUtxo,
  spStorageBalance,
  spStorageDTag,
  SP_STORAGE_VERSION,
  stampSpentArchive,
} from '@/lib/hdwallet/sp/storage';

// ---------------------------------------------------------------------------
// HD wallet — silent-payments orchestrator
// ---------------------------------------------------------------------------
//
// Pulls everything below together so the HD wallet UI can:
//
//   1. Read the persisted SP UTXO state (NIP-78 / kind 30078, NIP-44 encrypted).
//   2. Run a chain scan against a BlindBit Oracle v2 indexer in user-driven
//      ranges (`scanRange({ fromHeight, toHeight? })`).
//   3. Persist freshly discovered UTXOs back to the encrypted NIP-78 event
//      as they're found.
//
// Spending and sending are deliberately not in scope — see
// `src/lib/hdwallet/sp/crypto.ts` for the rationale.
// ---------------------------------------------------------------------------

/** Default scan window when the user clicks "Scan recent" with no explicit bounds. */
const DEFAULT_RECENT_SCAN_BLOCKS = 144; // ~24 hours of mainnet blocks.

/**
 * How far back the *automatic* background scanner reaches on a wallet that
 * has never been scanned (`scanHeight === 0`). Bounds the very first
 * unattended pass so a fresh wallet doesn't try to walk the chain from
 * genesis (hundreds of thousands of per-block round trips). ~1 week of
 * mainnet blocks covers the common "I just set this up and someone paid me
 * recently" case; deeper history is available via a manual scan from the
 * dialog, which then lets auto-scan resume contiguously from `scanHeight`.
 */
const AUTO_SCAN_INITIAL_WINDOW_BLOCKS = 1008; // ~7 days of mainnet blocks.

/**
 * Maximum distinct txids to check per manual reconcile click. Bounds the
 * Blockbook WS fan-out on wallets with many stored SP UTXOs — remaining
 * entries are picked up on subsequent clicks.
 */
const MAX_RECONCILE_UTXOS = 50;

/**
 * Default for how many block fetches to keep in flight at once during a scan.
 *
 * The BlindBit Oracle exposes only per-block endpoints (`/tweaks/:H`,
 * `/utxos/:H`), so a 144-block "recent" scan does up to ~288 HTTP round
 * trips. On the public mainnet indexer each round trip is ~700ms over the
 * wire, which makes latency — not ECDH compute or bandwidth — the dominant
 * cost. Sequential fetching takes ~200s wall-clock; the same workload at
 * concurrency 8 finishes in ~25s while still being polite to the indexer
 * (anecdotally ~6× speedup at concurrency 10 against the public host).
 *
 * Tunable via `AppConfig.bip352ScanConcurrency`: higher values keep the
 * indexer hotter but risk rate-limiting or TCP-level head-of-line blocking on
 * slow links. Lower values trend toward the old sequential behaviour. Users
 * with a fast self-hosted indexer can crank it up; the public host is best
 * left near the default. Clamped to [1, 32].
 */
const DEFAULT_SCAN_FETCH_CONCURRENCY = 8;
const MIN_SCAN_FETCH_CONCURRENCY = 1;
const MAX_SCAN_FETCH_CONCURRENCY = 32;

/** Clamp a configured concurrency to the safe range, falling back to the default. */
function resolveScanConcurrency(configured: number | undefined): number {
  if (!Number.isInteger(configured)) return DEFAULT_SCAN_FETCH_CONCURRENCY;
  return Math.min(
    MAX_SCAN_FETCH_CONCURRENCY,
    Math.max(MIN_SCAN_FETCH_CONCURRENCY, configured as number),
  );
}

/**
 * Local-storage key for the per-device "auto-scan enabled" preference.
 * Plain UX flag (not secret), so it lives in `localStorage` rather than the
 * encrypted NIP-78 document — a user who disables background scanning on a
 * shared/low-power device shouldn't have that choice fan out to every device.
 */
const AUTO_SCAN_PREF_KEY = 'hdwallet:sp:auto-scan';

/**
 * How often, at most, to checkpoint the advancing `scanHeight` to
 * localStorage during a scan. Publishing the encrypted NIP-78 doc to relays
 * costs an encrypt + signEvent (possibly a signer prompt) + broadcast, so we
 * deliberately do NOT do that every few seconds — relay publishes stay gated
 * to matches and end-of-scan. The local checkpoint is free and synchronous,
 * so a tight 5s cadence bounds how much a mid-scan refresh has to re-scan
 * (≈ the blocks scanned in the last 5s) without any signer/relay traffic.
 */
const LOCAL_CHECKPOINT_THROTTLE_MS = 5000;

/**
 * Per-(pubkey, indexer) localStorage key for the locally-checkpointed
 * `scanHeight`. Scoped by indexer because two indexers can disagree on tip,
 * and by pubkey so switching accounts doesn't resume from the wrong cursor.
 */
function localCheckpointKey(pubkey: string, indexerUrl: string): string {
  return `hdwallet:sp:checkpoint:${pubkey}:${indexerUrl}`;
}

/** Read the locally-checkpointed scanHeight, or 0 if absent/unparseable. */
function readLocalCheckpoint(pubkey: string, indexerUrl: string): number {
  if (!pubkey || !indexerUrl) return 0;
  try {
    const raw = localStorage.getItem(localCheckpointKey(pubkey, indexerUrl));
    if (raw === null) return 0;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Persist a locally-checkpointed scanHeight. Monotonic: never lowers the
 * stored value, so a stale write (or a relay copy that's actually further
 * ahead) can't drag the resume cursor backward.
 */
function writeLocalCheckpoint(pubkey: string, indexerUrl: string, height: number): void {
  if (!pubkey || !indexerUrl) return;
  try {
    const key = localCheckpointKey(pubkey, indexerUrl);
    if (height <= readLocalCheckpoint(pubkey, indexerUrl)) return;
    localStorage.setItem(key, String(height));
  } catch {
    // localStorage unavailable (private mode, quota) — degrade gracefully to
    // the relay-only checkpoint. Worst case is the pre-existing behaviour.
  }
}

interface UseHdWalletSpResult {
  /** Whether the feature is usable. False when not logged in with nsec, or no indexer configured. */
  enabled: boolean;
  /** Concrete reason `enabled` is false, when applicable. */
  unavailableReason?: 'logged-out' | 'unsupported-signer' | 'no-indexer';

  /** The wallet's SP key material. `undefined` until the hook is enabled. */
  keys?: SilentPaymentKeys;

  /** The decrypted persisted UTXO document. `undefined` while loading. */
  storage?: SPStorageDocument;
  /** Sum of all stored SP UTXO values, in satoshis. */
  balance: number;
  /** True until the first storage load resolves. */
  isLoading: boolean;

  /** Active scan progress, if any. */
  scanProgress?: {
    fromHeight: number;
    toHeight: number;
    currentHeight: number;
    matchesFound: number;
  };
  /** True while `scanRange` (or a derived helper) is running. */
  isScanning: boolean;
  /**
   * True when the currently running scan was started automatically by the
   * background auto-scanner rather than by an explicit user action. Lets the
   * UI distinguish "we're quietly catching up in the background" from "you
   * pressed Scan". `false` whenever `isScanning` is `false`.
   */
  isAutoScanning: boolean;
  /** Error from the most recent scan, if it failed. Cleared on next scan start. */
  scanError?: Error;

  /**
   * Whether automatic background scanning is enabled. When `true`, the
   * provider resumes scanning from the last persisted `scanHeight` on load
   * and keeps up with the chain tip without any user interaction. Persisted
   * per-device in local storage; defaults to `true`.
   */
  autoScanEnabled: boolean;
  /** Toggle automatic background scanning on/off (persisted per-device). */
  setAutoScanEnabled: (enabled: boolean) => void;

  /** Tip height as reported by the indexer (cached, lightly refreshed). */
  tipHeight?: number;

  /**
   * Scan a contiguous block range. `toHeight` defaults to current tip.
   *
   * `includeSpent` opts into a deeper rescan that also considers UTXOs
   * already spent on-chain. Matches against spent outputs land in the
   * `spent` archive rather than the active set — useful for recovering
   * historical receive rows when the wallet's local doc was pruned
   * without archiving (e.g. by a build that predates the archive logic).
   */
  scanRange: (args: {
    fromHeight: number;
    toHeight?: number;
    includeSpent?: boolean;
  }) => Promise<void>;
  /** Scan the most recent `DEFAULT_RECENT_SCAN_BLOCKS` blocks (or fewer if newer). */
  scanRecent: () => Promise<void>;
  /** Abort an in-flight scan. */
  cancelScan: () => void;

  /**
   * Drop the given SP UTXOs from local storage and republish the NIP-78
   * document so other devices stay in sync.
   *
   * Called by the send flow after a successful broadcast — Blockbook's
   * xpub-scoped scan can't observe silent-payment outputs, so without
   * this the wallet has no way to learn that an SP UTXO it just spent is
   * gone. Failure to call it (or to publish) results in stale balance and
   * subsequent double-spend attempts.
   *
   * Entries may carry `spentTxid` / `spentHeight` / `spentTime` — the
   * archived copies are stamped with them so the private tab's history can
   * render the spend as a "Sent" row (see `useHdWallet`'s tx assembly).
   *
   * `change` are freshly-created SP UTXOs the same broadcast paid back to
   * the wallet's own `sp1` address (private-send change). They're inserted
   * into the active set in the same document update, so the balance and
   * the Sent row net out immediately instead of overstating the spend by
   * the change amount until the BIP-352 scanner reaches the confirming
   * block. The scanner later rediscovers the same outpoint and overwrites
   * the placeholder `height: 0` with the real block height.
   */
  pruneSpentUtxos: (
    spent: ReadonlyArray<SpentOutpoint>,
    change?: ReadonlyArray<SPStoredUtxo>,
  ) => void;

  /**
   * Overwrite the stored `value` of the given active SP UTXOs with the
   * authoritative on-chain values and republish the NIP-78 document.
   *
   * Called by the send flow when its pre-broadcast verification finds a
   * stored value that disagrees with the chain — the BIP-341 sighash
   * commits to every prevout's amount, so signing with a wrong value
   * produces a broadcast rejected with "Invalid Schnorr signature". After
   * the correction a retry builds against the fixed values and succeeds.
   */
  correctUtxoValues: (
    corrections: ReadonlyArray<{ txid: string; vout: number; value: number }>,
  ) => void;

  /** Progress for an in-flight reconcile (or the last completed one). */
  reconcileProgress?: {
    /** Number of UTXOs queued for checking this run. */
    total: number;
    /** UTXOs whose Blockbook lookup has completed. */
    checked: number;
    /** UTXOs flagged as spent and pruned. */
    prunedSoFar: number;
  };
  /** True while a reconcile pass is in flight. */
  isReconciling: boolean;
  /** Error from the most recent reconcile, cleared on next start. */
  reconcileError?: Error;

  /**
   * Walk the stored SP UTXO set, ask Blockbook whether each one is still
   * unspent, and prune any that are spent. Capped at 50 distinct txids per
   * call to bound network fan-out — remaining entries are reconciled on
   * the next click.
   *
   * Exists because Blockbook's xpub scan can't observe SP outputs, so a
   * UTXO spent outside the local send flow (different device, pre-fix
   * build) would otherwise linger in the encrypted NIP-78 doc forever.
   *
   * Resolves with the number of UTXOs pruned this pass.
   */
  reconcileSpentUtxos: () => Promise<number>;
}

const EMPTY_RESULT: UseHdWalletSpResult = {
  enabled: false,
  balance: 0,
  isLoading: false,
  isScanning: false,
  isAutoScanning: false,
  autoScanEnabled: true,
  setAutoScanEnabled: () => {},
  scanRange: async () => {},
  scanRecent: async () => {},
  cancelScan: () => {},
  pruneSpentUtxos: () => {},
  correctUtxoValues: () => {},
  isReconciling: false,
  reconcileSpentUtxos: async () => 0,
};

export function useHdWalletSpInternal(): UseHdWalletSpResult {
  const { config } = useAppContext();
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const access = useHdWalletAccess();
  const queryClient = useQueryClient();

  const indexerUrl = (config.bip352IndexerUrl ?? '').trim();
  const blockbookUrl = (config.blockbookBaseUrl ?? '').trim();
  const scanConcurrency = resolveScanConcurrency(config.bip352ScanConcurrency);
  const pubkey = access.status === 'available' ? access.pubkey : '';
  const seed = access.status === 'available' ? access.seed : undefined;

  // ── SP key derivation (memoised) ─────────────────────────────
  const keys = useMemo<SilentPaymentKeys | undefined>(() => {
    if (!seed) return undefined;
    return deriveSilentPaymentKeys(seed);
  }, [seed]);

  // ── Availability gating ──────────────────────────────────────
  // Compute the early-return shape *before* hooks branch so React's
  // hook-order rule stays happy.
  const unavailableReason: UseHdWalletSpResult['unavailableReason'] =
    access.status === 'logged-out'
      ? 'logged-out'
      : access.status === 'unsupported'
        ? 'unsupported-signer'
        : indexerUrl === ''
          ? 'no-indexer'
          : undefined;
  const enabled = unavailableReason === undefined;

  // ── Stable d-tag for the persisted UTXO event ────────────────
  const dTag = spStorageDTag(config.appId);

  // One string that changes iff the wallet identity changes. The provider
  // hosting this hook is mounted once at the app root and survives account
  // switches, so every piece of in-memory state below (the optimistic doc,
  // the ran-once backfill latches, in-flight async work) must be scoped to
  // the identity that produced it — otherwise one account's UTXO set leaks
  // into the next account's storage and gets signed and published under
  // the wrong key.
  const walletId = `${pubkey}:${dTag}`;

  // ── Tip-height query (cheap, refreshed every 60s when enabled) ──
  const { data: tipHeight } = useQuery<number>({
    queryKey: ['hdwallet-sp-tip', indexerUrl],
    queryFn: ({ signal }) => fetchTipHeight(indexerUrl, signal),
    enabled,
    refetchInterval: 60_000,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  // ── Persisted storage event ──────────────────────────────────
  //
  // Two-stage query like `useEncryptedSettings`: stage 1 fetches the raw
  // event from relays, stage 2 NIP-44-decrypts it. We key the parse stage
  // on the event id so a stale parse doesn't survive an event update.
  const storageEventQuery = useQuery({
    queryKey: ['hdwallet-sp-event', pubkey, dTag],
    queryFn: async ({ signal }) => {
      if (!user) return null;
      // Hard timeout: an un-signalled pool query can hang forever on a
      // wonky relay, which pins `storage` (and therefore the whole wallet
      // UI) in its pre-fetch state — most visibly right after an account
      // switch, when this query is the only thing standing between the
      // previous account's rendered wallet and the new account's.
      const events = await nostr.query([
        {
          kinds: [30078],
          authors: [user.pubkey],
          '#d': [dTag],
          limit: 1,
        },
      ], { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
      if (events.length === 0) return null;
      // Pick the most recent if multiple relays returned different versions.
      return events.reduce((latest, current) =>
        current.created_at > latest.created_at ? current : latest,
      );
    },
    enabled: enabled && !!user,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  const storageDocQuery = useQuery<SPStorageDocument>({
    // Keyed by pubkey + event id. The '(none)' sentinel means "the event
    // query settled and found no document" — a genuinely fresh wallet. It
    // must NOT be reachable while the event query is still loading (see
    // `enabled` below): serving the empty placeholder mid-load is what let
    // the UI flash $0 on account switches, and what let effects latch
    // against a doc that wasn't real.
    queryKey: ['hdwallet-sp-doc', pubkey, storageEventQuery.data?.id ?? '(none)'],
    queryFn: async () => {
      const event = storageEventQuery.data;
      if (!event) return { ...EMPTY_SP_STORAGE };
      if (!user?.signer.nip44) return { ...EMPTY_SP_STORAGE };
      if (!event.content) return { ...EMPTY_SP_STORAGE };
      try {
        const plaintext = await user.signer.nip44.decrypt(user.pubkey, event.content);
        return parseSPStorage(plaintext);
      } catch (err) {
        console.warn('Failed to decrypt SP storage event; treating as empty:', err);
        return { ...EMPTY_SP_STORAGE };
      }
    },
    // Wait for the event query to settle before producing ANY document.
    // While it's in flight `storage` stays undefined ("loading"), which is
    // semantically different from the empty document ("this wallet has no
    // UTXOs"): scans, backfills, the ownership audit, and the UI all gate
    // on `storage` being present.
    enabled: enabled && !!user && storageEventQuery.isFetched,
    staleTime: 0,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // ── Optimistic in-memory copy ────────────────────────────────
  //
  // The relay round-trip on each scan-progress tick would be unacceptable, so
  // we maintain an in-memory document that the scanner updates synchronously
  // and the relay republish coalesces every few seconds. The `?? loaded`
  // pattern below means we drop the optimistic copy as soon as a newer
  // event lands.
  const optimisticRef = useRef<SPStorageDocument | null>(null);
  const [optimisticVersion, setOptimisticVersion] = useState(0);
  void optimisticVersion; // touched so React knows to re-render on bump

  // The optimistic doc belongs to exactly one wallet identity. Reset it
  // synchronously during render on identity change (same render-write
  // pattern as `storageRef` below) so not even this render's `storage`
  // memo can observe the previous account's doc — the freshness heuristic
  // would happily prefer a leftover doc with a higher scanHeight and more
  // entries, presenting account A's UTXOs as account B's wallet.
  const optimisticOwnerRef = useRef(walletId);
  if (optimisticOwnerRef.current !== walletId) {
    optimisticOwnerRef.current = walletId;
    optimisticRef.current = null;
  }

  const storage = useMemo<SPStorageDocument | undefined>(() => {
    if (!enabled) return undefined;
    if (!storageDocQuery.data) return undefined;
    // Prefer the optimistic copy when it's at least as fresh as relays.
    const loaded = storageDocQuery.data;
    const opt = optimisticRef.current;
    if (!opt) return loaded;
    // Heuristic: optimistic wins when it's caught up scan-wise AND it
    // accounts for at least as many entries (active + archived) as the
    // loaded copy. The combined-count check matters because prunes shrink
    // `utxos` while growing `spent`, and deep rescans grow `spent` without
    // touching `utxos`.
    const optTotal = opt.utxos.length + (opt.spent?.length ?? 0);
    const loadedTotal = loaded.utxos.length + (loaded.spent?.length ?? 0);
    if (opt.scanHeight >= loaded.scanHeight && optTotal >= loadedTotal) {
      return opt;
    }
    return loaded;
  }, [enabled, storageDocQuery.data]);

  // ── Mutation: persist a new document to relays ───────────────
  //
  // Optionally accepts a list of `(txid, vout)` entries that were spent
  // locally; these are stripped from the remote-merged document too, so
  // the canonical published copy actually loses the spent UTXOs instead
  // of having them merged back in by `mergeUtxos` (which is insert-only).
  const publishStorage = useMutation({
    mutationFn: async (args: {
      next: SPStorageDocument;
      spent?: ReadonlyArray<SpentOutpoint>;
      /**
       * Pubkey of the account whose state produced `next`. Callers pass the
       * pubkey from their own closure; a stale chain surviving from before
       * an account switch therefore carries the OLD pubkey and is rejected
       * here instead of being merged into the new account's document and
       * signed with the new account's key.
       */
      owner: string;
      /**
       * Outpoints to remove from BOTH the active set and the archive, on
       * both sides of the merge, without archiving them. Used by the
       * ownership audit to expel foreign entries (another account's UTXOs
       * that leaked in via the pre-fix account-switch contamination):
       * unlike `spent`, these were never this wallet's coins, so they must
       * not leave a tombstone — and without stripping them from the remote
       * copy the insert-preferring merge would resurrect them.
       */
      purge?: ReadonlyArray<{ txid: string; vout: number }>;
    }) => {
      const { next, spent, owner, purge } = args;
      if (!user) throw new Error('not logged in');
      if (owner !== user.pubkey) {
        throw new Error('SP storage publish dropped: wallet identity changed since this document was built');
      }
      const purgeKeys = new Set((purge ?? []).map((p) => `${p.txid}:${p.vout}`));
      if (!user.signer.nip44) throw new Error('signer does not support NIP-44');
      // Always read-modify-write off the freshest event so a concurrent device
      // doesn't lose its progress.
      const prev = await fetchFreshEvent(nostr, {
        kinds: [30078],
        authors: [user.pubkey],
        '#d': [dTag],
      });
      let merged: SPStorageDocument = next;
      if (prev?.content) {
        try {
          const decrypted = await user.signer.nip44.decrypt(user.pubkey, prev.content);
          const remote = parseSPStorage(decrypted);
          // Prune any spent or purged UTXOs from the remote *before* the
          // merge — otherwise insert-only `mergeUtxos` would re-add them.
          const remoteUtxos = (spent && spent.length > 0
            ? pruneSpUtxos(remote.utxos, spent)
            : remote.utxos
          ).filter((u) => !purgeKeys.has(`${u.txid}:${u.vout}`));
          // Merge the spent archive: union both sides' archives, plus the
          // entries we just pruned out of `remote.utxos`. Without this a
          // racing relay copy could resurrect a row in `utxos` that the
          // local prune already classified as spent, or drop archive
          // entries the local copy intentionally retained for history.
          const localArchive = (next.spent ?? []).filter(
            (u) => !purgeKeys.has(`${u.txid}:${u.vout}`),
          );
          const remoteArchive = (remote.spent ?? []).filter(
            (u) => !purgeKeys.has(`${u.txid}:${u.vout}`),
          );
          const archiveByKey = new Map<string, SPStoredUtxo>();
          for (const u of remoteArchive) archiveByKey.set(`${u.txid}:${u.vout}`, u);
          for (const u of localArchive) {
            const k = `${u.txid}:${u.vout}`;
            const prior = archiveByKey.get(k);
            // Prefer whichever copy knows what spent the UTXO — a stale
            // relay archive written before spend-stamping must not wipe a
            // freshly-stamped local entry.
            if (!prior || (prior.spentTxid === undefined && u.spentTxid !== undefined)) {
              archiveByKey.set(k, u);
            }
          }
          // Pull pruned-from-remote rows into the archive too — they're
          // outpoints we know are spent but the remote didn't realise.
          if (spent && spent.length > 0) {
            const spentByKey = new Map(spent.map((s) => [`${s.txid}:${s.vout}`, s]));
            for (const u of remote.utxos) {
              const k = `${u.txid}:${u.vout}`;
              const info = spentByKey.get(k);
              if (info && !archiveByKey.has(k)) {
                archiveByKey.set(k, {
                  ...u,
                  ...(info.spentTxid !== undefined ? { spentTxid: info.spentTxid } : {}),
                  ...(info.spentHeight !== undefined ? { spentHeight: info.spentHeight } : {}),
                  ...(info.spentTime !== undefined ? { spentTime: info.spentTime } : {}),
                });
              }
            }
          }
          merged = {
            version: SP_STORAGE_VERSION,
            scanHeight: Math.max(remote.scanHeight, next.scanHeight),
            // The merged archive is authoritative: an outpoint recorded as
            // spent by EITHER side must never survive in the active set.
            // `mergeUtxos` is insert-preferring, so without this filter a
            // stale relay copy that still lists an already-spent UTXO in
            // `utxos` would resurrect it in the canonical published doc —
            // the coin selector would then re-pick it and the broadcast
            // would be rejected as a mempool conflict.
            utxos: mergeUtxos(remoteUtxos, next.utxos).filter(
              (u) =>
                !archiveByKey.has(`${u.txid}:${u.vout}`) &&
                !purgeKeys.has(`${u.txid}:${u.vout}`),
            ),
            spent: Array.from(archiveByKey.values()),
          };
        } catch {
          // Treat undecryptable remote as empty rather than blocking the write.
        }
      }
      const ciphertext = await user.signer.nip44.encrypt(user.pubkey, serializeSPStorage(merged));
      const unsigned = {
        kind: 30078,
        content: ciphertext,
        tags: [
          ['d', dTag],
          ['title', `${config.appName} HD Wallet — Silent Payment UTXOs`],
          ['client', config.appName, ...(config.client ? [config.client] : [])],
          ['alt', 'Encrypted silent-payment UTXO set for the HD wallet'],
        ],
        created_at: Math.floor(Date.now() / 1000),
      };
      const signed = await user.signer.signEvent(unsigned);
      // Best-effort publish — the local optimistic copy is still authoritative.
      nostr.event(signed, { signal: AbortSignal.timeout(5000) }).catch((e) => {
        console.warn('Failed to publish SP storage event:', e);
      });
      return { merged, signed };
    },
    onSuccess: ({ merged, signed }) => {
      // A publish that raced an account switch must not write the previous
      // account's event into the current account's cache slots.
      if (signed.pubkey !== pubkey) return;
      // Update query caches in-place to avoid an immediate refetch round-trip.
      queryClient.setQueryData(['hdwallet-sp-event', pubkey, dTag], signed);
      queryClient.setQueryData(['hdwallet-sp-doc', pubkey, signed.id], merged);
    },
  });

  // ── Scan state ───────────────────────────────────────────────
  const [scanProgress, setScanProgress] = useState<UseHdWalletSpResult['scanProgress']>();
  const [scanError, setScanError] = useState<Error | undefined>();
  const [isScanning, setIsScanning] = useState(false);
  // True when the currently running scan was kicked off by the background
  // auto-scanner rather than an explicit user action. Tracked separately from
  // `isScanning` so the UI can show a quieter "catching up" affordance for
  // automatic passes while still surfacing a full progress bar for manual
  // ones. Always reset to `false` when a scan finishes.
  const [isAutoScanning, setIsAutoScanning] = useState(false);
  const scanAbortRef = useRef<AbortController | null>(null);
  // Throttle timer for republishing storage during a long scan. Armed once
  // when there's unpublished progress; subsequent `scheduleRepublish` calls
  // while the timer is armed are no-ops. This guarantees a publish at least
  // every `REPUBLISH_THROTTLE_MS` during a continuous scan — unlike a
  // trailing debounce, which keeps resetting and may never fire.
  const republishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True when `optimisticRef.current` contains a *match* that hasn't been
  // republished yet. Scan-height advancement alone does NOT set this — we
  // don't want to fire a relay event every 5s during a 10k-block walk over
  // empty blocks. The final flush in `scanRange`'s `finally` publishes
  // unconditionally so the advanced `scanHeight` still gets checkpointed.
  const republishDirtyRef = useRef(false);
  // Wall-clock timestamp (ms) of the last local scanHeight checkpoint write,
  // so the scan loop can throttle localStorage writes to once per
  // `LOCAL_CHECKPOINT_THROTTLE_MS` instead of once per block.
  const lastLocalCheckpointAtRef = useRef(0);

  const cancelScan = useCallback(() => {
    scanAbortRef.current?.abort();
  }, []);

  const flushRepublish = useCallback(() => {
    if (republishTimerRef.current) {
      clearTimeout(republishTimerRef.current);
      republishTimerRef.current = null;
    }
    const doc = optimisticRef.current;
    if (!doc) return;
    republishDirtyRef.current = false;
    publishStorage.mutate({ next: doc, owner: pubkey });
  }, [publishStorage, pubkey]);

  const REPUBLISH_THROTTLE_MS = 5000;
  const scheduleRepublish = useCallback(() => {
    // Already armed — let the existing timer fire. This is the difference
    // from a debounce: we don't reset on every call, so a tight scan loop
    // still publishes on the original schedule.
    if (republishTimerRef.current) return;
    // Nothing worth publishing — don't arm.
    if (!republishDirtyRef.current) return;
    republishTimerRef.current = setTimeout(() => {
      republishTimerRef.current = null;
      const doc = optimisticRef.current;
      if (!doc) return;
      if (!republishDirtyRef.current) return;
      republishDirtyRef.current = false;
      publishStorage.mutate({ next: doc, owner: pubkey });
    }, REPUBLISH_THROTTLE_MS);
  }, [publishStorage, pubkey]);

  // ── The core scan loop ───────────────────────────────────────
  //
  // `auto` distinguishes a background auto-scan pass (driven by the effect
  // below) from a user-initiated scan. It only affects the `isAutoScanning`
  // flag the UI reads — the actual scan work is identical.
  const runScan = useCallback(
    async ({
      fromHeight,
      toHeight,
      includeSpent = false,
      auto = false,
    }: {
      fromHeight: number;
      toHeight?: number;
      includeSpent?: boolean;
      auto?: boolean;
    }) => {
      if (!enabled || !keys) return;
      if (!storage) return; // Wait for the first load — caller can retry.
      if (!Number.isInteger(fromHeight) || fromHeight < 0) {
        throw new Error(`Invalid fromHeight: ${fromHeight}`);
      }

      // Resolve the upper bound — default to current tip.
      const resolvedTo = toHeight ?? tipHeight ?? (await fetchTipHeight(indexerUrl));
      if (!Number.isInteger(resolvedTo) || resolvedTo < fromHeight) {
        throw new Error(`Invalid toHeight: ${resolvedTo}`);
      }

      // Abort any prior in-flight scan.
      scanAbortRef.current?.abort();
      const controller = new AbortController();
      scanAbortRef.current = controller;

      setScanError(undefined);
      setIsScanning(true);
      setIsAutoScanning(auto);
      // Reset the local-checkpoint throttle so this scan can checkpoint
      // promptly rather than inheriting a recent timestamp from a prior scan.
      lastLocalCheckpointAtRef.current = 0;
      setScanProgress({
        fromHeight,
        toHeight: resolvedTo,
        currentHeight: fromHeight,
        matchesFound: 0,
      });

      // Seed the optimistic doc from the current snapshot so we don't lose
      // existing UTXOs (or archive entries) while scanning a sparse range.
      optimisticRef.current = {
        version: SP_STORAGE_VERSION,
        scanHeight: storage.scanHeight,
        utxos: storage.utxos.slice(),
        spent: (storage.spent ?? []).slice(),
      };

      let matchesFound = 0;
      let highestContiguousScanned = fromHeight - 1;

      // A scan may only advance the persisted `scanHeight` cursor when its
      // range is contiguous with the already-scanned prefix — i.e. it starts
      // at or below the block after the effective cursor. Otherwise a
      // forward-jumping range (e.g. "Scan recent" on a wallet whose cursor is
      // far behind) would record the skipped gap as scanned, and payments
      // received in that gap would silently never be found: the auto-scanner
      // resumes from `scanHeight + 1` and trusts that everything below it was
      // covered. UTXOs discovered by a non-contiguous scan are still merged —
      // only the cursor is held back, so the auto-scanner later walks the gap.
      //
      // A never-scanned wallet (effective cursor 0) is exempt: its documented
      // bootstrap deliberately jumps to a recent window instead of walking
      // from genesis (see AUTO_SCAN_INITIAL_WINDOW_BLOCKS).
      const cursorAtStart = Math.max(
        storage.scanHeight,
        readLocalCheckpoint(pubkey, indexerUrl),
      );
      const mayAdvanceCursor = cursorAtStart === 0 || fromHeight <= cursorAtStart + 1;

      // ── ECDH scan worker ─────────────────────────────────────
      //
      // Offload the secp256k1 ECDH + per-output `Pₖ` derivation to a worker
      // so it doesn't compete with React renders / user input on the main
      // thread, and so it overlaps with the fetch pipeline below. `null`
      // means no worker could be constructed (e.g. environment without the
      // `Worker` global) — we fall back to scanning on the main thread.
      const scanWorker = createSpScanWorker(keys.bscan, keys.Bspend);

      // ── Sliding-window pipeline state ────────────────────────
      //
      // Declared outside the try block so the `finally` cleanup can drain
      // any still-pending fetches if we exit via cancel or error.
      const inflight = new Map<number, Promise<Awaited<ReturnType<typeof fetchBlockEntriesCached>>>>();
      let nextToSchedule = fromHeight;

      const scheduleUpTo = (limit: number) => {
        while (
          nextToSchedule <= resolvedTo &&
          inflight.size < limit &&
          !controller.signal.aborted
        ) {
          const h = nextToSchedule++;
          inflight.set(
            h,
            fetchBlockEntriesCached(indexerUrl, h, controller.signal, includeSpent),
          );
        }
      };

      try {
        // ── Sliding-window pipeline ─────────────────────────────
        //
        // The indexer exposes only per-block endpoints, so a long scan is
        // dominated by HTTP latency rather than ECDH compute. We keep up
        // to `scanConcurrency` `fetchBlockEntriesCached` calls in flight at
        // once, but PROCESS the results strictly in height order — this
        // keeps `optimisticRef`, `matchesFound`, scan-progress, and the
        // contiguous `scanHeight` advancement single-writer and monotonic.
        // Already-fetched blocks are served from the IndexedDB cache, so a
        // repeat scan over an overlapping range costs zero round-trips.

        // Prime the pipeline.
        scheduleUpTo(scanConcurrency);

        for (let h = fromHeight; h <= resolvedTo; h++) {
          if (controller.signal.aborted) break;

          const pending = inflight.get(h);
          if (!pending) {
            // Shouldn't happen — scheduleUpTo always fills slot h before
            // we reach it — but guard anyway.
            throw new Error(`scan pipeline missing height ${h}`);
          }
          inflight.delete(h);

          let entries: Awaited<ReturnType<typeof fetchBlockEntriesCached>>;
          try {
            entries = await pending;
          } catch (err) {
            // First in-order fetch failure aborts the rest of the scan
            // (matches the previous sequential behaviour). The `finally`
            // block below drains any still-pending fetches so their
            // rejections don't surface as unhandled.
            controller.abort();
            throw err;
          }

          // A slot has freed — keep the window topped up before we spend
          // time on ECDH for this block.
          scheduleUpTo(scanConcurrency);

          let blockMatches: SPMatchedUtxo[] = [];
          if (entries.length > 0) {
            // Run the ECDH in the worker when available; the worker client
            // transparently falls back to a main-thread scan on any failure.
            blockMatches = scanWorker
              ? await scanWorker.scanEntries(entries)
              : await scanBatch(entries, keys.bscan, keys.Bspend, {
                  signal: controller.signal,
                });
          }

          // Merge matches into the optimistic doc.
          if (blockMatches.length > 0) {
            // Fetch the real block timestamp from Blockbook so we can stamp
            // every fresh UTXO with `time`. The HD wallet's UI falls back to
            // a synthetic `block-height × 600s` estimate when this is
            // missing, but that estimate drifts noticeably (often days) on
            // recent blocks because real average block time is shorter than
            // 600s, leading to "X days ago" labels that flip into the
            // future. A single Blockbook lookup per matched block is cheap
            // and fixes it.
            let blockTime: number | undefined;
            if (blockbookUrl) {
              try {
                blockTime = await fetchBlockTime(blockbookUrl, h, controller.signal);
              } catch (err) {
                // Best-effort: don't fail the whole scan because Blockbook
                // is unreachable. The synthetic fallback still renders.
                console.warn(`Failed to fetch block time for height ${h}:`, err);
              }
            }

            // Partition matches into "still unspent" (active set) and
            // "already spent at scan time" (archive). The archive entries
            // are essential for the tx-history classifier to attribute the
            // spending tx as a wallet send — without them a deep rescan is
            // useless for history recovery.
            const freshActive: SPStoredUtxo[] = [];
            const freshArchive: SPStoredUtxo[] = [];
            for (const m of blockMatches) {
              const stored = matchedUtxoToStored(m);
              const stamped =
                blockTime !== undefined ? { ...stored, time: blockTime } : stored;
              if (m.spent) freshArchive.push(stamped);
              else freshActive.push(stamped);
            }

            const opt = optimisticRef.current!;
            // Tombstone check: never resurrect an outpoint that is already
            // in the spent archive. The archive is the wallet's durable
            // record of "this was spent" — the indexer (and especially the
            // immutable-by-design IndexedDB block cache) can keep reporting
            // `spent: false` long after our own send consumed the UTXO,
            // and without this filter a rescan of the receive block would
            // re-add the spent UTXO to the active set, to be re-picked by
            // the coin selector and rejected as a mempool conflict.
            const archivedKeys = new Set(
              [...(opt.spent ?? []), ...freshArchive].map(
                (u) => `${u.txid}:${u.vout}`,
              ),
            );
            optimisticRef.current = {
              version: SP_STORAGE_VERSION,
              scanHeight: opt.scanHeight,
              utxos: mergeUtxos(opt.utxos, freshActive).filter(
                (u) => !archivedKeys.has(`${u.txid}:${u.vout}`),
              ),
              spent: mergeUtxos(opt.spent ?? [], freshArchive),
            };
            matchesFound += blockMatches.length;
            // New matches landed — arm the throttle so they reach relays
            // within `REPUBLISH_THROTTLE_MS` even if the user closes the
            // tab before the scan finishes.
            republishDirtyRef.current = true;
          }

          // Forward the scan cursor as long as we advance contiguously from
          // the start of this range — and only when the range itself is
          // contiguous with the previously persisted cursor (see
          // `mayAdvanceCursor` above).
          if (mayAdvanceCursor && h === highestContiguousScanned + 1) {
            highestContiguousScanned = h;
            const opt = optimisticRef.current!;
            optimisticRef.current = {
              ...opt,
              scanHeight: Math.max(opt.scanHeight, highestContiguousScanned),
            };

            // Throttled *local* checkpoint of the advancing scanHeight. This
            // is free (synchronous localStorage, no signer/relay) so it runs
            // independently of the match-gated relay republish below — a
            // mid-scan refresh resumes from here, re-scanning at most the
            // blocks covered in the last `LOCAL_CHECKPOINT_THROTTLE_MS`.
            const now = Date.now();
            if (now - lastLocalCheckpointAtRef.current >= LOCAL_CHECKPOINT_THROTTLE_MS) {
              lastLocalCheckpointAtRef.current = now;
              writeLocalCheckpoint(pubkey, indexerUrl, highestContiguousScanned);
            }
          }

          setScanProgress({
            fromHeight,
            toHeight: resolvedTo,
            currentHeight: h,
            matchesFound,
          });
          // Bump the optimistic-version state so `storage` recomputes.
          setOptimisticVersion((v) => v + 1);

          // Throttled relay republish — fires at most once per
          // `REPUBLISH_THROTTLE_MS`, and only when new matches have landed
          // since the last publish. Guarantees the user loses at most one
          // throttle window of progress if they close the tab mid-scan,
          // without flooding their signer on empty-block walks.
          scheduleRepublish();
        }
      } catch (err) {
        if (controller.signal.aborted) {
          // Caller asked to cancel — not an error to surface.
        } else {
          setScanError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        // Tear down the ECDH worker (if any) — rejects any stragglers and
        // frees the thread. A fresh worker is created per scan.
        scanWorker?.terminate();
        // Drain any still-pending fetches — they'll reject (because we
        // aborted the controller in the error path, or because the user
        // called cancelScan) and we don't want unhandled rejection noise.
        if (inflight.size > 0) {
          // Ensure the controller is aborted so the fetches actually
          // settle quickly rather than racing to completion.
          if (!controller.signal.aborted) controller.abort();
          for (const p of inflight.values()) {
            p.catch(() => {});
          }
          inflight.clear();
        }
        setIsScanning(false);
        setIsAutoScanning(false);
        // Final local checkpoint — capture the last blocks scanned since the
        // throttled write above, so even a clean finish leaves an accurate
        // local resume cursor without waiting on the relay round-trip.
        if (optimisticRef.current) {
          writeLocalCheckpoint(pubkey, indexerUrl, optimisticRef.current.scanHeight);
        }
        // Final flush — make sure the last scan progress reaches relays.
        flushRepublish();
        if (scanAbortRef.current === controller) {
          scanAbortRef.current = null;
        }
      }
    },
    [enabled, keys, storage, tipHeight, indexerUrl, blockbookUrl, pubkey, scanConcurrency, scheduleRepublish, flushRepublish],
  );

  // Public scan API — always a user-initiated (non-auto) scan.
  const scanRange = useCallback<UseHdWalletSpResult['scanRange']>(
    (args) => runScan({ ...args, auto: false }),
    [runScan],
  );

  const scanRecent = useCallback<UseHdWalletSpResult['scanRecent']>(async () => {
    if (!enabled) return;
    const tip = tipHeight ?? (await fetchTipHeight(indexerUrl));
    const from = Math.max(0, tip - DEFAULT_RECENT_SCAN_BLOCKS + 1);
    await scanRange({ fromHeight: from, toHeight: tip });
  }, [enabled, indexerUrl, tipHeight, scanRange]);

  const balance = useMemo(() => (storage ? spStorageBalance(storage) : 0), [storage]);

  // Keep a stable ref to the latest storage so callbacks called from outside
  // the React render cycle (e.g. the send dialog's mutation success handler)
  // see the freshest UTXO set without forcing the callback to re-create.
  const storageRef = useRef<SPStorageDocument | undefined>(storage);
  storageRef.current = storage;

  // ── Automatic background scanning ────────────────────────────
  //
  // The whole point of the provider lifting: scanning should "just happen"
  // without the user opening a dialog and pressing a button. We resume from
  // the last persisted `scanHeight` (so we never re-scan blocks we've
  // already covered) and walk forward to the current tip. As the tip query
  // refreshes (every 60s) and advances, this effect re-fires and scans only
  // the newly mined blocks.
  //
  // For a *never-scanned* wallet (`scanHeight === 0`) we deliberately do NOT
  // walk the entire chain from genesis — that's hundreds of thousands of
  // per-block round trips. We bound the initial automatic pass to the last
  // `AUTO_SCAN_INITIAL_WINDOW_BLOCKS` blocks; a user who expects older
  // payments can run a deeper manual scan from the dialog (which sets
  // `scanHeight` and lets subsequent auto-scans resume contiguously).
  //
  // Persisted per-device so a user can opt out (e.g. on a metered/low-power
  // device) without affecting their other devices.
  const [autoScanEnabled, setAutoScanEnabledRaw] = useLocalStorage<boolean>(
    AUTO_SCAN_PREF_KEY,
    true,
  );
  const setAutoScanEnabled = useCallback(
    (next: boolean) => setAutoScanEnabledRaw(next),
    [setAutoScanEnabledRaw],
  );

  // Highest tip we've already auto-scanned up to (or kicked off a scan for),
  // so a tip refresh that doesn't actually advance the chain doesn't restart
  // a scan, and a manual scan in between doesn't get clobbered by a redundant
  // auto pass. Reset when the wallet identity changes.
  const autoScannedToRef = useRef(0);
  useEffect(() => {
    autoScannedToRef.current = 0;
  }, [pubkey, indexerUrl]);

  useEffect(() => {
    if (!enabled) return;
    if (!autoScanEnabled) return;
    if (!storage) return; // Wait for the first storage load.
    if (tipHeight === undefined) return; // Need a known tip to bound the scan.
    if (isScanning) return; // Never interrupt an in-flight scan (manual or auto).

    // Resume from the block after the last fully-scanned one. The effective
    // scan cursor is the furthest of the relay-persisted `scanHeight` and the
    // local checkpoint — the local copy is usually ahead after a mid-scan
    // refresh (it's written every few seconds, whereas the relay copy is only
    // published on matches and end-of-scan). For a never-scanned wallet
    // (cursor 0), bound the very first automatic pass to a recent window
    // rather than walking from genesis.
    const localCheckpoint = readLocalCheckpoint(pubkey, indexerUrl);
    const effectiveScanHeight = Math.max(storage.scanHeight, localCheckpoint);
    const resumeFrom =
      effectiveScanHeight > 0
        ? effectiveScanHeight + 1
        : Math.max(0, tipHeight - AUTO_SCAN_INITIAL_WINDOW_BLOCKS + 1);

    // Nothing new to scan — we're already caught up to the tip.
    if (resumeFrom > tipHeight) return;

    // Don't re-trigger for a tip we've already launched a scan for. This
    // guards against the effect re-running (e.g. a benign `storage` identity
    // change) and spawning duplicate scans for the same range.
    if (tipHeight <= autoScannedToRef.current) return;
    autoScannedToRef.current = tipHeight;

    void runScan({ fromHeight: resumeFrom, toHeight: tipHeight, auto: true }).catch((err) => {
      // Surfaced via `scanError`; also reset the guard so a later tip
      // refresh retries from the same point rather than silently giving up.
      console.warn('Automatic SP scan failed:', err);
      autoScannedToRef.current = 0;
    });
  }, [enabled, autoScanEnabled, storage, tipHeight, isScanning, runScan, pubkey, indexerUrl]);

  // ── Prune spent SP UTXOs after a successful broadcast ────────
  //
  // The send flow consumes one or more SP UTXOs but Blockbook's xpub scan
  // can't observe them — they sit in the NIP-78 doc forever unless we
  // remove them explicitly. Without this, `balance` would keep counting
  // the spent UTXOs and the coin selector would offer them again on the
  // next send (producing a "missing/spent input" broadcast failure), all
  // while Blockbook's view of the BIP-86 change credits to total balance,
  // so the wallet appears to *gain* money after a spend.
  const pruneSpentUtxos = useCallback<UseHdWalletSpResult['pruneSpentUtxos']>(
    (spent, change) => {
      if (!spent.length && !change?.length) return;
      // Cancel any pending throttled republish — its document snapshot
      // doesn't know about the prune. We're about to publish a strictly
      // newer doc below, so the throttle's pending payload would be stale.
      if (republishTimerRef.current) {
        clearTimeout(republishTimerRef.current);
        republishTimerRef.current = null;
      }
      republishDirtyRef.current = false;
      const base = storageRef.current ?? optimisticRef.current;
      if (!base) return;
      // Archive (don't delete) the pruned entries so the transaction-history
      // UI can still show their original receive row, and the send-vs-
      // receive classifier in `buildHdTransactions` can attribute any
      // future Blockbook tx that referenced one of these outpoints as a
      // wallet send.
      let next: SPStorageDocument = archiveSpentUtxos(base, spent);
      // Insert the broadcast's own SP change output as a spendable UTXO in
      // the same update — the BIP-352 scanner can't see it until the tx
      // confirms and its block is scanned, but the send flow derived it
      // locally and knows the value and tweak with certainty.
      if (change && change.length > 0) {
        next = { ...next, utxos: mergeUtxos(next.utxos, change) };
      }
      optimisticRef.current = next;
      setOptimisticVersion((v) => v + 1);
      // Also write the pruned doc directly into the doc-query cache so
      // the `storage` memo doesn't briefly fall back to the unpruned
      // relay copy while the publish round-trip is in flight (the
      // optimistic-preference heuristic uses `utxos.length` to decide
      // freshness, and a prune *shrinks* the list).
      const eventId = queryClient.getQueryData<{ id?: string } | null>([
        'hdwallet-sp-event',
        pubkey,
        dTag,
      ])?.id;
      if (eventId) {
        queryClient.setQueryData(['hdwallet-sp-doc', pubkey, eventId], next);
      }
      publishStorage.mutate({ next, spent, owner: pubkey });
    },
    [publishStorage, queryClient, pubkey, dTag],
  );

  // ── Correct stored SP UTXO values against the chain ──────────
  //
  // The scanner records each UTXO's value from the BIP-352 indexer and the
  // send flow signs against it (the BIP-341 sighash commits to prevout
  // amounts). When the pre-broadcast verification detects a stored value
  // that disagrees with Blockbook's view of the chain, this callback fixes
  // the document so the next build succeeds.
  const correctUtxoValues = useCallback<UseHdWalletSpResult['correctUtxoValues']>(
    (corrections) => {
      if (!corrections.length) return;
      const base = storageRef.current ?? optimisticRef.current;
      if (!base) return;
      const byKey = new Map(
        corrections.map((c) => [`${c.txid}:${c.vout}`, c.value]),
      );
      let changed = false;
      const utxos = base.utxos.map((u) => {
        const value = byKey.get(`${u.txid}:${u.vout}`);
        if (value === undefined || value === u.value) return u;
        changed = true;
        return { ...u, value };
      });
      if (!changed) return;
      const next: SPStorageDocument = { ...base, utxos };
      optimisticRef.current = next;
      setOptimisticVersion((v) => v + 1);
      const eventId = queryClient.getQueryData<{ id?: string } | null>([
        'hdwallet-sp-event',
        pubkey,
        dTag,
      ])?.id;
      if (eventId) {
        queryClient.setQueryData(['hdwallet-sp-doc', pubkey, eventId], next);
      }
      // `mergeUtxos` in the publish merge is fresh-preferring for same-key
      // entries, so the corrected values win over any stale relay copy.
      publishStorage.mutate({ next, owner: pubkey });
    },
    [publishStorage, queryClient, pubkey, dTag],
  );

  // ── Manual reconcile of spent SP UTXOs against Blockbook ─────
  //
  // The send flow's prune (above) only catches UTXOs the *current* session
  // spends. Anything spent before this code shipped — or spent on another
  // device — sits in the encrypted NIP-78 doc forever, inflating the
  // displayed balance and offering already-spent inputs to the next send.
  //
  // This action lets the user manually walk the stored set, ask Blockbook
  // for each output's spent status, and drop the spent ones. Manual rather
  // than on-load because we don't want to fire ≤50 WS calls on every wallet
  // page mount; the scan dialog already exists as a "fix-up" UI surface.
  const [isReconciling, setIsReconciling] = useState(false);
  const [reconcileProgress, setReconcileProgress] = useState<
    UseHdWalletSpResult['reconcileProgress']
  >();
  const [reconcileError, setReconcileError] = useState<Error | undefined>();
  const reconcileAbortRef = useRef<AbortController | null>(null);

  const reconcileSpentUtxos = useCallback<
    UseHdWalletSpResult['reconcileSpentUtxos']
  >(async () => {
    if (!enabled || !blockbookUrl) return 0;
    const current = storageRef.current;
    if (!current || current.utxos.length === 0) return 0;

    // Cap fan-out to MAX_RECONCILE_UTXOS distinct txids. We iterate the
    // stored UTXO list (insertion order) and keep candidates until we hit
    // the cap; remaining UTXOs are reconciled on the next click.
    const distinctTxids = new Set<string>();
    const candidates: Array<{ txid: string; vout: number }> = [];
    for (const u of current.utxos) {
      if (!distinctTxids.has(u.txid) && distinctTxids.size >= MAX_RECONCILE_UTXOS) {
        continue;
      }
      distinctTxids.add(u.txid);
      candidates.push({ txid: u.txid, vout: u.vout });
    }
    if (candidates.length === 0) return 0;

    // Abort any prior in-flight reconcile (e.g. user double-clicked).
    reconcileAbortRef.current?.abort();
    const controller = new AbortController();
    reconcileAbortRef.current = controller;

    setReconcileError(undefined);
    setIsReconciling(true);
    setReconcileProgress({ total: candidates.length, checked: 0, prunedSoFar: 0 });

    try {
      const spentMap = await fetchUtxoSpentStatus(
        blockbookUrl,
        candidates,
        controller.signal,
      );
      if (controller.signal.aborted) return 0;

      const spent: SpentOutpoint[] = [];
      for (const c of candidates) {
        const status = spentMap.get(`${c.txid}:${c.vout}`);
        if (status?.spent === true) {
          spent.push({
            ...c,
            ...(status.spentTxid !== undefined ? { spentTxid: status.spentTxid } : {}),
            ...(status.spentHeight !== undefined ? { spentHeight: status.spentHeight } : {}),
          });
        }
      }
      setReconcileProgress({
        total: candidates.length,
        checked: candidates.length,
        prunedSoFar: spent.length,
      });

      if (spent.length > 0) {
        pruneSpentUtxos(spent);
      }
      return spent.length;
    } catch (err) {
      if (controller.signal.aborted) return 0;
      const e = err instanceof Error ? err : new Error(String(err));
      setReconcileError(e);
      throw e;
    } finally {
      setIsReconciling(false);
      if (reconcileAbortRef.current === controller) {
        reconcileAbortRef.current = null;
      }
    }
  }, [enabled, blockbookUrl, pruneSpentUtxos]);

  // ── Backfill missing block timestamps ────────────────────────
  //
  // Older docs (written before SP UTXOs carried `time`) and any UTXOs that
  // were stamped while Blockbook was unreachable arrive here without a
  // timestamp, so the UI is forced to use the synthetic
  // `block-height × 600s` estimate. That estimate drifts ~12 days into the
  // future at current heights and renders as e.g. "-11d ago".
  //
  // Fix it once per session: on the first storage load that contains any
  // un-stamped UTXOs, fetch their block timestamps from Blockbook,
  // de-duplicated by height, and re-publish the document.
  //
  // Bounded to avoid hammering Blockbook on a wallet with hundreds of
  // historical UTXOs — remaining entries get backfilled on subsequent
  // sessions.
  // Latched to the wallet identity that ran (not a boolean): the provider
  // survives account switches, so a boolean latched under one account would
  // suppress the backfill for every account that follows.
  const backfillRanRef = useRef<string | null>(null);
  // Abort the in-flight backfill only on unmount — NOT via an effect
  // cleanup. The effect below re-runs on every `storage` identity change
  // (auto-scan republishes bump it within seconds of page load), and a
  // cleanup-scoped abort would kill the multi-round-trip backfill mid
  // flight on the first re-run, every session.
  const backfillAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => backfillAbortRef.current?.abort(), []);
  useEffect(() => {
    if (!enabled) return;
    if (!blockbookUrl) return;
    if (!storage) return;
    if (backfillRanRef.current === walletId) return;
    if (isScanning) return; // Don't race with an in-flight scan.

    const missing = storage.utxos.filter((u) => u.time === undefined);
    if (missing.length === 0) {
      // Nothing to do for THIS storage identity — but don't latch the
      // ran-once ref. `storageDocQuery` resolves to EMPTY_SP_STORAGE while
      // the relay event is still loading, so the first identity of every
      // session is an empty placeholder; latching here would poison the
      // backfill for the whole session before the real document arrives.
      return;
    }

    backfillRanRef.current = walletId;
    const controller = new AbortController();
    backfillAbortRef.current = controller;
    const MAX_HEIGHTS = 50;

    (async () => {
      const heights = Array.from(new Set(missing.map((u) => u.height))).slice(0, MAX_HEIGHTS);
      const heightTimes = new Map<number, number>();
      for (const h of heights) {
        if (controller.signal.aborted) return;
        try {
          const t = await fetchBlockTime(blockbookUrl, h, controller.signal);
          heightTimes.set(h, t);
        } catch (err) {
          // Skip this height; it will retry on a future session.
          console.warn(`Failed to backfill block time for height ${h}:`, err);
        }
      }
      if (heightTimes.size === 0) return;
      if (controller.signal.aborted) return;

      // Rebase on the freshest local state, not the `storage` closure this
      // effect captured: the async chain deliberately outlives storage
      // republishes (see `backfillAbortRef`), so by now the auto-scan or the
      // spender backfill may have advanced scanHeight, found UTXOs, or
      // stamped the archive — all of which a stale-snapshot write would
      // clobber.
      const base = optimisticRef.current ?? storage;
      const next: SPStorageDocument = {
        version: SP_STORAGE_VERSION,
        scanHeight: base.scanHeight,
        utxos: base.utxos.map((u) => {
          if (u.time !== undefined) return u;
          const t = heightTimes.get(u.height);
          return t !== undefined ? { ...u, time: t } : u;
        }),
        // Preserve the archive — dropping it here would erase the spent
        // tombstones (resurrecting spent UTXOs on the next merge) and the
        // receive history for already-spent outputs.
        spent: (base.spent ?? []).slice(),
      };

      // Mirror the scan-loop pattern: update the optimistic copy and
      // republish so other devices pick up the backfilled timestamps.
      optimisticRef.current = next;
      setOptimisticVersion((v) => v + 1);
      publishStorage.mutate({ next, owner: pubkey });
    })();

    // No cleanup: the async chain is aborted on unmount via
    // `backfillAbortRef` and otherwise must be allowed to outlive the
    // storage identity changes that re-run this effect.
    // We deliberately depend only on `storage`, the wallet identity, and the
    // static URLs — running once per fresh load is the goal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, blockbookUrl, storage, walletId]);

  // ── Backfill spender info on the spent archive ───────────────
  //
  // Archives written before `spentTxid` existed (and reconcile passes run
  // against Blockbook versions that omit `spentTxId`) hold spent UTXOs with
  // no record of what spent them. Without the spender, the private tab's
  // history can only show those UTXOs as receives — cumulative inflows with
  // no offsetting "Sent" rows, which users read as missing funds when
  // compared against the (correct) unspent balance.
  //
  // Same shape as the timestamp backfill above: once per session, bounded
  // fan-out, remaining entries picked up on later sessions. Each stamped
  // spend also gets a real block time for its history row when the spending
  // tx's height is known.
  // Identity-latched for the same reason as `backfillRanRef` above.
  const spentStampRanRef = useRef<string | null>(null);
  // Unmount-only abort, for the same reason as `backfillAbortRef` above.
  const spentStampAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => spentStampAbortRef.current?.abort(), []);

  // Once-per-session ownership-audit latch + abort — the effect itself
  // lives below, after the spender backfill.
  const ownershipAuditRanRef = useRef<string | null>(null);
  const ownershipAuditAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => ownershipAuditAbortRef.current?.abort(), []);

  // ── Kill in-flight work on account switch ────────────────────
  //
  // Async chains started under the previous wallet identity (scan,
  // reconcile, both backfills, the throttled republish) must never write
  // into — or publish under — the account that follows. The owner check in
  // `publishStorage` is the backstop; this cuts the chains themselves.
  // Layout effect so it runs synchronously in the commit that switched
  // identities, before any pending promise continuation can resume.
  const inflightOwnerRef = useRef(walletId);
  useLayoutEffect(() => {
    if (inflightOwnerRef.current === walletId) return;
    inflightOwnerRef.current = walletId;
    scanAbortRef.current?.abort();
    reconcileAbortRef.current?.abort();
    backfillAbortRef.current?.abort();
    spentStampAbortRef.current?.abort();
    ownershipAuditAbortRef.current?.abort();
    if (republishTimerRef.current) {
      clearTimeout(republishTimerRef.current);
      republishTimerRef.current = null;
    }
    republishDirtyRef.current = false;
  }, [walletId]);
  useEffect(() => {
    if (!enabled) return;
    if (!blockbookUrl) return;
    if (!storage) return;
    if (spentStampRanRef.current === walletId) return;
    if (isScanning) return; // Don't race with an in-flight scan.

    const missing = (storage.spent ?? []).filter((u) => u.spentTxid === undefined);
    if (missing.length === 0) {
      // Don't latch the ran-once ref — see the timestamp backfill above.
      // The session's first storage identity is an empty placeholder doc,
      // and latching on it would skip the backfill for the whole session.
      return;
    }

    spentStampRanRef.current = walletId;
    const controller = new AbortController();
    spentStampAbortRef.current = controller;
    const MAX_OUTPOINTS = 25;

    (async () => {
      const candidates = missing.slice(0, MAX_OUTPOINTS);
      const spentMap = await fetchUtxoSpentStatus(
        blockbookUrl,
        candidates,
        controller.signal,
      );
      if (controller.signal.aborted) return;

      const stamps: SpentOutpoint[] = [];
      for (const c of candidates) {
        const status = spentMap.get(`${c.txid}:${c.vout}`);
        if (status?.spent === true && status.spentTxid !== undefined) {
          stamps.push({
            txid: c.txid,
            vout: c.vout,
            spentTxid: status.spentTxid,
            ...(status.spentHeight !== undefined ? { spentHeight: status.spentHeight } : {}),
          });
        }
      }
      if (stamps.length === 0) return;

      // Resolve real block times for the spending heights so the history
      // rows don't fall back to the drifting synthetic estimate.
      const heights = Array.from(
        new Set(stamps.map((s) => s.spentHeight).filter((h): h is number => h !== undefined)),
      );
      const heightTimes = new Map<number, number>();
      for (const h of heights) {
        if (controller.signal.aborted) return;
        try {
          heightTimes.set(h, await fetchBlockTime(blockbookUrl, h, controller.signal));
        } catch (err) {
          // Skip; the row falls back to the synthetic height estimate.
          console.warn(`Failed to fetch block time for spend height ${h}:`, err);
        }
      }
      for (const s of stamps) {
        const t = s.spentHeight !== undefined ? heightTimes.get(s.spentHeight) : undefined;
        if (t !== undefined) s.spentTime = t;
      }
      if (controller.signal.aborted) return;

      const base = optimisticRef.current ?? storage;
      const next = stampSpentArchive(base, stamps);
      if (next === base) return;

      optimisticRef.current = next;
      setOptimisticVersion((v) => v + 1);
      publishStorage.mutate({ next, owner: pubkey });
    })().catch((err) => {
      console.warn('Failed to backfill SP spender info:', err);
    });

    // No cleanup — see `spentStampAbortRef`. An effect-cleanup abort would
    // cancel the backfill as soon as the auto-scan republishes storage.
    // Mirror the timestamp backfill: run once per fresh load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, blockbookUrl, storage, walletId]);

  // ── Ownership audit: expel foreign UTXOs on load ─────────────
  //
  // Before the account-switch scoping fix, the root-mounted provider could
  // leak one account's optimistic doc into another's storage, where the
  // insert-preferring publish merge made it permanent — relay docs exist
  // whose entries their own account cannot spend. Ownership is decidable
  // without trusting the doc: an entry is ours iff
  //
  //   on-chain script == OP_1 <xonly(Bspend + t·G)>
  //
  // Once per session, verify every stored entry against Blockbook and purge
  // the foreign ones from the active set and the archive. Entries whose
  // script can't be fetched are kept — "unknown" is not proof of foreign
  // ownership; the next session retries. Legitimate entries always pass:
  // the scanner only persists tweaks it derived by matching this same
  // equation during discovery.
  useEffect(() => {
    if (!enabled) return;
    if (!blockbookUrl) return;
    if (!storage) return;
    if (!keys) return;
    if (ownershipAuditRanRef.current === walletId) return;
    if (isScanning) return; // Don't race with an in-flight scan.

    const all = [...storage.utxos, ...(storage.spent ?? [])];
    if (all.length === 0) return; // Empty/placeholder doc — don't latch.

    ownershipAuditRanRef.current = walletId;
    const controller = new AbortController();
    ownershipAuditAbortRef.current = controller;
    const MAX_TXIDS = 25;

    (async () => {
      const byTxid = new Map<string, { vout: number; tweak: string }[]>();
      for (const u of all) {
        const list = byTxid.get(u.txid) ?? [];
        list.push({ vout: u.vout, tweak: u.tweak });
        byTxid.set(u.txid, list);
      }
      const foreign: { txid: string; vout: number }[] = [];
      let checked = 0;
      for (const [txid, entries] of byTxid) {
        if (checked >= MAX_TXIDS) break;
        if (controller.signal.aborted) return;
        checked += 1;
        let outputs;
        try {
          outputs = await fetchTxOutputs(blockbookUrl, txid, controller.signal);
        } catch {
          continue; // Unknown — keep and retry next session.
        }
        for (const e of entries) {
          const out = outputs.find((o) => o.n === e.vout);
          if (!out?.scriptHex) continue;
          const expected =
            '5120' + bytesToHex(derivePkFromStoredTweak(keys.Bspend, hexToBytes(e.tweak)));
          if (out.scriptHex !== expected) foreign.push({ txid, vout: e.vout });
        }
      }
      if (foreign.length === 0) return;
      if (controller.signal.aborted) return;

      const purgeSet = new Set(foreign.map((f) => `${f.txid}:${f.vout}`));
      const base = optimisticRef.current ?? storage;
      const next: SPStorageDocument = {
        version: SP_STORAGE_VERSION,
        scanHeight: base.scanHeight,
        utxos: base.utxos.filter((u) => !purgeSet.has(`${u.txid}:${u.vout}`)),
        spent: (base.spent ?? []).filter((u) => !purgeSet.has(`${u.txid}:${u.vout}`)),
      };
      console.warn(`SP ownership audit: purging ${foreign.length} foreign entries from wallet storage`);
      optimisticRef.current = next;
      setOptimisticVersion((v) => v + 1);
      // A purge SHRINKS the doc, which the optimistic-preference heuristic
      // reads as staleness — write the doc-query cache directly (like the
      // prune path does) so the purged copy isn't shadowed by the fatter
      // relay copy while the publish round-trip is in flight.
      const eventId = queryClient.getQueryData<{ id?: string } | null>([
        'hdwallet-sp-event',
        pubkey,
        dTag,
      ])?.id;
      if (eventId) {
        queryClient.setQueryData(['hdwallet-sp-doc', pubkey, eventId], next);
      }
      publishStorage.mutate({ next, purge: foreign, owner: pubkey });
    })().catch((err) => {
      console.warn('SP ownership audit failed:', err);
    });

    // Unmount-only abort via `ownershipAuditAbortRef`, like the backfills.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, blockbookUrl, storage, keys, walletId]);

  // ── Assemble the public shape ───────────────────────────────
  if (!enabled) {
    return { ...EMPTY_RESULT, unavailableReason, keys };
  }

  return {
    enabled,
    keys,
    storage,
    balance,
    isLoading: storageEventQuery.isLoading || storageDocQuery.isLoading,
    scanProgress,
    isScanning,
    isAutoScanning,
    scanError,
    autoScanEnabled,
    setAutoScanEnabled,
    tipHeight,
    scanRange,
    scanRecent,
    cancelScan,
    pruneSpentUtxos,
    correctUtxoValues,
    isReconciling,
    reconcileProgress,
    reconcileError,
    reconcileSpentUtxos,
  };
}
