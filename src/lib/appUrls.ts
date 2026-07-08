/** Canonical public origin for links that should open the production Agora app. */
export const AGORA_ORIGIN = 'https://agora.spot';

/** Hostname for platform integrations that require a domain instead of an origin. */
export const AGORA_HOST = new URL(AGORA_ORIGIN).hostname;

/** Build a public Agora URL from a root-relative path or bare path segment. */
export function buildAgoraUrl(path = ''): string {
  const normalizedPath = path ? `/${path.replace(/^\/+/, '')}` : '';
  return `${AGORA_ORIGIN}${normalizedPath}`;
}

/** NIP-19 bech32 entity prefixes that Agora routes at the URL root (`/:nip19`). */
const NIP19_ROOT_PREFIXES = ['npub', 'nprofile', 'note', 'nevent', 'naddr'] as const;

/**
 * Hostnames that resolve to the Agora app. Includes the canonical public
 * origin plus the local dev/preview host so pasted links from any Agora
 * environment collapse to a `nostr:` URI. `nsec1` links are intentionally
 * excluded — a secret key in a URL is never rewritten (and never rendered).
 */
const AGORA_HOSTNAMES = new Set([AGORA_HOST, 'localhost', '127.0.0.1']);

/**
 * If `url` is an Agora app link whose path is a single NIP-19 identifier
 * (e.g. `https://agora.spot/naddr1…`), return the bare bech32 identifier
 * (`naddr1…`). Otherwise return `undefined`.
 *
 * Matches the root-level `/:nip19` route contract (see `nip19-routing`
 * skill): only npub/nprofile/note/nevent/naddr are recognized, and only
 * when they are the sole, top-level path segment. Query strings and
 * fragments are ignored. `nsec1` is never matched.
 */
export function extractAgoraNip19(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
  if (!AGORA_HOSTNAMES.has(parsed.hostname)) return undefined;

  // Single path segment only: strip the leading slash and reject anything
  // with a nested path (`/naddr1…/foo`).
  const segment = parsed.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!segment || segment.includes('/')) return undefined;

  const lower = segment.toLowerCase();
  const isNip19 = NIP19_ROOT_PREFIXES.some(
    (prefix) => lower.startsWith(prefix + '1'),
  );
  if (!isNip19) return undefined;

  // Bech32 charset guard so query-less garbage doesn't slip through.
  if (!/^[a-z0-9]+$/.test(lower)) return undefined;

  return segment;
}

/**
 * Rewrite every Agora `/:nip19` app link in a block of text into its
 * canonical `nostr:` URI. Non-Agora URLs and Agora links that aren't a
 * bare NIP-19 identifier are left untouched. Idempotent — running it over
 * already-rewritten text is a no-op because `nostr:` URIs aren't URLs the
 * matcher recognizes.
 */
export function rewriteAgoraLinksToNostrUris(text: string): string {
  return text.replace(/https?:\/\/[^\s<>()]+/gi, (match) => {
    // Preserve trailing punctuation that's likely not part of the URL.
    const trailingMatch = match.match(/^(.*?)([.,;:!?)\]]+)$/);
    const core = trailingMatch ? trailingMatch[1] : match;
    const trailing = trailingMatch ? trailingMatch[2] : '';

    const nip19 = extractAgoraNip19(core);
    if (!nip19) return match;
    return `nostr:${nip19}${trailing}`;
  });
}
