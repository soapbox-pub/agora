import { useQuery } from '@tanstack/react-query';

import { AGORA_HOST } from '@/lib/appUrls';

/**
 * Reverse-lookup map from hex pubkey → local NIP-05 name, built from the
 * app's own `/.well-known/nostr.json`.
 */
export type AppHostDirectory = Map<string, string>;

/**
 * Build a pubkey → name reverse index from a NIP-05 `names` object.
 *
 * - Only well-formed 64-char lowercase hex pubkeys are indexed (a broken
 *   directory can't inject arbitrary strings into our URL builder).
 * - The root user (`_`) is skipped — it has no useful short URL (a bare
 *   `_` name would build `/_/…`, which the resolver can't distinguish
 *   from a real local name).
 * - When several names point at the same pubkey, the shortest wins (ties
 *   broken alphabetically) so the canonical link is stable and terse.
 */
export function buildAppHostDirectory(names: Record<string, unknown>): AppHostDirectory {
  const byPubkey: AppHostDirectory = new Map();

  for (const [name, value] of Object.entries(names)) {
    if (name === '_') continue;
    if (typeof value !== 'string') continue;
    if (!/^[0-9a-f]{64}$/.test(value)) continue;

    const existing = byPubkey.get(value);
    if (
      existing === undefined ||
      name.length < existing.length ||
      (name.length === existing.length && name < existing)
    ) {
      byPubkey.set(value, name);
    }
  }

  return byPubkey;
}

async function fetchAppHostDirectory(signal: AbortSignal): Promise<AppHostDirectory> {
  const url = new URL('/.well-known/nostr.json', `https://${AGORA_HOST}`);

  let data: unknown;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
    });
    if (!response.ok) return new Map();
    data = await response.json();
  } catch {
    // Network error, CORS rejection, timeout, or non-JSON body — the
    // override feature simply stays off; links fall back to kind-0 nip05
    // verification / naddr.
    return new Map();
  }

  if (typeof data !== 'object' || data === null) return new Map();
  const names = (data as { names?: unknown }).names;
  if (typeof names !== 'object' || names === null) return new Map();

  return buildAppHostDirectory(names as Record<string, unknown>);
}

/**
 * Fetch the app's own `/.well-known/nostr.json` once and expose a
 * pubkey → local-name reverse index.
 *
 * The app server is authoritative for its own directory, so a pubkey found
 * here is trusted to link at `/{name}/…` without per-link NIP-05
 * verification — see {@link useCampaignUrl} for how the override slots in
 * ahead of the author's self-declared kind-0 NIP-05.
 *
 * Backed by a single long-lived TanStack Query entry (stable key,
 * `staleTime: Infinity`), so mounting hundreds of campaign cards triggers
 * exactly one network request that is shared across every consumer.
 */
export function useAppHostDirectory() {
  return useQuery<AppHostDirectory>({
    queryKey: ['app-host-directory', AGORA_HOST],
    queryFn: ({ signal }) => fetchAppHostDirectory(signal),
    staleTime: Infinity,
    gcTime: Infinity,
    // A failed fetch means "no directory" (empty map), not an error state —
    // don't retry-storm the app server on every card.
    retry: false,
  });
}
