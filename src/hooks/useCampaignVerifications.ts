import { useNostr } from '@nostrify/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useNostrPublish } from './useNostrPublish';
import { useCurrentUser } from './useCurrentUser';
import { useCampaignModerators } from './useCampaignModerators';
import { useVerifierStatement } from './useVerifierStatement';
import { CAMPAIGN_KIND } from '@/lib/campaign';
import { LABEL_KIND } from '@/lib/agoraModeration';
import {
  AGORA_VERIFIED_NAMESPACE,
  AGORA_VERIFIED_VALUE,
  EMPTY_VERIFICATION_DATA,
  type CampaignVerification,
  type VerificationData,
  addVerificationToData,
  foldVerificationLabels,
  removeVerificationFromData,
} from '@/lib/agoraVerification';

/**
 * Fetches and folds campaign **verification** label events (NIP-32 kind
 * 1985 in the `agora.verified` namespace) authored by the campaign
 * moderators ({@link useCampaignModerators}). Returns a per-coordinate
 * map of which moderators have verified each campaign — the UI stacks
 * their avatars into a badge.
 *
 * Verification is a moderator action, gated by the same moderator pack
 * that governs hide / feature labels. It just rides a different NIP-32
 * namespace (`agora.verified`) so it's an independent, additive trust
 * signal rather than a discovery decision.
 *
 * The mutations let a logged-in moderator vouch for or retract verification:
 * - `verify({ coord })` publishes a kind 1985 label in the verified namespace.
 * - `unverify({ event })` publishes a NIP-09 kind 5 deletion of that
 *   moderator's own prior label event.
 *
 * As with moderation labels, the read query filters by `authors:
 * moderators`, so a `verified` label signed by anyone outside the pack is
 * ignored — the verification badge can never be forged by an untrusted
 * pubkey.
 */
export function useCampaignVerifications() {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const { data: moderators } = useCampaignModerators();
  const { isVerifier } = useVerifierStatement(user?.pubkey);

  // Stable key so the query refetches when the moderator set changes.
  const moderatorsKey = moderators ? [...moderators].sort().join(',') : '';

  // True when the logged-in user is a moderator. Moderators sign the
  // verification labels that feed the stacked-avatar badge (the read path
  // filters by `authors: moderators`).
  const isModerator = !!user && !!moderators && moderators.includes(user.pubkey);

  // True when the logged-in user may verify campaigns: either a moderator
  // or a self-declared verifier (someone who published a kind 14672
  // verifier statement). Verifiers' verifications surface on their own
  // profile's "Verified" tab (`useVerifiedCampaigns`, scoped by author);
  // moderators' additionally power the on-card verification badge.
  const canVerify = isModerator || isVerifier;

  const verificationQuery = useQuery({
    queryKey: ['campaign-verifications', moderatorsKey],
    // Never fire with an empty `authors:` filter — that would match every
    // `agora.verified` label from any author and break the trust model.
    enabled: moderators !== undefined,
    queryFn: async ({ signal }): Promise<VerificationData> => {
      if (!moderators || moderators.length === 0) {
        return { ...EMPTY_VERIFICATION_DATA, moderators: [] };
      }
      const events = await nostr.query(
        [
          {
            kinds: [LABEL_KIND],
            authors: moderators,
            '#L': [AGORA_VERIFIED_NAMESPACE],
            '#l': [AGORA_VERIFIED_VALUE],
            limit: 2000,
          },
          // Also pull the moderators' NIP-09 deletions so a retracted
          // verification stays gone even on relays that keep serving the
          // original kind 1985 label. `foldVerificationLabels` drops any
          // label whose id appears in a moderator's kind 5 `e` tag.
          {
            kinds: [5],
            authors: moderators,
            '#k': [String(LABEL_KIND)],
            limit: 2000,
          },
        ],
        { signal },
      );
      return foldVerificationLabels(events, moderators, CAMPAIGN_KIND);
    },
    staleTime: 30_000,
  });

  const verify = useMutation({
    mutationFn: async ({ coord }: { coord: string }) => {
      if (!user) throw new Error('You must be logged in to verify a campaign.');
      if (!moderators?.includes(user.pubkey) && !isVerifier) {
        throw new Error('Only moderators and verifiers can verify campaigns.');
      }
      if (!coord.startsWith(`${CAMPAIGN_KIND}:`)) {
        throw new Error(`Coordinate must start with ${CAMPAIGN_KIND}:`);
      }
      return publishEvent({
        kind: LABEL_KIND,
        content: '',
        tags: [
          ['L', AGORA_VERIFIED_NAMESPACE],
          ['l', AGORA_VERIFIED_VALUE, AGORA_VERIFIED_NAMESPACE],
          ['a', coord],
          ['alt', 'Campaign verification'],
        ],
      });
    },
    // Fold the freshly-signed label straight into the cached rollup so the
    // badge appears immediately.
    //
    // We intentionally do NOT call invalidateQueries here. Invalidation forces
    // an immediate refetch, and that refetch races the relay: it almost always
    // lands before the relay has indexed the label we just published, so the
    // queryFn re-reads the OLD label set and overwrites the optimistic value —
    // the badge flashes in, then vanishes. The query's staleTime (30s) lets a
    // natural refetch reconcile with the relay's canonical view once it has
    // caught up. (Same rationale as useNotifications' unread-dot update.)
    //
    // Only moderators feed this badge (the read query filters `authors:
    // moderators`), so only optimistically add for a moderator — otherwise a
    // pure verifier's avatar would flash in then vanish on the next refetch.
    onSuccess: (event) => {
      if (isModerator) {
        queryClient.setQueryData<VerificationData>(
          ['campaign-verifications', moderatorsKey],
          (prev) => addVerificationToData(prev, event),
        );
      }
    },
  });

  const unverify = useMutation({
    mutationFn: async ({ verification }: { verification: CampaignVerification }) => {
      if (!user) throw new Error('You must be logged in to unverify a campaign.');
      if (verification.pubkey !== user.pubkey) {
        // A moderator can only retract their own verification — a kind 5
        // deletion only takes effect on events the signer authored.
        throw new Error('You can only remove your own verification.');
      }
      // NIP-09 deletion of the label event. Kind 1985 is a regular event,
      // so an `e` tag (plus `k` for relays that key on kind) is sufficient.
      return publishEvent({
        kind: 5,
        content: '',
        tags: [
          ['e', verification.event.id],
          ['k', String(LABEL_KIND)],
        ],
      });
    },
    onSuccess: (_event, { verification }) => {
      // Drop the retracted verification from the cached rollup right away so
      // the badge disappears immediately. As with `verify`, we deliberately
      // skip invalidateQueries: an immediate refetch races the relay (the
      // kind 5 deletion isn't indexed yet, so the label still comes back) and
      // the badge would reappear. Once the query goes stale (30s) a natural
      // refetch reconciles — and because the read query now also pulls the
      // moderators' kind 5 deletions, the label stays gone even if the relay
      // keeps serving it.
      queryClient.setQueryData<VerificationData>(
        ['campaign-verifications', moderatorsKey],
        (prev) => removeVerificationFromData(prev, verification),
      );
    },
  });

  return {
    data: verificationQuery.data ?? EMPTY_VERIFICATION_DATA,
    isLoading: verificationQuery.isLoading,
    isReady: verificationQuery.isSuccess,
    /** Whether the logged-in user is a campaign moderator. */
    isModerator,
    /**
     * Whether the logged-in user may verify / unverify campaigns — true for
     * moderators and for self-declared verifiers (kind 14672 statement).
     */
    canVerify,
    verify,
    unverify,
  };
}
