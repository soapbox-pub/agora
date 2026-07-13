import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Bitcoin,
  Download,
  Eye,
  EyeOff,
  HandCoins,
  Link2,
  Loader2,
  Megaphone,
  Upload,
  User,
  X,
} from 'lucide-react';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';

import { AgoraBoltIcon } from '@/components/icons/AgoraBoltIcon';
import { VerifierIdentityStep } from '@/components/onboarding/VerifierIdentityStep';
import { VerifierBioStep } from '@/components/onboarding/VerifierBioStep';
import { VerifierStatementEditor } from '@/components/organizations/VerifierStatementEditor';
import { VerifyTutorial } from '@/components/organizations/VerifyTutorial';
import { usePublishOrgProfile } from '@/hooks/usePublishOrgProfile';
import { useSetVerifierStatement } from '@/hooks/useVerifierStatement';
import { emptyProfileDraft, type ProfileDraft } from '@/lib/profileDraft';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useLoginActions } from '@/hooks/useLoginActions';
import { useOnboarding, type OnboardingRole } from '@/contexts/onboardingContextDef';
import { useToast } from '@/hooks/useToast';
import { saveNsec, getNsecCredential } from '@/lib/credentialManager';
import { cn } from '@/lib/utils';

/**
 * Step state machine for the captive signup flow.
 *
 * Base order (creator / donor):
 *   keygen → secure → verify → role
 *
 * Picking the *verifier* role doesn't navigate away — it branches into a
 * captive sub-flow that continues from the role step:
 *   role → orgIdentity → orgBio → orgStatement → orgVerifyHowto
 *
 * 1. orgIdentity   — banner, avatar, org name, website (kind-0 identity)
 * 2. orgBio        — the organization's bio (kind-0 about)
 * 3. orgStatement  — publish the verifier statement (kind 14672)
 * 4. orgVerifyHowto— teach the verify gesture, then "View Campaigns"
 *
 * The old flow had a separate "wallet-coupling explainer" step and a
 * separate "outro" celebration screen; both were folded in. The coupling
 * explainer was redundant with `secure` (both screens are about the key), so
 * the secure step now carries the "this key is your account AND your wallet"
 * framing inline. For creator/donor the role pick *is* the outro.
 *
 * Login is handled by the existing `AuthDialog` modal — the captive flow is
 * only ever opened by an explicit `startSignup()` call (e.g. from
 * AuthDialog's "Create a new Nostr account" button), so the user has
 * already picked "signup" by the time we mount.
 */
type Step =
  | 'keygen'
  | 'secure'
  | 'verify'
  | 'role'
  | 'orgIdentity'
  | 'orgBio'
  | 'orgStatement'
  | 'orgVerifyHowto';

/** Base steps that count toward the progress bar for creator/donor. */
const SIGNUP_STEPS: Step[] = ['keygen', 'secure', 'verify', 'role'];

/**
 * Steps that count toward the progress bar once the user has chosen the
 * verifier role. The role step is shared with the base flow, then the four
 * verifier sub-flow steps extend it.
 */
const VERIFIER_STEPS: Step[] = [
  'keygen',
  'secure',
  'verify',
  'role',
  'orgIdentity',
  'orgBio',
  'orgStatement',
  'orgVerifyHowto',
];

/** Ordered verifier sub-flow steps, used for sequential next/back nav. */
const VERIFIER_SUBFLOW: Step[] = [
  'orgIdentity',
  'orgBio',
  'orgStatement',
  'orgVerifyHowto',
];

/**
 * The captive onboarding gate. Render this as a sibling of `<AppRouter />`;
 * it renders nothing when inactive and a fullscreen `fixed inset-0 z-50`
 * overlay when `useOnboarding().active === true`.
 *
 * The flow guides a brand-new user through:
 *   1. Key generation
 *   2. Save the nsec (with inline wallet-coupling framing)
 *   3. Verify the saved key (paste or upload it back; auto-filled from the
 *      browser password manager when available)
 *   4. Role pick — primary CTA navigates by intent: creator → /campaigns/new,
 *      donor → / (campaign grid)
 *
 * The overlay sits above all app chrome and cannot be dismissed by clicking
 * outside; users must either complete the flow or use the explicit Close (X)
 * button in the top-right corner.
 */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const { active } = useOnboarding();

  return (
    <>
      {children}
      {active && <CaptiveOverlay />}
    </>
  );
}

