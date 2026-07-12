import { describe, it, expect } from 'vitest';

import { buildAppHostDirectory } from './useAppHostDirectory';

const PUBKEY_A = 'a'.repeat(64);
const PUBKEY_B = 'b'.repeat(64);

describe('buildAppHostDirectory', () => {
  it('builds a pubkey → name reverse index', () => {
    const dir = buildAppHostDirectory({ mk: PUBKEY_A, agora: PUBKEY_B });
    expect(dir.get(PUBKEY_A)).toBe('mk');
    expect(dir.get(PUBKEY_B)).toBe('agora');
  });

  it('skips the root (_) user — it has no useful short URL', () => {
    const dir = buildAppHostDirectory({ _: PUBKEY_A });
    expect(dir.has(PUBKEY_A)).toBe(false);
  });

  it('rejects non-hex / malformed pubkey values', () => {
    const dir = buildAppHostDirectory({
      good: PUBKEY_A,
      bad: 'not-a-pubkey',
      short: 'abc',
      upper: 'A'.repeat(64), // must be lowercase hex
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      wrongType: 12345 as any,
    });
    expect(dir.get(PUBKEY_A)).toBe('good');
    expect(dir.size).toBe(1);
  });

  it('prefers the shortest name when several point at one pubkey', () => {
    const dir = buildAppHostDirectory({
      'mary-kate': PUBKEY_A,
      mk: PUBKEY_A,
      marykate: PUBKEY_A,
    });
    expect(dir.get(PUBKEY_A)).toBe('mk');
  });

  it('breaks length ties alphabetically for a stable canonical name', () => {
    const dir = buildAppHostDirectory({ bob: PUBKEY_A, ann: PUBKEY_A });
    expect(dir.get(PUBKEY_A)).toBe('ann');
  });

  it('returns an empty map for an empty names object', () => {
    expect(buildAppHostDirectory({}).size).toBe(0);
  });
});
