import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAppContext } from '@/hooks/useAppContext';
import { useSecureLocalStorage } from '@/hooks/useSecureLocalStorage';
import { useHdWalletAccess, type HdWalletAvailability } from '@/hooks/useHdWalletAccess';
import { useHdWalletSp } from '@/hooks/useHdWalletSpContext';
import {
  deriveReceiveAddress,
  deriveSilentPaymentAddress,
  type DerivedAddress,
  type SilentPaymentAddress,
} from '@/lib/hdwallet/derivation';
import {
  type AccountScanResult,
  buildHdTransactions,
  type HdTransaction,
  scanAccount,
} from '@/lib/hdwallet/scan';
import { filterRecentlySpent } from '@/lib/hdwallet/spentOutpoints';
import type { SpentOutpoint, SPStorageDocument, SPStoredUtxo } from '@/lib/hdwallet/sp/storage';

// ---------------------------------------------------------------------------
// Persisted UI cursor (per user)
// ---------------------------------------------------------------------------
//
// We persist a single integer per user: the "preferred receive index" — the
// index of the address we are currently advertising on the wallet page.
// The chain-scan source of truth is `firstUnusedIndex` (from Blockbook), but
// if the user explicitly bumps to a fresh address we honour that until the
// chain catches up.
//
// The key is namespaced `:v2:` because v2 addresses do not match v1
// addresses for the same nsec (different BIP-32 seed). Mixing the two would
// advertise an address the chain scan doesn't recognise. v1 cursors (the
// old `hdwallet:cursor:<pubkey>` key) are intentionally left in place but
// never read — they're harmless leftover localStorage.

const CURSOR_KEY = (pubkey: string) => `hdwallet:cursor:v2:${pubkey}`;

interface PersistedCursor {
  /** Currently-displayed receive index. */
  receiveIndex: number;
}

const DEFAULT_CURSOR: PersistedCursor = { receiveIndex: 0 };

// ---------------------------------------------------------------------------
// Query refresh cadence
// ---------------------------------------------------------------------------

/**
 * Re-scan every 60 seconds. With Blockbook, a refresh is exactly 2 HTTP
 * calls (`/xpub` + `/utxo`) regardless of wallet size, so a faster refresh
 * is cheap. We pick 60s as a UX compromise between immediacy and politeness
 * to the public Blockbook host.
 */
const REFRESH_INTERVAL_MS = 60_000;

// ---------------------------------------------------------------------------
// Return shape
// ---------------------------------------------------------------------------

