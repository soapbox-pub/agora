import type { NostrEvent } from '@nostrify/nostrify';

import { LABEL_KIND } from '@/lib/agoraModeration';

/**
 * Building blocks for Agora's campaign **verification** labels — a NIP-32
 * kind 1985 stream in the `agora.verified` namespace, distinct from the
 * `agora.moderation` namespace used for hide / feature decisions.
 *
 * A verification is a positive trust signal: any account publishes a kind
 * 1985 event with `["L", "agora.verified"]`,
 * `["l", "verified", "agora.verified"]`, and an `["a", "33863:<pubkey>:<d>"]`
 * tag pointing at the campaign it vouches for.
 *
 * Multiple accounts can verify the same campaign; the UI stacks their
 * avatars into a badge. A verifier retracts a verification by issuing a
 * kind 5 deletion of their own label event (NIP-09) — there is no
 * "unverified" value, the label simply ceases to exist.
 *
 * **Open trust model.** Unlike the moderation labels (which only honor the
 * moderator pack — see `agoraModeration.ts`), the verification read path is
 * deliberately open: labels from anyone feed the badge, and the badge
 * always shows *who* verified so donors can judge the verifier themselves.
 * The one hard rule is deletion integrity: a kind 5 only removes a label
 * when its signer is the label's author ({@link foldVerificationLabels}
 * enforces this), so nobody can strip someone else's verification.
 */

/** NIP-32 label kind, re-exported for verification call sites. */
export { LABEL_KIND };

/** Label namespace for Agora's campaign verification labels. */
export const AGORA_VERIFIED_NAMESPACE = 'agora.verified';

/** The single label value in the verification namespace. */
export const AGORA_VERIFIED_VALUE = 'verified';

/** A single verification observed for one campaign coordinate. */
export interface CampaignVerification {
  /** Hex pubkey of the account that issued the verification. */
  pubkey: string;
  /** The verifier's own label event (kind 1985). Needed to delete it. */
  event: NostrEvent;
  /** `created_at` of the label event. */
  createdAt: number;
}

/** Per-coordinate rollup of verifications. */
export interface VerificationData {
  /** Map of `33863:<pubkey>:<d>` -> verifications, ordered oldest-first. */
  byCoord: Map<string, CampaignVerification[]>;
}

export const EMPTY_VERIFICATION_DATA: VerificationData = {
  byCoord: new Map(),
};

/**
 * True when a verification label is a **self-verification** — the label's
 * author is the campaign's own author (the pubkey embedded in the
 * `<kind>:<pubkey>:<d>` coordinate). Vouching for your own campaign
 * carries no trust signal, so these are excluded from the badge fold,
 * the optimistic add, and the profile "Verified" tab, and the verify
 * action is hidden on one's own campaigns.
 */
export function isSelfVerification(labelPubkey: string, coord: string): boolean {
  return coord.split(':')[1] === labelPubkey;
}

/**
 * Fold a flat list of `agora.verified` label events into per-coordinate
 * verification rollups.
 *
 * Events are kept only when they carry the `verified` value in the
 * `agora.verified` namespace and an `a` tag whose coordinate starts with
 * `<coordKind>:` — so the verification stream never bleeds across kinds.
 * Labels from **any** author are folded (open trust model — see the module
 * docs above), except **self-verifications**: a label whose author is the
 * campaign's own author is dropped ({@link isSelfVerification}).
 *
 * Kind 5 deletion events (NIP-09) mixed into `events` are honored **only
 * when the deletion's signer is the label's author**: any label whose id is
 * referenced by an `e` tag of a kind 5 signed by the same pubkey is
 * dropped, so a retracted verification stays gone even on relays that keep
 * serving the original kind 1985 label — while a third party's forged
 * deletion has no effect.
 *
 * Each `(coord, verifier)` pair keeps the newest event; a verifier who
 * republishes simply refreshes their own entry rather than stacking twice.
 */