/** Inner overlay component — only mounted while the flow is active so the
 *  per-flow state resets cleanly between sessions. */
function CaptiveOverlay() {
  const { t } = useTranslation();
  const { cancel, role: contextRole, setRole: setContextRole } = useOnboarding();
  const navigate = useNavigate();
  const { toast } = useToast();
  const login = useLoginActions();
  const { user } = useCurrentUser();

  // Decide the entry step.
  // - Already-authenticated users normally land on `role` directly.
  const initialStep: Step = useMemo(() => {
    if (user) return 'role';
    return 'keygen';
  }, [user]);

  const [step, setStep] = useState<Step>(initialStep);

  // Signup state
  const [nsec, setNsec] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showKey, setShowKey] = useState(false);

  // Verifier sub-flow: the organization's kind-0 profile draft, accumulated
  // across the identity + bio steps and published once at the end. Held here
  // so back-navigation between sub-flow steps preserves what's entered.
  const [orgDraft, setOrgDraft] = useState<ProfileDraft>(emptyProfileDraft);
  const patchOrgDraft = useCallback(
    (patch: Partial<ProfileDraft>) =>
      setOrgDraft((prev) => ({ ...prev, ...patch })),
    [],
  );

  // Pubkey of the key generated in this captive flow, if any. Used as the
  // `expectedPubkey` guard when publishing the org profile so a failed
  // auto-login can't overwrite a different account's kind-0. Empty when the
  // user was already authenticated on entry (no guard needed then).
  const signupPubkey = useMemo(() => {
    if (!nsec) return undefined;
    try {
      const decoded = nip19.decode(nsec);
      if (decoded.type !== 'nsec') return undefined;
      return getPublicKey(decoded.data);
    } catch {
      return undefined;
    }
  }, [nsec]);

  const { mutateAsync: publishOrgProfile, isPending: isPublishingOrg } =
    usePublishOrgProfile();

  // Linear progress bar position. Once the user has chosen the verifier
  // role, the bar tracks the extended verifier step list so the four
  // sub-flow screens are reflected; otherwise the base three-step list is
  // used (creator/donor progress math is unaffected).
  const isVerifierFlow =
    contextRole === 'verifier' || VERIFIER_SUBFLOW.includes(step);
  const progressSteps = isVerifierFlow ? VERIFIER_STEPS : SIGNUP_STEPS;
  const currentProgressIndex = progressSteps.indexOf(step);
  const progress = currentProgressIndex < 0
    ? 0
    : ((currentProgressIndex + 1) / progressSteps.length) * 100;

  // Navigation helpers ------------------------------------------------------
  const goTo = useCallback((target: Step) => {
    setStep(target);
  }, []);

  const showBackButton = !(step === 'keygen' && isGenerating);
  const handleBack = useCallback(() => {
    if (step === 'keygen') {
      cancel();
    } else if (step === 'secure') {
      goTo('keygen');
    } else if (step === 'verify') {
      goTo('secure');
    } else if (VERIFIER_SUBFLOW.includes(step)) {
      // Within the verifier sub-flow: step back one screen, or back to the
      // role picker from the first sub-flow step.
      const idx = VERIFIER_SUBFLOW.indexOf(step);
      goTo(idx <= 0 ? 'role' : VERIFIER_SUBFLOW[idx - 1]);
    } else {
      // role step
      if (user) cancel();
      else goTo('verify');
    }
  }, [step, user, cancel, goTo]);

  // Advance one screen within the verifier sub-flow. The first call (from
  // the role pick) enters at `orgIdentity`; subsequent calls walk the list.
  const goNextVerifierStep = useCallback(() => {
    const idx = VERIFIER_SUBFLOW.indexOf(step);
    if (idx < 0) {
      goTo(VERIFIER_SUBFLOW[0]);
    } else if (idx < VERIFIER_SUBFLOW.length - 1) {
      goTo(VERIFIER_SUBFLOW[idx + 1]);
    }
  }, [step, goTo]);

  // Role pick. For creator/donor this is the final step: it records the
  // choice and navigates to the matching surface (creator → /campaigns/new,
  // donor → /campaigns). The verifier role does NOT navigate away — it
  // records the role and enters the captive verifier sub-flow, which
  // finishes on its own terms ("View Campaigns").
  const handleRolePick = useCallback(
    (next: 'creator' | 'donor' | 'verifier') => {
      setContextRole(next);
      if (next === 'verifier') {
        goTo('orgIdentity');
        return;
      }
      cancel();
      if (next === 'creator') {
        navigate('/campaigns/new');
      } else {
        navigate('/campaigns');
      }
    },
    [setContextRole, cancel, navigate, goTo],
  );

  // Terminal CTA for the verifier sub-flow — drop the new verifier on the
  // campaign grid so they can immediately start vouching.
  const handleVerifierFinish = useCallback(() => {
    cancel();
    navigate('/campaigns');
  }, [cancel, navigate]);

  // Leaving the bio step: publish the assembled kind-0 org profile, then
  // advance to the statement step. Publishing is best-effort — a failure
  // surfaces a non-fatal toast and the user still proceeds (they can fix the
  // profile later from settings), mirroring the InitialSyncGate behavior.
  const handleBioContinue = useCallback(async () => {
    try {
      await publishOrgProfile({ draft: orgDraft, expectedPubkey: signupPubkey });
    } catch {
      toast({
        title: t('onboarding.verifier.publishFailedTitle'),
        description: t('onboarding.verifier.publishFailedDescription'),
        variant: 'destructive',
      });
    }
    goNextVerifierStep();
  }, [publishOrgProfile, orgDraft, signupPubkey, toast, t, goNextVerifierStep]);

  // Key generation ----------------------------------------------------------
  const handleGenerateKey = useCallback(() => {
    setIsGenerating(true);
    // Brief visible spinner — the generation itself is instantaneous, but
    // an instant transition feels too "did anything happen?" given the
    // weight of what just got created.
    setTimeout(() => {
      const sk = generateSecretKey();
      setNsec(nip19.nsecEncode(sk));
      setIsGenerating(false);
      goTo('secure');
    }, 700);
  }, [goTo]);

  // Save the nsec, then advance to the verification step. -----------------
  // `saveNsec` downloads the `.nsec.txt` file (web) and, on Chromium and
  // native platforms, offers to store the key in the browser / OS password
  // manager. We deliberately do NOT log in here: the user proves they saved
  // the key on the next (`verify`) step before we install it into the login
  // store.
  const handleSaveAndContinue = useCallback(async () => {
    try {
      const decoded = nip19.decode(nsec);
      if (decoded.type !== 'nsec') throw new Error('Invalid nsec');
      const pubkey = getPublicKey(decoded.data);
      const npub = nip19.npubEncode(pubkey);
      await saveNsec(npub, nsec, 'Agora');
      goTo('verify');
    } catch {
      toast({
        title: t('onboarding.secure.downloadFailedTitle'),
        description: t('onboarding.secure.downloadFailedDescription'),
        variant: 'destructive',
      });
    }
  }, [nsec, goTo, toast, t]);

  // Confirm the saved key, then install it into the login store. ------------
  // Called by the verify step once the user has entered a value that matches
  // the generated nsec (whether pasted, uploaded, or auto-filled from the
  // password manager). This is the point where the account actually becomes
  // active.
  const handleVerified = useCallback(() => {
    login.nsec(nsec);
    goTo('role');
  }, [login, nsec, goTo]);

  // Step renderer -----------------------------------------------------------
  const stepBody = (() => {
    switch (step) {
      case 'keygen':
        // First step. Back closes the captive flow entirely — the user got
        // here from the AuthDialog and already chose "signup".
        return (
          <KeygenStep
            isGenerating={isGenerating}
            onGenerate={handleGenerateKey}
          />
        );
      case 'secure':
        return (
          <SecureStep
            nsec={nsec}
            showKey={showKey}
            onToggleShow={() => setShowKey((v) => !v)}
            onContinue={handleSaveAndContinue}
          />
        );
      case 'verify':
        // Prove the key was saved before it's installed into the login store.
        // The user pastes or uploads their nsec; on Chromium / native we also
        // try to auto-fill it from the password manager (`saveNsec` stored it
        // on the previous step).
        return (
          <VerifyStep
            expectedNsec={nsec}
            onVerified={handleVerified}
          />
        );
      case 'role':
        // Final step. Picking a role navigates to the matching surface
        // (creator → /campaigns/new, donor → /); Back goes to secure if the
        // user signed up through the full flow, or cancels the overlay if
        // they were already-authenticated and landed here directly.
        return (
          <RoleStep
            role={contextRole}
            onPick={handleRolePick}
          />
        );
      case 'orgIdentity':
        // Verifier sub-flow step 1 — organization identity (kind-0).
        return (
          <VerifierIdentityStep
            draft={orgDraft}
            onChange={patchOrgDraft}
            onContinue={goNextVerifierStep}
          />
        );
      case 'orgBio':
        // Verifier sub-flow step 2 — organization bio (kind-0 about).
        return (
          <VerifierBioStep
            draft={orgDraft}
            onChange={patchOrgDraft}
            onContinue={handleBioContinue}
            isPublishing={isPublishingOrg}
          />
        );
      case 'orgStatement':
        // Verifier sub-flow step 3 — publish the verifier statement
        // (kind 14672), reusing the shared editor.
        return (
          <VerifierStatementStep
            onContinue={goNextVerifierStep}
          />
        );
      case 'orgVerifyHowto':
        // Verifier sub-flow step 4 — teach the verify gesture, then finish.
        return (
          <VerifierHowtoStep draft={orgDraft} onFinish={handleVerifierFinish} />
        );
    }
  })();

  return (
    <div
      className="safe-area-top fixed inset-0 z-50 bg-background overflow-y-auto flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label={t('onboarding.ariaLabel')}
    >
      {/* Progress bar — every step in the flow counts toward it. */}
      <div className="sticky top-0 z-10 h-1 bg-muted">
        <div
          className="h-full bg-primary transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {showBackButton && (
        <button
          type="button"
          onClick={handleBack}
          aria-label={t('common.back')}
          className="absolute left-4 top-4 z-20 sm:left-6 sm:top-6 inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-5 w-5 rtl:rotate-180" />
        </button>
      )}

      {/* Top-right close. Lets users escape if they truly don't want to
          continue — but it's deliberately unobtrusive vs. a backdrop click
          so casual taps don't drop them out of the flow. */}
      <button
        type="button"
        onClick={cancel}
        aria-label={t('onboarding.close')}
        className="absolute right-4 top-4 z-20 sm:right-6 sm:top-6 inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      >
        <X className="h-5 w-5" />
      </button>

      <div className="flex-1 flex items-start sm:items-center justify-center px-6 pt-16 pb-12">
        <div
          key={step}
          className={cn(
            'w-full mx-auto animate-in fade-in slide-in-from-bottom-2 duration-300',
            // Bio, statement & how-to steps host a text surface / markdown
            // editor / tutorial and want a slightly roomier column than the
            // narrow base screens — but not the full-width 3xl that left the
            // text boxes and tutorial feeling oversized.
            step === 'orgBio' || step === 'orgStatement' || step === 'orgVerifyHowto'
              ? 'max-w-xl'
              : 'max-w-md',
          )}
        >
          {stepBody}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Step components
