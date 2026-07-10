import { useNostr } from '@nostrify/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useNostrPublish } from './useNostrPublish';
import { useCurrentUser } from './useCurrentUser';
import { useCampaignModerators } from './useCampaignModerators';
import { useVerifierStatement } from './useVerifierStatement';
import { useNostrStorage } from '@/hooks/useNostrStorage';
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
  isSelfVerification,
  removeVerificationFromData,
} from '@/lib/agoraVerification';

/**
 * Fetches and folds campaign **verification** label events (NIP-32 kind
 * 1985 in the `agora.verified` namespace) from **any author**. Returns a
 * per-coordinate map of who has verified each campaign — the UI stacks
 * their avatars into a badge.
 *
 * Unlike the `agora.moderation` labels (hide / feature), which are gated by
 * the moderator pack, verification is an **open** trust signal: anyone may
 * publish a `verified` label and it surfaces on the badge. The badge always
 * shows *who* verified — donors judge the verifier, not an allowlist. This
 * is a deliberate product decision (open verification until abuse forces a
 * trust gate); if spam becomes a problem, reintroduce an `authors:` filter
 * here.
 *
 * The mutations let a logged-in moderator or verifier vouch for or retract
 * verification:
 * - `verify({ coord })` publishes a kind 1985 label in the verified namespace.
 * - `unverify({ event })` publishes a NIP-09 kind 5 deletion of the
 *   author's own prior label event.
 *
 * Forgery note: a kind 5 deletion only takes effect on labels its signer
 * authored — `foldVerificationLabels` enforces the author match — so an
 * attacker can neither remove someone else's verification nor (per the
 * badge UI) hide who signed one.
 */
export function useCampaignVerifications() {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();
  const { store } = useNostrStorage();
  const { user } = useCurrentUser();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const { data: moderators } = useCampaignModerators();
  const { isVerifier } = useVerifierStatement(user?.pubkey);

  // True when the logged-in user is a moderator (member of the pack that
  // gates `agora.moderation` hide / feature labels).
  const isModerator = !!user && !!moderators && moderators.includes(user.pubkey);

  // True when the logged-in user may verify campaigns: either a moderator
  // or a self-declared verifier (someone who published a kind 14672
  // verifier statement). This gates the verify *action* in menus; the
  // badge read path below is open to labels from anyone.
  const canVerify = isModerator || isVerifier;

  const verificationQuery = useQuery({
    queryKey: ['campaign-verifications'],
    queryFn: async ({ signal }): Promise<VerificationData> => {
      const filters = [
        {
          kinds: [LABEL_KIND],
          '#L': [AGORA_VERIFIED_NAMESPACE],
          '#l': [AGORA_VERIFIED_VALUE],
          limit: 2000,
        },
        // Also pull NIP-09 deletions of kind 1985 labels so a retracted
        // verification stays gone even on relays that keep serving the
        // original label. `foldVerificationLabels` only honors a deletion
        // signed by the label's own author.
        {
          kinds: [5],
          '#k': [String(LABEL_KIND)],
          limit: 2000,
        },
      ];

      // Merge verification labels (and their deletions) from the offline store
      // into the relay response. Both kinds are app-critical and always
      // mirrored into IndexedDB, so the trust badges keep rendering while
      // offline. `foldVerificationLabels` dedupes and applies author-matched
      // deletions, so merging a stale cached copy never regresses a fresher
      // live label or resurrects a deleted one.
      const [events, cached] = await Promise.all([
        nostr.query(filters, { signal }),
        store.query(filters),
      ]);
      return foldVerificationLabels([...events, ...cached], CAMPAIGN_KIND);
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
      // Self-verifications are excluded from the badge fold, so publishing
      // one would silently do nothing — reject it up front instead.
      if (isSelfVerification(user.pubkey, coord)) {
        throw new Error('You cannot verify your own campaign.');
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
    // The read path is open (labels from anyone feed the badge), so the
    // optimistic add applies to every signer, moderator or not.
    onSuccess: (event) => {
      queryClient.setQueryData<VerificationData>(
        ['campaign-verifications'],
        (prev) => addVerificationToData(prev, event),
      );
    },
  });

  const unverify = useMutation({
    mutationFn: async ({ verification }: { verification: CampaignVerification }) => {
      if (!user) throw new Error('You must be logged in to unverify a campaign.');
      if (verification.pubkey !== user.pubkey) {
        // A signer can only retract their own verification — a kind 5
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
      // refetch reconciles — and because the read query also pulls kind 5
      // deletions, the label stays gone even if the relay keeps serving it.
      queryClient.setQueryData<VerificationData>(
        ['campaign-verifications'],
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