interface UseHdWalletResult {
  /** Availability status — mirrors `useHdWalletAccess`. */
  availability: HdWalletAvailability;
  /** Currently-advertised receive address (the one the UI shows). */
  currentReceiveAddress?: DerivedAddress;
  /**
   * BIP-352 silent payment address (`sp1q…`) for this wallet. Static — a
   * single identifier the user can publish and reuse forever. Undefined
   * unless `availability.status === 'available'`.
   */
  silentPaymentAddress?: SilentPaymentAddress;
  /** Full scan result — UTXOs, used addresses, etc. */
  scan?: AccountScanResult;
  /** Aggregated wallet-level transaction history (newest first). */
  transactions?: HdTransaction[];
  /** Confirmed + pending balance in sats. */
  totalBalance: number;
  /** Pending (mempool) balance in sats. */
  pendingBalance: number;
  /**
   * Confirmed balance of silent-payment UTXOs only, in sats. Already included
   * in `totalBalance` — this field is exposed for the UI breakdown.
   */
  silentPaymentBalance: number;
  /**
   * Public-wallet balance: BIP-86 on-chain UTXOs only (confirmed + pending),
   * in sats. This is the headline figure for the "Public" wallet tab.
   */
  publicBalance: number;
  /**
   * Private-wallet balance: silent-payment UTXOs only, in sats. Alias of
   * `silentPaymentBalance`, named for the "Private" wallet tab.
   */
  privateBalance: number;
  /**
   * Transaction history scoped to the public (BIP-86) wallet only — every
   * row whose `source` is not `'silent-payment'`.
   */
  publicTransactions?: HdTransaction[];
  /**
   * Transaction history scoped to the private (silent-payment) wallet only.
   */
  privateTransactions?: HdTransaction[];
  /**
   * Every on-chain address this wallet controls on the public (BIP-86)
   * hierarchy — used + lookahead + the currently-advertised receive address.
   * The private-wallet send flow checks recipients against this set so it can
   * warn when a user is about to send a silent payment to their own public
   * wallet (which would defeat the separation).
   */
  ownPublicAddresses: Set<string>;
  /** The persisted SP UTXO document, if loaded. */
  silentPaymentStorage?: SPStorageDocument;
  /** Initial scan in progress. */
  isLoading: boolean;
  /** Scan currently fetching (initial or background refresh). */
  isFetching: boolean;
  /** Scan error, if any. */
  error: unknown;
  /** Trigger a manual scan refresh. */
  refetch: () => Promise<unknown>;
  /** Advance the receive cursor to the next unused address. Persisted. */
  nextReceiveAddress: () => DerivedAddress | undefined;
  /**
   * Drop the given SP UTXOs from local storage and republish so other
   * devices stay in sync. Call after a successful spend that consumed
   * silent-payment UTXOs — see `useHdWalletSp.pruneSpentUtxos`. Entries
   * may carry spend stamps (`spentTxid` et al.) for the history UI, and
   * `change` inserts the broadcast's own SP change output as a spendable
   * UTXO in the same update.
   */
  pruneSpentSilentPaymentUtxos: (
    spent: ReadonlyArray<SpentOutpoint>,
    change?: ReadonlyArray<SPStoredUtxo>,
  ) => void;
  /**
   * Overwrite the stored value of the given silent-payment UTXOs with the
   * authoritative on-chain values — see `useHdWalletSp.correctUtxoValues`.
   */
  correctSilentPaymentUtxoValues: (
    corrections: ReadonlyArray<{ txid: string; vout: number; value: number }>,
  ) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Top-level HD wallet hook backed by Trezor's Blockbook indexer.
 *
 * The entire scan (balance, used addresses, tx history, UTXOs) comes from
 * two HTTP calls to the configured Blockbook server:
 *
 *   - `GET /api/v2/xpub/<tr(xpub)>?details=txs&tokens=used`
 *   - `GET /api/v2/utxo/<tr(xpub)>`
 *
 * No fallback to other indexers, no client-side gap-limit walking. If
 * Blockbook is unreachable the wallet surfaces the error.
 *
 * The hook is safe to call regardless of login state — non-nsec logins
 * return `availability.status !== 'available'` without doing any derivation
 * or network work.
 */
export function useHdWallet(): UseHdWalletResult {
  const { config } = useAppContext();
  const { blockbookBaseUrl } = config;
  const availability = useHdWalletAccess();
  const queryClient = useQueryClient();
  const sp = useHdWalletSp();

  const pubkey = availability.status === 'available' ? availability.pubkey : '';
  const account = availability.status === 'available' ? availability.account : undefined;
  const seed = availability.status === 'available' ? availability.seed : undefined;

  // ── Persisted receive cursor ─────────────────────────────────
  const [cursor, setCursor] = useSecureLocalStorage<PersistedCursor>(
    pubkey ? CURSOR_KEY(pubkey) : 'hdwallet:cursor:v2:none',
    DEFAULT_CURSOR,
  );

  // ── Scan query ───────────────────────────────────────────────
  const scanKey = ['hdwallet-scan', blockbookBaseUrl, pubkey];
  const {
    data: scan,
    isLoading: scanLoading,
    isFetching: scanFetching,
    error: scanError,
    refetch: refetchScan,
  } = useQuery<AccountScanResult>({
    queryKey: scanKey,
    queryFn: async ({ signal }) => {
      if (!account || !pubkey) throw new Error('HD wallet account unavailable');
      const result = await scanAccount(account, blockbookBaseUrl, signal);
      // Suppress UTXOs the wallet itself just spent but Blockbook hasn't
      // indexed as spent yet — otherwise the coin selector re-picks them
      // and the next broadcast is rejected as a mempool conflict.
      return filterRecentlySpent(pubkey, result);
    },
    enabled: !!account && pubkey !== '',
    refetchInterval: REFRESH_INTERVAL_MS,
    staleTime: REFRESH_INTERVAL_MS / 2,
    refetchOnWindowFocus: false,
  });

  // ── Transaction history (derived; zero extra fetches) ────────
  //
  // Combines BIP-86 transactions (scanned from Blockbook) with silent-payment
  // receives (discovered by the BIP-352 scanner). SP UTXOs carry a real
  // block timestamp when one is available (sourced from Blockbook by the
  // SP orchestrator at scan time, or backfilled on subsequent loads). When
  // a UTXO is missing `time` — older docs written before this field
  // existed, or scans that ran while Blockbook was unreachable — we fall
  // back to a synthetic estimate from height using a fixed anchor
  // (block 800,000 ≈ 2023-07-23T00:00:00Z, average 10-minute spacing).
  // The synthetic estimate is clamped to "now" so it never reports a future
  // timestamp (real average block time is shorter than 600s, so the naive
  // estimate drifts noticeably ahead of wall-clock as cumulative blocks
  // accumulate).
  const transactions = useMemo<HdTransaction[] | undefined>(() => {
    if (!scan && !sp.storage) return undefined;

    // Build the SP outpoint → value map (active + archived) so the BIP-86
    // tx classifier can detect transactions that spent our SP UTXOs and
    // mark them as sends instead of mis-attributing the BIP-86 change
    // output as an unsolicited receive.
    const spOutpoints = new Map<string, number>();
    const archivedSpUtxos = sp.storage?.spent ?? [];
    for (const u of sp.storage?.utxos ?? []) {
      spOutpoints.set(`${u.txid}:${u.vout}`, u.value);
    }
    for (const u of archivedSpUtxos) {
      // Don't clobber a value already recorded from the active set (in the
      // unlikely event of overlap).
      if (!spOutpoints.has(`${u.txid}:${u.vout}`)) {
        spOutpoints.set(`${u.txid}:${u.vout}`, u.value);
      }
    }

    const bip86 = scan ? buildHdTransactions(scan, spOutpoints) : [];

    // Group SP UTXOs by txid and sum to keep the row shape consistent with
    // the rest of the wallet (one row per tx, not per output). Include
    // archived (spent) UTXOs so the receive history doesn't disappear when
    // a UTXO is later spent — the original receive is still real wallet
    // activity worth showing.
    const spByTxid = new Map<
      string,
      { amount: number; height: number; time?: number }
    >();
    const allSpUtxos = [...(sp.storage?.utxos ?? []), ...archivedSpUtxos];
    for (const u of allSpUtxos) {
      const existing = spByTxid.get(u.txid);
      if (existing) {
        existing.amount += u.value;
        // Same tx → same block; prefer any concrete time we find.
        if (existing.time === undefined && u.time !== undefined) {
          existing.time = u.time;
        }
      } else {
        spByTxid.set(u.txid, { amount: u.value, height: u.height, time: u.time });
      }
    }

    // Group archived SP UTXOs by the tx that spent them. These become the
    // private tab's "Sent" rows — without them the tab lists every receive
    // ever (including long-spent ones) with no offsetting outflows, so the
    // history visually sums to far more than the unspent balance and users
    // conclude funds are missing. Entries without a `spentTxid` stamp
    // (pre-stamping archives awaiting backfill) still show as receives only.
    const spSpendByTxid = new Map<
      string,
      { sent: number; height?: number; time?: number }
    >();
    for (const u of archivedSpUtxos) {
      if (u.spentTxid === undefined) continue;
      const existing = spSpendByTxid.get(u.spentTxid);
      if (existing) {
        existing.sent += u.value;
        if (existing.time === undefined && u.spentTime !== undefined) existing.time = u.spentTime;
        if (existing.height === undefined && u.spentHeight !== undefined) existing.height = u.spentHeight;
      } else {
        spSpendByTxid.set(u.spentTxid, {
          sent: u.value,
          height: u.spentHeight,
          time: u.spentTime,
        });
      }
    }

    const HEIGHT_ANCHOR = 800_000;
    const TIMESTAMP_ANCHOR = 1_690_070_400; // 2023-07-23T00:00:00Z (block 800,000)
    const SECONDS_PER_BLOCK = 600;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const toTimestamp = (time: number | undefined, height: number | undefined) => {
      if (time !== undefined) return time;
      if (height === undefined) return undefined;
      const synthetic = TIMESTAMP_ANCHOR + (height - HEIGHT_ANCHOR) * SECONDS_PER_BLOCK;
      return Math.min(synthetic, nowSeconds);
    };

    const merged: HdTransaction[] = [];

    for (const row of bip86) {
      // A Blockbook-visible tx supersedes any stamp-derived row for the
      // same txid — its confirmation state and block time are authoritative.
      const stamp = spSpendByTxid.get(row.txid);
      spSpendByTxid.delete(row.txid);

      const rowSpOutflow = row.spOutflow ?? 0;
      // Trust the stamps for the total SP outflow when they exceed what vin
      // matching attributed (Blockbook often omits the prevout index on
      // taproot inputs, so vin matching can undercount).
      const spOutflow = Math.max(rowSpOutflow, stamp?.sent ?? 0);

      if (spOutflow === 0) {
        merged.push(row);
        continue;
      }

      // The tx spent the wallet's own SP UTXOs. Split it double-entry
      // style so each tab reads as a self-contained ledger:
      //
      //   - The private tab gets a send row for the SP value that left,
      //     net of any SP change received in the same tx. Change is never
      //     income, so it must not surface as its own receive row.
      //   - The public tab gets a row for the BIP-86 side, if any. The
      //     builder never routes private-send change to BIP-86 (change
      //     goes back to the wallet's own sp1 address), so a BIP-86 inflow
      //     here is a deliberate private→public transfer and *should* show
      //     as money arriving in the public wallet.
      //
      // Without the split, a private→public transfer rendered as a lone
      // "-fee" row in the private tab and nothing at all in the public tab
      // — whose balance had visibly increased.
      const combinedNet = row.type === 'receive' ? row.amount : -row.amount;
      // buildHdTransactions folded its attributed SP outflow into the net;
      // remove it to recover the pure BIP-86 side.
      const net86 = combinedNet + rowSpOutflow;
      if (net86 !== 0) {
        merged.push({
          txid: row.txid,
          amount: Math.abs(net86),
          type: net86 >= 0 ? 'receive' : 'send',
          confirmed: row.confirmed,
          timestamp: row.timestamp,
          source: 'bip86',
        });
      }
      let netSp = -spOutflow;
      const spChange = spByTxid.get(row.txid);
      if (spChange) {
        netSp += spChange.amount;
        spByTxid.delete(row.txid);
      }
      merged.push({
        txid: row.txid,
        amount: Math.abs(netSp),
        type: netSp >= 0 ? 'receive' : 'send',
        confirmed: row.confirmed,
        timestamp: row.timestamp,
        source: 'silent-payment',
      });
    }

    // Private spends invisible to Blockbook (SP inputs, SP change): the
    // only record is the wallet's own spend stamps on the archive.
    for (const [txid, info] of spSpendByTxid) {
      let net = -info.sent;
      let time = info.time;
      let height = info.height;
      const spChange = spByTxid.get(txid);
      if (spChange) {
        net += spChange.amount;
        // The change output's block data is the spend's block data.
        if (spChange.time !== undefined) time = spChange.time;
        if (height === undefined) height = spChange.height;
        spByTxid.delete(txid);
      }
      merged.push({
        txid,
        amount: Math.abs(net),
        type: net >= 0 ? 'receive' : 'send',
        // Stamps are only written for spends observed on-chain (or
        // broadcast by this wallet), so treat them as confirmed.
        confirmed: true,
        timestamp: toTimestamp(time, height),
        source: 'silent-payment',
      });
    }

    // Whatever remains in spByTxid is a plain silent-payment receive.
    for (const [txid, info] of spByTxid) {
      merged.push({
        txid,
        amount: info.amount,
        type: 'receive',
        // SP UTXOs come from confirmed P2TR outputs in mined blocks — mempool
        // SP detection isn't supported by BlindBit (you need a confirmed block
        // to derive `input_hash`), so any UTXO we've persisted is confirmed.
        confirmed: true,
        timestamp: toTimestamp(info.time, info.height),
        source: 'silent-payment',
      });
    }
    merged.sort((a, b) => {
      if (!a.timestamp && !b.timestamp) return 0;
      if (!a.timestamp) return -1;
      if (!b.timestamp) return 1;
      return b.timestamp - a.timestamp;
    });
    return merged;
  }, [scan, sp.storage]);

  // ── Current receive address ──────────────────────────────────
  const currentReceiveAddress = useMemo<DerivedAddress | undefined>(() => {
    if (!account) return undefined;
    const chainNextUnused = scan?.receive.firstUnusedIndex ?? 0;
    const resolved = Math.max(chainNextUnused, cursor.receiveIndex);
    return deriveReceiveAddress(account, resolved);
  }, [account, scan, cursor.receiveIndex]);

  // ── Silent payment address (static; depends only on the v2 seed) ────
  const silentPaymentAddress = useMemo<SilentPaymentAddress | undefined>(() => {
    if (!seed) return undefined;
    return deriveSilentPaymentAddress(seed);
  }, [seed]);

  // ── Advance to next receive address ──────────────────────────
  const nextReceiveAddress = useCallback((): DerivedAddress | undefined => {
    if (!account) return undefined;
    const chainNextUnused = scan?.receive.firstUnusedIndex ?? 0;
    const current = Math.max(chainNextUnused, cursor.receiveIndex);
    const next = current + 1;
    setCursor({ receiveIndex: next });
    return deriveReceiveAddress(account, next);
  }, [account, scan, cursor.receiveIndex, setCursor]);

  // ── Unified refetch ──────────────────────────────────────────
  const refetch = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['hdwallet-scan'] });
    return refetchScan();
  }, [queryClient, refetchScan]);

  // ── Per-wallet partitioning ──────────────────────────────────
  //
  // The wallet is presented as two strictly-separated balances. The public
  // wallet is the BIP-86 on-chain balance from Blockbook; the private wallet
  // is the silent-payment balance from local SP storage. Transactions split
  // by `source` so each tab shows only its own activity.
  const publicBalance = scan?.totalBalance ?? 0;
  const privateBalance = sp.balance;

  const publicTransactions = useMemo(
    () => transactions?.filter((tx) => tx.source !== 'silent-payment'),
    [transactions],
  );
  const privateTransactions = useMemo(
    () => transactions?.filter((tx) => tx.source === 'silent-payment'),
    [transactions],
  );

  // The full set of on-chain addresses this wallet controls — used to warn
  // when a private send is about to pay the user's own public wallet.
  const ownPublicAddresses = useMemo<Set<string>>(() => {
    const set = new Set<string>();
    if (scan) {
      for (const addr of scan.addressMap.keys()) set.add(addr);
      for (const addr of scan.lookaheadAddresses) set.add(addr);
    }
    if (currentReceiveAddress) set.add(currentReceiveAddress.address);
    return set;
  }, [scan, currentReceiveAddress]);

  return {
    availability,
    currentReceiveAddress,
    silentPaymentAddress,
    scan,
    transactions,
    publicTransactions,
    privateTransactions,
    totalBalance: (scan?.totalBalance ?? 0) + sp.balance,
    pendingBalance: scan?.pendingBalance ?? 0,
    silentPaymentBalance: sp.balance,
    publicBalance,
    privateBalance,
    ownPublicAddresses,
    silentPaymentStorage: sp.storage,
    isLoading: scanLoading,
    isFetching: scanFetching,
    error: scanError,
    refetch,
    nextReceiveAddress,
    pruneSpentSilentPaymentUtxos: sp.pruneSpentUtxos,
    correctSilentPaymentUtxoValues: sp.correctUtxoValues,
  };
}