// =============================================================================

interface RoleStepProps {
  role: OnboardingRole;
  onPick: (role: 'creator' | 'donor' | 'verifier') => void;
}

/**
 * Two-card role picker, modeled on the Treasures CreateCacheLanding pattern.
 * Both cards use primary-tinted icon chips (both roles are first-class) and
 * the three-line "title / what you do / what the other side sees"
 * structure that makes the choice feel like a role rather than a feature
 * menu.
 */
function RoleStep({ role, onPick }: RoleStepProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h2 className="text-2xl font-bold tracking-tight">{t('onboarding.role.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('onboarding.role.subtitle')}</p>
      </div>

      <div className="space-y-3">
        <RoleCard
          icon={<Megaphone className="h-5 w-5 md:h-6 md:w-6 text-primary" />}
          title={t('onboarding.role.creator.title')}
          description={t('onboarding.role.creator.description')}
          finderNote={t('onboarding.role.creator.finderNote')}
          selected={role === 'creator'}
          onClick={() => onPick('creator')}
        />
        <RoleCard
          icon={<HandCoins className="h-5 w-5 md:h-6 md:w-6 text-primary" />}
          title={t('onboarding.role.donor.title')}
          description={t('onboarding.role.donor.description')}
          finderNote={t('onboarding.role.donor.finderNote')}
          selected={role === 'donor'}
          onClick={() => onPick('donor')}
        />
        <RoleCard
          icon={<BadgeCheck className="h-5 w-5 md:h-6 md:w-6 text-primary" />}
          title={t('onboarding.role.verifier.title')}
          description={t('onboarding.role.verifier.description')}
          finderNote={t('onboarding.role.verifier.finderNote')}
          selected={role === 'verifier'}
          onClick={() => onPick('verifier')}
        />
      </div>

    </div>
  );
}

/**
 * Verifier sub-flow step 4 — teach the verify gesture with the shared
 * {@link VerifyTutorial}, then offer the terminal "View campaigns" CTA.
 */
function VerifierHowtoStep({
  draft,
  onFinish,
}: {
  draft: ProfileDraft;
  onFinish: () => void;
}) {
  const { t } = useTranslation();
  const [hasSeenLoop, setHasSeenLoop] = useState(false);
  const handleLoopComplete = useCallback(() => setHasSeenLoop(true), []);

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h2 className="text-2xl font-bold tracking-tight">
          {t('onboarding.verifier.howto.title')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('onboarding.verifier.howto.subtitle')}
        </p>
      </div>

      <VerifyTutorial
        hideHeader
        bare
        stacked
        verifierName={draft.name}
        verifierPicture={draft.picture}
        onLoopComplete={handleLoopComplete}
      />

      <Button
        onClick={onFinish}
        disabled={!hasSeenLoop}
        className="w-full h-12 text-base rounded-full"
      >
        {t('onboarding.verifier.howto.finish')}
        <ArrowRight className="ml-2 h-4 w-4 rtl:rotate-180" />
      </Button>
    </div>
  );
}

