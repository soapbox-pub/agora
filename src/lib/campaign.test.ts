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
});

describe('getCampaignUrl', () => {
  const campaign = makeCampaign('help-me');

  it('uses the pretty path only when the NIP-05 is verified', () => {
    expect(getCampaignUrl(campaign, 'alex@gleasonator.com', true)).toBe('/alex@gleasonator.com/help-me');
    expect(getCampaignUrl(campaign, '_@fiatjaf.com', true)).toBe('/fiatjaf.com/help-me');
  });

  it('falls back to the naddr path when unverified', () => {
    const naddrPath = `/${encodeCampaignNaddr(campaign)}`;
    // A spoofed NIP-05 must never hijack the link.
    expect(getCampaignUrl(campaign, 'attacker@evil.com', false)).toBe(naddrPath);
    // No NIP-05 at all.
    expect(getCampaignUrl(campaign, undefined, true)).toBe(naddrPath);
  });
});
