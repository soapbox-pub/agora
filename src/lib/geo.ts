/**
 * Best-effort IP geolocation, used only to reorder and dim region-locked
 * suggestions (e.g. the "Don't have Bitcoin?" on-ramp list). It is a soft
 * hint: a wrong or missing answer just means nothing gets dimmed, and every
 * suggestion stays clickable regardless.
 *
 * We query GeoJS, a free no-key CORS endpoint that returns only the coarse
 * country of the caller's IP. Any failure resolves to `undefined` rather
 * than throwing, so callers can treat "unknown" as "show everything".
 */
export async function fetchUserCountry(signal?: AbortSignal): Promise<string | undefined> {
  try {
    const res = await fetch('https://get.geojs.io/v1/ip/country.json', { signal });
    if (!res.ok) return undefined;
    const data: unknown = await res.json();
    const country = (data as { country?: unknown } | null)?.country;
    if (typeof country !== 'string') return undefined;
    const code = country.toUpperCase();
    return /^[A-Z]{2}$/.test(code) ? code : undefined;
  } catch {
    // Network error, abort, CORS, blocked request — all non-fatal here.
    return undefined;
  }
}