interface VerifierStatementStepProps {
  onContinue: () => void;
}

/**
 * Verifier sub-flow step 3 — publish the verifier statement (kind 14672).
 *
 * One header and one combined subtext sit above a borderless
 * {@link VerifierStatementEditor}. There's no separate publish button: the
 * primary button publishes the statement (when there's content) and then
 * advances. Withdrawing happens later from the profile's "How We Verify" card.
 */
function VerifierStatementStep({
  onContinue,
}: VerifierStatementStepProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { mutateAsync: setStatement, isPending } = useSetVerifierStatement();

  const [value, setValue] = useState('');

  const trimmed = value.trim();

  const handleContinue = useCallback(async () => {
    try {
      await setStatement(trimmed);
      onContinue();
    } catch (error) {
      toast({
        title: t('verifier.errorToast'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  }, [setStatement, trimmed, toast, t, onContinue]);

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h2 className="text-2xl font-bold tracking-tight">
          {t('onboarding.verifier.statement.title')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('onboarding.verifier.statement.subtitle')}
        </p>
      </div>

      <VerifierStatementEditor
        value={value}
        onChange={setValue}
      />

      <Button
        onClick={handleContinue}
        disabled={!trimmed || isPending}
        className="w-full h-12 text-base rounded-full"
      >
        {isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : null}
        {t('common.continue')}
        {!isPending && <ArrowRight className="ml-2 h-4 w-4 rtl:rotate-180" />}
      </Button>
    </div>
  );
}

interface RoleCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  finderNote: string;
  selected: boolean;
  onClick: () => void;
}

/** A single role card. Three text lines, primary-tinted icon chip, hover and
 *  selected states matching the Treasures pattern. */
function RoleCard({ icon, title, description, finderNote, selected, onClick }: RoleCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left rounded-xl border bg-card p-5 md:p-6 transition-all',
        'hover:border-primary/50 hover:shadow-md',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
        selected && 'border-primary shadow-md ring-1 ring-primary',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-10 h-10 md:w-12 md:h-12 rounded-full bg-primary/10 flex items-center justify-center">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm md:text-base font-semibold text-foreground">{title}</h3>
          <p className="text-xs md:text-sm text-muted-foreground mt-0.5">{description}</p>
          <p className="text-xs md:text-sm font-medium text-primary mt-1.5">{finderNote}</p>
        </div>
        <ArrowRight className="h-4 w-4 md:h-5 md:w-5 text-muted-foreground flex-shrink-0 mt-1 rtl:rotate-180" />
      </div>
    </button>
  );
}

interface KeygenStepProps {
  isGenerating: boolean;
  onGenerate: () => void;
}

/** Key generation step — a single CTA that fires off `generateSecretKey()`
 *  with a brief visible spinner for tactile feedback. */
function KeygenStep({ isGenerating, onGenerate }: KeygenStepProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-6 text-center">
      <div className="relative w-24 h-24 mx-auto">
        {isGenerating ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-14 h-14 text-primary animate-spin" />
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <AgoraBoltIcon className="size-20 drop-shadow-md" />
          </div>
        )}
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight">
          {isGenerating ? t('onboarding.keygen.generatingTitle') : t('onboarding.keygen.title')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {isGenerating ? t('onboarding.keygen.generatingDescription') : t('onboarding.keygen.description')}
        </p>
      </div>
      {!isGenerating && (
        <Button onClick={onGenerate} className="w-full h-12 text-base rounded-full">
          {t('onboarding.keygen.button')}
        </Button>
      )}
    </div>
  );
}