export function foldVerificationLabels(
  events: NostrEvent[],
  coordKind: number,
): VerificationData {
  const coordPrefix = `${coordKind}:`;

  // Collect `<deleter pubkey>:<event id>` pairs from NIP-09 kind 5 events.
  // A deletion only takes effect on events its signer authored, so labels
  // are excluded below only when the label author matches the deleter.
  const deletedByAuthor = new Set<string>();
  for (const event of events) {
    if (event.kind !== 5) continue;
    for (const [n, id] of event.tags) {
      if (n === 'e' && id) deletedByAuthor.add(`${event.pubkey}:${id}`);
    }
  }

  // coord -> (verifier pubkey -> verification)
  const byCoordMap = new Map<string, Map<string, CampaignVerification>>();

  for (const event of events) {
    if (event.kind === 5) continue;
    if (deletedByAuthor.has(`${event.pubkey}:${event.id}`)) continue;

    const value = event.tags.find(
      ([n, , ns]) => n === 'l' && ns === AGORA_VERIFIED_NAMESPACE,
    )?.[1];
    if (value !== AGORA_VERIFIED_VALUE) continue;

    const aTag = event.tags.find(
      ([n, v]) => n === 'a' && typeof v === 'string' && v.startsWith(coordPrefix),
    )?.[1];
    if (!aTag) continue;

    // A campaign author vouching for their own campaign is meaningless as
    // a trust signal — never surface it on the badge.
    if (isSelfVerification(event.pubkey, aTag)) continue;

    const perVerifier = byCoordMap.get(aTag) ?? new Map<string, CampaignVerification>();
    const existing = perVerifier.get(event.pubkey);
    if (!existing || event.created_at > existing.createdAt) {
      perVerifier.set(event.pubkey, {
        pubkey: event.pubkey,
        event,
        createdAt: event.created_at,
      });
    }
    byCoordMap.set(aTag, perVerifier);
  }

  const byCoord = new Map<string, CampaignVerification[]>();
  for (const [coord, perVerifier] of byCoordMap) {
    const list = [...perVerifier.values()].sort((a, b) => a.createdAt - b.createdAt);
    byCoord.set(coord, list);
  }

  return { byCoord };
}

/**
 * Return a new {@link VerificationData} with the given label event folded in.
 *
 * Used for optimistic cache updates the moment a user publishes a
 * verification, so the badge appears without waiting for the relay to index
 * and re-serve the event. Mirrors {@link foldVerificationLabels}: keeps the
 * newest event per `(coord, verifier)` and preserves oldest-first ordering.
 *
 * The event must carry the `verified` value in the `agora.verified`
 * namespace and an `a` tag — otherwise the input is returned unchanged.
 */
export function addVerificationToData(
  prev: VerificationData | undefined,
  event: NostrEvent,
): VerificationData {
  const base = prev ?? EMPTY_VERIFICATION_DATA;

  const value = event.tags.find(
    ([n, , ns]) => n === 'l' && ns === AGORA_VERIFIED_NAMESPACE,
  )?.[1];
  if (value !== AGORA_VERIFIED_VALUE) return base;

  const coord = event.tags.find(([n, v]) => n === 'a' && typeof v === 'string')?.[1];
  if (!coord) return base;

  // Mirror the fold: self-verifications never reach the badge.
  if (isSelfVerification(event.pubkey, coord)) return base;

  const byCoord = new Map(base.byCoord);
  const existing = byCoord.get(coord) ?? [];
  // Drop any prior verification from the same verifier (republish refreshes
  // their single entry rather than stacking twice), then append the new one.
  const next = existing
    .filter((v) => v.pubkey !== event.pubkey)
    .concat({ pubkey: event.pubkey, event, createdAt: event.created_at })
    .sort((a, b) => a.createdAt - b.createdAt);
  byCoord.set(coord, next);

  return { byCoord };
}

/**
 * Return a new {@link VerificationData} with the given verification removed.
 *
 * Used for optimistic cache updates when a verifier retracts their own
 * verification (a NIP-09 deletion), so the badge disappears immediately
 * rather than after the relay processes the kind 5 event.
 */
export function removeVerificationFromData(
  prev: VerificationData | undefined,
  verification: CampaignVerification,
): VerificationData {
  const base = prev ?? EMPTY_VERIFICATION_DATA;

  const byCoord = new Map(base.byCoord);
  for (const [coord, list] of byCoord) {
    const next = list.filter((v) => v.event.id !== verification.event.id);
    if (next.length !== list.length) {
      if (next.length === 0) {
        byCoord.delete(coord);
      } else {
        byCoord.set(coord, next);
      }
    }
  }

  return { byCoord };
}
