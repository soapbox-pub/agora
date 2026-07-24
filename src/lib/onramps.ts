/**
 * Curated Bitcoin on-ramps surfaced in the "Don't have Bitcoin?" dialog,
 * with a coarse, best-effort model of where each one operates.
 *
 * The regional data is intentionally approximate. It only drives a soft UI
 * hint — available services float to the top, others render dimmed — and
 * every entry stays clickable no matter what, because our IP guess can be
 * wrong (VPNs, travel, stale coverage lists). Treat "unavailable" as "we
 * think this probably won't work where you are", never as a hard block.
 */

export type OnrampRegion =
  | 'NORTH_AMERICA'
  | 'EUROPE'
  | 'OCEANIA'
  | 'LATAM'
  | 'AFRICA'
  | 'SEA';

/** Countries we bucket into each region, by ISO 3166-1 alpha-2 code. */
const REGION_MEMBERS: Record<OnrampRegion, string[]> = {
  NORTH_AMERICA: ['US', 'CA'],
  OCEANIA: ['AU', 'NZ'],
  EUROPE: [
    'GB', 'IE', 'FR', 'DE', 'ES', 'PT', 'IT', 'NL', 'BE', 'LU', 'AT', 'CH',
    'SE', 'NO', 'DK', 'FI', 'IS', 'PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'GR',
    'HR', 'SI', 'EE', 'LV', 'LT', 'CY', 'MT', 'LI', 'MC', 'AD', 'SM',
  ],
  LATAM: [
    'MX', 'BR', 'AR', 'CL', 'CO', 'PE', 'UY', 'PY', 'BO', 'EC', 'VE', 'GT',
    'CR', 'PA', 'DO', 'SV', 'HN', 'NI',
  ],
  AFRICA: [
    'NG', 'ZA', 'KE', 'GH', 'UG', 'TZ', 'ZM', 'CM', 'CI', 'SN', 'RW', 'ET',
    'EG', 'MA', 'DZ', 'TN', 'CD', 'AO', 'MZ', 'ZW', 'BW', 'NA', 'ML', 'BF',
    'BJ', 'TG', 'NE', 'GN', 'SL', 'LR', 'GM', 'MW', 'MG', 'MU',
  ],
  SEA: ['PH', 'ID', 'MY', 'TH', 'VN', 'SG', 'KH'],
};

/** Inverted lookup: ISO country code to its region. */
const REGION_BY_COUNTRY: Record<string, OnrampRegion> = (() => {
  const map: Record<string, OnrampRegion> = {};
  for (const region of Object.keys(REGION_MEMBERS) as OnrampRegion[]) {
    for (const cc of REGION_MEMBERS[region]) map[cc] = region;
  }
  return map;
})();

/** The region we bucket a country into, or `undefined` if we don't map it. */
export function regionOf(countryCode: string | undefined): OnrampRegion | undefined {
  if (!countryCode) return undefined;
  return REGION_BY_COUNTRY[countryCode.toUpperCase()];
}

interface OnrampAvailability {
  /** Available everywhere (global exchanges, P2P markets). */
  global?: boolean;
  /** Available only in these regions. */
  regions?: OnrampRegion[];
  /** Available only in these exact countries (overrides `regions`/`global`). */
  onlyCountries?: string[];
  /** Excluded countries, even where a region/global rule would allow it. */
  exceptCountries?: string[];
}

export interface Onramp {
  id: string;
  /** Brand name — a proper noun, never translated. */
  name: string;
  /** External signup / purchase URL (https). */
  url: string;
  /**
   * i18n key (under `noBitcoin.onramp`) for the one-line descriptor shown
   * beneath the name, e.g. "Global exchange" or "Africa".
   */
  descKey: string;
  /** Brand color for the monogram tile background. */
  color: string;
  /** Tile foreground (monogram) color. Defaults to white. */
  fg?: string;
  /** Optional real logo (root-absolute path); falls back to a monogram. */
  logo?: string;
  availability: OnrampAvailability;
}

/**
 * Ordered by rough global reach so that, when we can't detect a region, the
 * broadly-available options lead. Region filtering re-sorts at render time.
 */
