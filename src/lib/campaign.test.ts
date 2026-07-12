import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  normalizeCampaignNip05,
  campaignNip05Path,
  getCampaignUrl,
  parseCampaign,
  encodeCampaignNaddr,
  CAMPAIGN_KIND,
} from './campaign';

const APP_HOST = 'agora.spot';

function makeCampaign(identifier: string): NonNullable<ReturnType<typeof parseCampaign>> {
  const event: NostrEvent = {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1700000000,
    kind: CAMPAIGN_KIND,
    tags: [
      ['d', identifier],
      ['title', 'Help me fund development'],
      ['w', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'],
    ],
    content: '',
    sig: 'c'.repeat(128),
  };
  const parsed = parseCampaign(event);
  if (!parsed) throw new Error('fixture failed to parse');
  return parsed;
}

describe('normalizeCampaignNip05', () => {
  it('passes through a full user@domain identifier unchanged', () => {
    expect(normalizeCampaignNip05('alex@gleasonator.com', APP_HOST)).toBe('alex@gleasonator.com');
  });

  it('expands a bare domain to the root (_) user', () => {
    expect(normalizeCampaignNip05('fiatjaf.com', APP_HOST)).toBe('_@fiatjaf.com');
  });

  it('expands a bare local name to the app host', () => {
    expect(normalizeCampaignNip05('mk', APP_HOST)).toBe('mk@agora.spot');
  });

  it('strips a leading @ before normalizing', () => {
    expect(normalizeCampaignNip05('@mk', APP_HOST)).toBe('mk@agora.spot');
    expect(normalizeCampaignNip05('@alex@gleasonator.com', APP_HOST)).toBe('alex@gleasonator.com');
  });

  it('returns undefined for empty / whitespace-only input', () => {
    expect(normalizeCampaignNip05(undefined, APP_HOST)).toBeUndefined();
    expect(normalizeCampaignNip05('', APP_HOST)).toBeUndefined();
    expect(normalizeCampaignNip05('   ', APP_HOST)).toBeUndefined();
    expect(normalizeCampaignNip05('@', APP_HOST)).toBeUndefined();
  });
});

describe('campaignNip05Path', () => {
  it('builds /{nip05}/{d-tag} for a user@domain identifier', () => {
    expect(campaignNip05Path('alex@gleasonator.com', 'help-me')).toBe('/alex@gleasonator.com/help-me');
  });

  it('collapses a root (_@) identifier to a bare domain', () => {
    expect(campaignNip05Path('_@fiatjaf.com', 'help-me')).toBe('/fiatjaf.com/help-me');
  });

  it('drops the @host suffix for an app-host-local name', () => {
    expect(campaignNip05Path('agora@agora.spot', 'world-liberty', APP_HOST)).toBe('/agora/world-liberty');
    expect(campaignNip05Path('mk@agora.spot', 'help-me', APP_HOST)).toBe('/mk/help-me');
  });

  it('matches the app host case-insensitively when shortening', () => {
    expect(campaignNip05Path('agora@Agora.Spot', 'x', APP_HOST)).toBe('/agora/x');
  });

  it('does not shorten a foreign host even when appHost is given', () => {
    expect(campaignNip05Path('alex@gleasonator.com', 'x', APP_HOST)).toBe('/alex@gleasonator.com/x');
  });

  it('collapses the root user on the app host to the bare host (not /_ )', () => {
    // `_` is never shortened to a local name; it still collapses via the _@ rule.
    expect(campaignNip05Path('_@agora.spot', 'x', APP_HOST)).toBe('/agora.spot/x');
  });
});

describe('getCampaignUrl', () => {
  const campaign = makeCampaign('help-me');
  const naddrPath = `/${encodeCampaignNaddr(campaign)}`;

  it('uses the pretty path only when the NIP-05 is verified', () => {
    expect(getCampaignUrl(campaign, { nip05: 'alex@gleasonator.com', nip05Verified: true }))
      .toBe('/alex@gleasonator.com/help-me');
    expect(getCampaignUrl(campaign, { nip05: '_@fiatjaf.com', nip05Verified: true }))
      .toBe('/fiatjaf.com/help-me');
  });

  it('shortens a verified host-local NIP-05 against appHost', () => {
    expect(getCampaignUrl(campaign, { nip05: 'agora@agora.spot', nip05Verified: true, appHost: APP_HOST }))
      .toBe('/agora/help-me');
  });

  it('falls back to the naddr path when unverified', () => {
    // A spoofed NIP-05 must never hijack the link.
    expect(getCampaignUrl(campaign, { nip05: 'attacker@evil.com', nip05Verified: false })).toBe(naddrPath);
    // No NIP-05 at all.
    expect(getCampaignUrl(campaign, { nip05: undefined, nip05Verified: true })).toBe(naddrPath);
    // Nothing supplied.
    expect(getCampaignUrl(campaign)).toBe(naddrPath);
  });

  it('lets the app-host directory name override a foreign verified kind-0 NIP-05', () => {
    expect(getCampaignUrl(campaign, {
      nip05: 'alex@gleasonator.com',
      nip05Verified: true,
      directoryName: 'mk',
      appHost: APP_HOST,
    })).toBe('/mk/help-me');
  });

  it('ignores the directory name without an appHost to build the URL against', () => {
    // Can't safely shorten without knowing the host; fall through to verified nip05.
    expect(getCampaignUrl(campaign, {
      nip05: 'alex@gleasonator.com',
      nip05Verified: true,
      directoryName: 'mk',
    })).toBe('/alex@gleasonator.com/help-me');
  });
});