interface SecureStepProps {
  nsec: string;
  showKey: boolean;
  onToggleShow: () => void;
  onContinue: () => void;
}

/**
 * Reveals + saves the nsec, then advances to the verification step.
 *
 * Saving goes through `saveNsec`, which downloads the `.nsec.txt` file and,
 * where supported, offers to store the key in the browser / OS password
 * manager. The key is NOT installed into the login store here — the user
 * proves they kept a copy on the following `verify` step first.
 *
 * Three stacked elements communicate the weight of saving the key:
 *   1. The key itself (revealable input + download button).
 *   2. A "your account and your wallet share this key" coupling callout —
 *      large linked icons make the relationship the visual centerpiece.
 *   3. A no-recovery emphasis block — calm, informational tone (not a red
 *      destructive alert) but typographically dominant so the user can't
 *      breeze past the "there is no way to get this back" point.
 *
 * This is the only captive-flow surface that explains the coupling and the
 * permanence to brand-new users, so it has to carry weight without scaring
 * them.
 */
function SecureStep({ nsec, showKey, onToggleShow, onContinue }: SecureStepProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h2 className="text-2xl font-bold tracking-tight">{t('onboarding.secure.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('onboarding.secure.subtitle')}</p>
      </div>

      <div className="relative">
        <Input
          type={showKey ? 'text' : 'password'}
          value={nsec}
          readOnly
          className="pr-10 font-mono text-sm"
          aria-label={t('onboarding.secure.secretKeyAriaLabel')}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
          onClick={onToggleShow}
        >
          {showKey ? (
            <EyeOff className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Eye className="h-4 w-4 text-muted-foreground" />
          )}
        </Button>
      </div>

      {/* Single coupling+permanence card. The linked-icon visual at the
          top communicates "your account and your wallet share this key";
          the typographically heavier line below it makes the no-recovery
          point inescapable without resorting to red/warning iconography.
          Both messages live in one card so the user can't skim past
          either. */}
      <div className="rounded-xl bg-primary/10 border-2 border-primary/30 p-5 space-y-4">
        <div className="flex items-center justify-center gap-3">
          <div className="w-14 h-14 rounded-full bg-background ring-2 ring-primary/30 flex items-center justify-center shadow-sm">
            <User className="h-7 w-7 text-primary" />
          </div>
          <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow">
            <Link2 className="h-4 w-4" />
          </div>
          <div className="w-14 h-14 rounded-full bg-background ring-2 ring-primary/30 flex items-center justify-center shadow-sm">
            <Bitcoin className="h-7 w-7 text-primary" />
          </div>
        </div>
        <p className="text-sm text-foreground text-center leading-relaxed">
          {t('onboarding.secure.couplingNote')}
        </p>
        <div className="border-t border-primary/20 pt-3 text-center">
          <p className="text-base font-bold tracking-tight text-foreground leading-snug">
            {t('onboarding.secure.permanenceHeadline')}
          </p>
          <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
            {t('onboarding.secure.permanenceBody')}
          </p>
        </div>
      </div>

      <Button onClick={onContinue} className="w-full h-12 text-base rounded-full">
        <Download className="w-4 h-4 mr-2" />
        {t('onboarding.secure.button')}
      </Button>
    </div>
  );
}

interface VerifyStepProps {
  /** The nsec generated earlier in the flow, to compare the entry against. */
  expectedNsec: string;
  /** Called once the entered / uploaded / auto-filled key matches. */
  onVerified: () => void;
}

/** nsec bech32 shape: `nsec1` + 58 bech32 chars. */
const NSEC_RE = /^nsec1[a-z0-9]{58}$/;

/**
 * Key-verification step. The user proves they actually kept a copy of the key
 * they just saved by pasting it, uploading the downloaded `.nsec.txt` file, or
 * — on Chromium / native platforms — having it auto-filled from the password
 * manager where `saveNsec` stored it on the previous step.
 *
 * The entry is only accepted when it exactly matches the generated nsec, so a
 * typo or the wrong key can't slip through. Matching triggers `onVerified`,
 * which is where the account is finally installed into the login store.
 */
function VerifyStep({ expectedNsec, onVerified }: VerifyStepProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Guard so a match only ever fires `onVerified` once, even if the value
  // effect and the credential/upload paths race.
  const verifiedRef = useRef(false);
  const verify = useCallback(() => {
    if (verifiedRef.current) return;
    verifiedRef.current = true;
    onVerified();
  }, [onVerified]);

  const trimmed = value.trim();
  const matches = trimmed === expectedNsec;

  // The moment the field holds the matching key — whether typed, pasted, or
  // auto-filled from the password manager — verify and advance. No explicit
  // "Continue" tap needed.
  useEffect(() => {
    if (matches) verify();
  }, [matches, verify]);

  // Progressive enhancement: try to pull the key back out of the platform
  // password manager (Chromium `navigator.credentials.get`, or iCloud/Android
  // keychain on native). A match flows into the value effect above, which
  // advances automatically. Runs once on mount.
  useEffect(() => {
    let cancelled = false;
    getNsecCredential().then((cred) => {
      if (cancelled || !cred) return;
      if (cred.nsec === expectedNsec) {
        setValue(cred.nsec);
        setError(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [expectedNsec]);

  const handleChange = useCallback((next: string) => {
    setValue(next);
    setError(null);
  }, []);

  const handleFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Reset so selecting the same file again re-fires the change event.
      e.target.value = '';
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        const content = (ev.target?.result as string | null)?.trim() ?? '';
        if (!NSEC_RE.test(content)) {
          setError(t('onboarding.verify.fileInvalid'));
          return;
        }
        // A matching upload is proof enough — verify and advance without
        // ever exposing the raw nsec in the (plaintext) input field.
        if (content === expectedNsec) {
          verify();
        } else {
          setError(t('onboarding.verify.mismatch'));
        }
      };
      reader.onerror = () => setError(t('onboarding.verify.fileReadFailed'));
      reader.readAsText(file);
    },
    [expectedNsec, verify, t],
  );

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h2 className="text-2xl font-bold tracking-tight">
          {t('onboarding.verify.title')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('onboarding.verify.subtitle')}
        </p>
      </div>

      <div className="space-y-2">
        <Input
          type="text"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={t('onboarding.verify.placeholder')}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={!!error}
          aria-label={t('onboarding.verify.inputAriaLabel')}
          className="font-mono text-sm"
          // The global nsec paste guard (useNsecPasteGuard) blocks pasting a
          // secret key anywhere except opted-in fields. This verification step
          // *requires* the user to paste their nsec, so mark it as allowed.
          data-nsec-allowed
        />

        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>

      {/* Upload the downloaded .nsec.txt file as an alternative to pasting. */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        <span>{t('onboarding.verify.or')}</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <Button
        type="button"
        variant="outline"
        onClick={() => fileInputRef.current?.click()}
        className="w-full h-11 rounded-full"
      >
        <Upload className="w-4 h-4 mr-2" />
        {t('onboarding.verify.uploadButton')}
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,text/plain"
        className="hidden"
        onChange={handleFile}
      />
    </div>
  );
}
