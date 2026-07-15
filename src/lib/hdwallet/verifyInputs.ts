import { hex } from '@scure/base';
import * as btc from '@scure/btc-signer';

import { fetchTxOutputs } from './blockbook';

// ---------------------------------------------------------------------------
// Pre-broadcast input verification
// ---------------------------------------------------------------------------
//
// The BIP-341 sighash commits to every input's prevout `scriptPubKey` and
// `value`. For silent-payment inputs both come from *locally stored* scan
// data: the script is re-derived from the persisted BIP-352 tweak and the
// value is whatever the BlindBit indexer reported at scan time — neither is
// ever checked against the chain. If either is wrong (stale indexer row,
// corrupted storage entry, a tweak recorded by an old buggy build), the
// wallet produces a self-consistent signature that the network rejects with
// the inscrutable:
//
//     -26: mandatory-script-verify-flag-failed (Invalid Schnorr signature)
//
// Similarly, an input that is already spent (or being spent by an in-flight
// transaction the wallet lost track of) is rejected with
// `txn-mempool-conflict` / `bad-txns-inputs-missingorspent`.
//
// This module verifies each PSBT input's `(script, value, unspent)` triple
// against Blockbook *before signing*, so the send flow can:
//
//   - abort doomed broadcasts with an actionable, classified error instead
//     of surfacing a raw bitcoind reject string,
//   - prune/correct the wallet's stored data so a retry actually succeeds.
//
// Verification is best-effort: a failed Blockbook lookup skips that input
// (fail open) so a flaky indexer never bricks the send flow — the broadcast
// itself remains the final authority.
// ---------------------------------------------------------------------------

/** One PSBT input's identity plus the witness data the wallet believes. */
export interface PsbtInputRef {
  /** Display-order (big-endian hex) txid of the prevout transaction. */
  txid: string;
  /** Prevout index. */
  vout: number;
  /** ScriptPubKey the PSBT's witnessUtxo carries, lowercase hex. */
  scriptHex: string;
  /** Value in sats the PSBT's witnessUtxo carries. */
  value: number;
}

/** Outcome of verifying a PSBT's inputs against Blockbook. */
export interface InputVerificationResult {
  /** Inputs Blockbook reports as already spent (confirmed or in-mempool). */
  spent: PsbtInputRef[];
  /**
   * Inputs whose on-chain scriptPubKey differs from the wallet's derived
   * script (or whose prevout doesn't exist). Signing these can never
   * succeed — the stored key data is wrong.
   */
  scriptMismatch: PsbtInputRef[];
  /**
   * Inputs whose script matches but whose stored value differs from the
   * chain. `chainValue` is the authoritative on-chain value in sats.
   */
  valueMismatch: Array<PsbtInputRef & { chainValue: number }>;
}

/**
 * Extract every input's `(txid, vout, script, value)` from an unsigned PSBT.
 * Throws if any input is missing its `witnessUtxo` — the HD wallet's
 * builders always attach one.
 */
export function psbtInputRefs(psbtHex: string): PsbtInputRef[] {
  const tx = btc.Transaction.fromPSBT(hex.decode(psbtHex));
  const refs: PsbtInputRef[] = [];
  for (let i = 0; i < tx.inputsLength; i++) {
    const inp = tx.getInput(i);
    if (!inp.txid || inp.index === undefined) {
      throw new Error(`PSBT input ${i} missing txid/index`);
    }
    if (!inp.witnessUtxo) {
      throw new Error(`PSBT input ${i} missing witnessUtxo`);
    }
    refs.push({
      // `@scure/btc-signer` keeps `TransactionInput.txid` in display-order
      // bytes (matching `Transaction.id`), so a straight hex encode yields
      // the conventional txid string.
      txid: hex.encode(inp.txid),
      vout: inp.index,
      scriptHex: hex.encode(inp.witnessUtxo.script),
      value: Number(inp.witnessUtxo.amount),
    });
  }
  return refs;
}

/**
 * Verify each input against Blockbook's view of the chain (one
 * `getTransaction` per distinct prevout txid). Inputs whose lookup fails
 * are skipped — fail open, the broadcast remains the final authority.
 */
export async function verifyPsbtInputs(
  blockbookBaseUrl: string,
  refs: ReadonlyArray<PsbtInputRef>,
  signal?: AbortSignal,
): Promise<InputVerificationResult> {
  const result: InputVerificationResult = {
    spent: [],
    scriptMismatch: [],
    valueMismatch: [],
  };

  // Group by txid so each prevout tx is fetched once.
  const byTxid = new Map<string, PsbtInputRef[]>();
  for (const ref of refs) {
    const list = byTxid.get(ref.txid);
    if (list) list.push(ref);
    else byTxid.set(ref.txid, [ref]);
  }

  for (const [txid, inputs] of byTxid) {
    if (signal?.aborted) break;
    let outputs: Awaited<ReturnType<typeof fetchTxOutputs>>;
    try {
      outputs = await fetchTxOutputs(blockbookBaseUrl, txid, signal);
    } catch (err) {
      // Fail open: an unreachable Blockbook must not brick the send flow.
      console.warn(`Input verification: failed to fetch tx ${txid}:`, err);
      continue;
    }
    const byVout = new Map(outputs.map((o) => [o.n, o]));
    for (const ref of inputs) {
      const out = byVout.get(ref.vout);
      if (!out) {
        // The prevout index doesn't exist on chain — stored data is wrong.
        result.scriptMismatch.push(ref);
        continue;
      }
      if (out.spent === true) {
        result.spent.push(ref);
        continue;
      }
      if (out.scriptHex !== undefined && out.scriptHex !== ref.scriptHex) {
        result.scriptMismatch.push(ref);
        continue;
      }
      if (out.valueSats !== undefined && out.valueSats !== ref.value) {
        result.valueMismatch.push({ ...ref, chainValue: out.valueSats });
      }
    }
  }

  return result;
}
