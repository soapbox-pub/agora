import type { NostrEvent } from '@nostrify/nostrify';

import { LABEL_KIND } from '@/lib/agoraModeration';

/**
 * Building blocks for Agora's campaign **verification** labels — a NIP-32
 * kind 1985 stream in the `agora.verified` namespace, distinct from the
 * `agora.moderation` namespace used for hide / feature decisions.
 *
 * A verification is a positive trust signal: a campaign moderator (a member
 * of the same moderator pack that governs hide / feature labels) publishes
 * a kind 1985 event with `["L", "agora.verified"]`,
 * `["l", "verified", "agora.verified"]`, and an `["a", "33863:<pubkey>:<d>"]`
 * tag pointing at the campaign it vouches for.
 *
 * Multiple moderators can verify the same campaign; the UI stacks their
 * avatars into a badge. A moderator retracts a verification by issuing a
 * kind 5 deletion of their own label event (NIP-09) — there is no
 * "unverified" value, the label simply ceases to exist.
 *
 * The read path filters by `authors: moderators`, so labels from anyone
 * outside the moderator pack never reach the fold. This is the same trust
 * model — and the same signer set — as the moderation labels (see
 * `agoraModeration.ts`), just on its own additive namespace.
 */

/** NIP-32 label kind, re-exported for verification call sites. */
export { LABEL_KIND };

/** Label namespace for Agora's campaign verification labels. */
export const AGORA_VERIFIED_NAMESPACE = 'agora.verified';

/** The single label value in the verification namespace. */
export const AGORA_VERIFIED_VALUE = 'verified';

/** A single verification observed for one campaign coordinate. */
export interface CampaignVerification {
  /** Hex pubkey of the moderator who issued the verification. */
  pubkey: string;
  /** The moderator's own label event (kind 1985). Needed to delete it. */
  event: NostrEvent;
  /** `created_at` of the label event. */
  createdAt: number;
}

/** Per-coordinate rollup of verifications. */
export interface VerificationData {
  /** Map of `33863:<pubkey>:<d>` -> verifications, ordered oldest-first. */
  byCoord: Map<string, CampaignVerification[]>;
  /** Pubkeys that were considered moderators when the query ran. */
  moderators: string[];
}

export const EMPTY_VERIFICATION_DATA: VerificationData = {
  byCoord: new Map(),
  moderators: [],
};

/**
 * Fold a flat list of `agora.verified` label events into per-coordinate
 * verification rollups.
 *
 * Events are kept only when they carry the `verified` value in the
 * `agora.verified` namespace and an `a` tag whose coordinate starts with
 * `<coordKind>:` — so the verification stream never bleeds across kinds.
 *
 * Each `(coord, moderator)` pair keeps the newest event; a moderator who
 * republishes simply refreshes their own entry rather than stacking twice.
 */
export function foldVerificationLabels(
  events: NostrEvent[],
  moderators: string[],
  coordKind: number,
): VerificationData {
  const coordPrefix = `${coordKind}:`;
  // coord -> (moderator pubkey -> verification)
  const byCoordMap = new Map<string, Map<string, CampaignVerification>>();

  for (const event of events) {
    const value = event.tags.find(
      ([n, , ns]) => n === 'l' && ns === AGORA_VERIFIED_NAMESPACE,
    )?.[1];
    if (value !== AGORA_VERIFIED_VALUE) continue;

    const aTag = event.tags.find(
      ([n, v]) => n === 'a' && typeof v === 'string' && v.startsWith(coordPrefix),
    )?.[1];
    if (!aTag) continue;

    const perModerator = byCoordMap.get(aTag) ?? new Map<string, CampaignVerification>();
    const existing = perModerator.get(event.pubkey);
    if (!existing || event.created_at > existing.createdAt) {
      perModerator.set(event.pubkey, {
        pubkey: event.pubkey,
        event,
        createdAt: event.created_at,
      });
    }
    byCoordMap.set(aTag, perModerator);
  }

  const byCoord = new Map<string, CampaignVerification[]>();
  for (const [coord, perModerator] of byCoordMap) {
    const list = [...perModerator.values()].sort((a, b) => a.createdAt - b.createdAt);
    byCoord.set(coord, list);
  }

  return { byCoord, moderators };
}

/**
 * Return a new {@link VerificationData} with the given label event folded in.
 *
 * Used for optimistic cache updates the moment a moderator publishes a
 * verification, so the badge appears without waiting for the relay to index
 * and re-serve the event. Mirrors {@link foldVerificationLabels}: keeps the
 * newest event per `(coord, moderator)` and preserves oldest-first ordering.
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

  const byCoord = new Map(base.byCoord);
  const existing = byCoord.get(coord) ?? [];
  // Drop any prior verification from the same moderator (republish refreshes
  // their single entry rather than stacking twice), then append the new one.
  const next = existing
    .filter((v) => v.pubkey !== event.pubkey)
    .concat({ pubkey: event.pubkey, event, createdAt: event.created_at })
    .sort((a, b) => a.createdAt - b.createdAt);
  byCoord.set(coord, next);

  return { byCoord, moderators: base.moderators };
}

/**
 * Return a new {@link VerificationData} with the given verification removed.
 *
 * Used for optimistic cache updates when a moderator retracts their own
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

  return { byCoord, moderators: base.moderators };
}