export const ONRAMPS: Onramp[] = [
  {
    id: 'binance',
    name: 'Binance',
    url: 'https://www.binance.com/en/how-to-buy/bitcoin',
    descKey: 'descGlobalExchange',
    color: '#F3BA2F',
    fg: '#181A20',
    availability: { global: true, exceptCountries: ['US', 'CA'] },
  },
  {
    id: 'coinbase',
    name: 'Coinbase',
    url: 'https://www.coinbase.com/how-to-buy/bitcoin',
    descKey: 'descGlobalExchange',
    color: '#0052FF',
    availability: { regions: ['NORTH_AMERICA', 'EUROPE', 'OCEANIA', 'LATAM'] },
  },
  {
    id: 'kraken',
    name: 'Kraken',
    url: 'https://www.kraken.com/learn/buy-bitcoin-btc',
    descKey: 'descGlobalExchange',
    color: '#6E4FE9',
    availability: { regions: ['NORTH_AMERICA', 'EUROPE', 'OCEANIA'] },
  },
  {
    id: 'strike',
    name: 'Strike',
    url: 'https://strike.me',
    descKey: 'descBitcoinApp',
    color: '#111827',
    availability: { global: true },
  },
  {
    id: 'cashapp',
    name: 'Cash App',
    url: 'https://cash.app',
    descKey: 'descBitcoinApp',
    color: '#00D632',
    logo: '/cashapp.svg',
    availability: { onlyCountries: ['US', 'GB'] },
  },
  {
    id: 'bitso',
    name: 'Bitso',
    url: 'https://bitso.com',
    descKey: 'descLatam',
    color: '#12A594',
    availability: { onlyCountries: ['MX', 'AR', 'BR', 'CO'] },
  },
  {
    id: 'bitnob',
    name: 'Bitnob',
    url: 'https://bitnob.com',
    descKey: 'descAfrica',
    color: '#00C48C',
    availability: { regions: ['AFRICA'] },
  },
  {
    id: 'vexl',
    name: 'Vexl',
    url: 'https://vexl.it',
    descKey: 'descP2p',
    color: '#F7C93E',
    fg: '#1A1A1A',
    availability: { regions: ['EUROPE'] },
  },
  {
    id: 'yellowcard',
    name: 'Yellow Card',
    url: 'https://yellowcard.io',
    descKey: 'descAfrica',
    color: '#E8B800',
    fg: '#1A1A1A',
    availability: { regions: ['AFRICA'] },
  },
  {
    id: 'luno',
    name: 'Luno',
    url: 'https://www.luno.com',
    descKey: 'descAfrica',
    color: '#0B63CE',
    availability: { regions: ['AFRICA', 'SEA', 'EUROPE'] },
  },
  {
    id: 'coindcx',
    name: 'CoinDCX',
    url: 'https://coindcx.com',
    descKey: 'descIndia',
    color: '#6434FC',
    availability: { onlyCountries: ['IN'] },
  },
  {
    id: 'coinsph',
    name: 'Coins.ph',
    url: 'https://coins.ph',
    descKey: 'descPhilippines',
    color: '#005CE6',
    availability: { onlyCountries: ['PH'] },
  },
  {
    id: 'hodlhodl',
    name: 'Hodl Hodl',
    url: 'https://hodlhodl.com',
    descKey: 'descP2p',
    color: '#FF6600',
    availability: { global: true },
  },
  {
    id: 'robosats',
    name: 'RoboSats',
    url: 'https://robosats.org',
    descKey: 'descP2p',
    color: '#F7931A',
    availability: { global: true },
  },
];

/**
 * Whether we believe `onramp` operates for a user in `countryCode`.
 *
 * An unknown country (detection off, loading, or failed) returns `true` for
 * everything: with no signal we don't dim anything. This is only ever a
 * hint — callers keep unavailable entries clickable.
 */
export function isOnrampAvailable(onramp: Onramp, countryCode: string | undefined): boolean {
  if (!countryCode) return true;
  const cc = countryCode.toUpperCase();
  const { global, regions, onlyCountries, exceptCountries } = onramp.availability;

  if (onlyCountries) return onlyCountries.includes(cc);
  if (exceptCountries?.includes(cc)) return false;
  if (global) return true;

  const region = regionOf(cc);
  return !!region && !!regions?.includes(region);
}
