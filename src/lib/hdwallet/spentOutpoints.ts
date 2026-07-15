import type { AccountScanResult } from './scan';

// ---------------------------------------------------------------------------
// Recently-spent outpoint tombstones
// ---------------------------------------------------------------------------
//
// After the wallet broadcasts a transaction there is a window where
// Blockbook has not yet indexed the mempool spend: `getAccountUtxo` still
// returns the just-consumed UTXOs, and the largest-first coin selector
// (which prefers confirmed coins) deterministically re-picks them for the
// next send — producing a guaranteed `txn-mempool-conflict` rejection
// ("One of the inputs has already been spent or is being spent by another
// transaction").
//
// This module keeps a small per-user localStorage set of outpoints the
// wallet itself just spent. The scan pipeline filters returned UTXOs
// against it, closing the race.
//
// Tombstones are self-cleaning:
//
//   - When an outpoint no longer appears in Blockbook's UTXO list, the
//     indexer has caught up with the spend and the tombstone is dropped.
//   - A TTL bounds the damage if the spending tx never gets indexed at all
//     (e.g. evicted from the mempool): after `TOMBSTONE_TTL_MS` the UTXO
//     becomes selectable again. The pre-broadcast verification in
//     `verifyInputs.ts` remains as the backstop for that case.
//
// Only plain outpoint data lives here — no keys, no amounts — so plain
// localStorage is fine.
// ---------------------------------------------------------------------------

/** How long a tombstone suppresses a UTXO that Blockbook still returns. */
const TOMBSTONE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface Tombstone {
  txid: string;
  vout: number;
  /** Wall-clock ms when the spending tx was broadcast. */
  spentAt: number;
}

function storageKey(pubkey: string): string {
  return `hdwallet:spent-outpoints:v1:${pubkey}`;
}

function outpointKey(o: { txid: string; vout: number }): string {
  return `${o.txid}:${o.vout}`;
}

function readTombstones(pubkey: string): Tombstone[] {
  if (!pubkey) return [];
  try {
    const raw = localStorage.getItem(storageKey(pubkey));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    const out: Tombstone[] = [];
    for (const t of parsed) {
      if (!t || typeof t !== 'object') continue;
      const row = t as Record<string, unknown>;
      if (typeof row.txid !== 'string') continue;
      if (typeof row.vout !== 'number' || !Number.isInteger(row.vout)) continue;
      if (typeof row.spentAt !== 'number') continue;
      if (now - row.spentAt > TOMBSTONE_TTL_MS) continue; // expired
      out.push({ txid: row.txid, vout: row.vout, spentAt: row.spentAt });
    }
    return out;
  } catch {
    return [];
  }
}

function writeTombstones(pubkey: string, tombstones: Tombstone[]): void {
  if (!pubkey) return;
  try {
    if (tombstones.length === 0) {
      localStorage.removeItem(storageKey(pubkey));
    } else {
      localStorage.setItem(storageKey(pubkey), JSON.stringify(tombstones));
    }
  } catch {
    // localStorage unavailable — degrade to the pre-existing behaviour
    // (verification + broadcast rejection still guard the double spend).
  }
}

/**
 * Record outpoints consumed by a just-broadcast transaction so the scan
 * pipeline stops offering them to the coin selector while Blockbook
 * catches up. Call immediately after a successful broadcast with *every*
 * input of the transaction (BIP-86 and silent-payment alike — SP entries
 * simply never match a Blockbook UTXO and age out harmlessly).
 */
export function recordSpentOutpoints(
  pubkey: string,
  outpoints: ReadonlyArray<{ txid: string; vout: number }>,
): void {
  if (!pubkey || outpoints.length === 0) return;
  const now = Date.now();
  const existing = readTombstones(pubkey);
  const byKey = new Map(existing.map((t) => [outpointKey(t), t]));
  for (const o of outpoints) {
    byKey.set(outpointKey(o), { txid: o.txid, vout: o.vout, spentAt: now });
  }
  writeTombstones(pubkey, Array.from(byKey.values()));
}

/**
 * Filter a fresh Blockbook scan result against the user's tombstones.
 *
 * Also performs cleanup: tombstones for outpoints Blockbook no longer
 * returns are dropped (the indexer has observed the spend, so normal
 * filtering takes over from here).
 *
 * Returns the input unchanged when nothing matches, so referential
 * stability is preserved for the common case.
 */
export function filterRecentlySpent(
  pubkey: string,
  result: AccountScanResult,
): AccountScanResult {
  const tombstones = readTombstones(pubkey);
  if (tombstones.length === 0) return result;

  const present = new Set(result.utxos.map((u) => outpointKey(u)));

  // Cleanup: drop tombstones Blockbook no longer lists as unspent.
  const stillNeeded = tombstones.filter((t) => present.has(outpointKey(t)));
  if (stillNeeded.length !== tombstones.length) {
    writeTombstones(pubkey, stillNeeded);
  }
  if (stillNeeded.length === 0) return result;

  const suppressed = new Set(stillNeeded.map((t) => outpointKey(t)));
  const kept = result.utxos.filter((u) => !suppressed.has(outpointKey(u)));
  if (kept.length === result.utxos.length) return result;

  const removedValue = result.utxos.reduce(
    (sum, u) => (suppressed.has(outpointKey(u)) ? sum + u.value : sum),
    0,
  );

  return {
    ...result,
    utxos: kept,
    // Keep the headline balance coherent with the spendable set — the
    // consumed value is in flight, not available.
    totalBalance: Math.max(0, result.totalBalance - removedValue),
  };
}
