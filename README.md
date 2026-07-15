<div align="center">

<img src="./public/logo.svg" alt="Agora" width="120" height="120" />

# Agora

### Power to the people.

**Censorship-resistant, peer-to-peer crowdfunding on Nostr and Bitcoin.**

No frozen bank accounts. No corporate shut-downs. Just direct support from people who believe in your cause.

[![Website](https://img.shields.io/badge/web-agora.spot-14161f?style=for-the-badge)](https://agora.spot)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue?style=for-the-badge)](LICENSE)
[![Bitcoin](https://img.shields.io/badge/on--chain-Bitcoin-f7931a?style=for-the-badge&logo=bitcoin&logoColor=white)](#the-wallet)
[![Nostr](https://img.shields.io/badge/protocol-Nostr-8e30eb?style=for-the-badge)](https://nostr.com)

<br />

<img src="./public/og-image.jpg" alt="Agora" width="720" />

</div>

---

## What is Agora?

Agora is a crowdfunding client for the open internet. Anyone can launch a campaign, and donors pay the campaign's **Bitcoin address directly** — funds move peer-to-peer, on-chain, with no intermediary that can freeze, seize, or reverse them.

Agora **never custodies or converts money.** It is a non-custodial user interface that connects donors and campaigns. To make that practical, it ships an integrated **non-custodial HD Bitcoin wallet** derived deterministically from your Nostr key, so you can receive, hold, and spend Bitcoin without leaving the app or trusting a third party.

> [!IMPORTANT]
> **This is not a Lightning project.** Campaign donations are strictly on-chain Bitcoin. Lightning survives only as a secondary tipping path for notes and profiles.

Built on [Nostr](https://nostr.com), campaigns are portable, permissionless events — no platform gatekeeper, no account to be deplatformed from. Agora is a fork of the [Ditto](https://gitlab.com/soapbox-pub/ditto) codebase.

<br />

<div align="center">
<img src="./public/help/step-1-account.jpg" alt="Create an account" width="240" />
&nbsp;&nbsp;
<img src="./public/help/step-2-send.jpg" alt="Donate to a campaign" width="240" />
&nbsp;&nbsp;
<img src="./public/help/step-3-spend.jpg" alt="Spend your Bitcoin" width="240" />
</div>

<div align="center"><sub><b>1.</b> Create an account &nbsp;·&nbsp; <b>2.</b> Fund a cause &nbsp;·&nbsp; <b>3.</b> Receive & spend Bitcoin</sub></div>

---

## Features

### Crowdfunding
- **On-chain campaigns** — addressable Nostr events (kind `33863`) carrying one or more Bitcoin payment endpoints
- **Direct peer-to-peer donations** — donors pay a campaign's Bitcoin address; funds never touch Agora
- **Pretty campaign URLs** — share a campaign at `agora.spot/<nip05>/<slug>`
- **Live raised totals** — computed directly from the chain, not from self-reported receipts
- **Donor receipts** — optional self-attested on-chain payment receipts (kind `8333`)
- **Community verification & moderation** — open, label-based trust model (NIP-32) for surfacing and vetting campaigns
- **Fiat on-ramp callback** — optional card-donation flow that settles to the campaign in Bitcoin

### The Wallet
A fully integrated, **non-custodial HD Bitcoin wallet** — no seed phrase to write down first, no separate app to install.

- **Deterministic from your Nostr key** — your `nsec` derives a standard BIP-39 24-word mnemonic (via HKDF), importable into Sparrow, Electrum, BlueWallet, Trezor, Ledger, and any BIP-39 wallet
- **BIP-86 Taproot** — modern single-key `bc1p…` receive addresses, fresh per receive
- **BIP-352 Silent Payments** — a static, reusable `sp1q…` address that reveals nothing on-chain
- **Two separated balances** — a **public** Taproot balance and a **private** silent-payment balance
- **Fee control** — choose fastest / half-hour / hour / economy for every send

### Social & Platform
- **Full Nostr client** — notes, articles, comments, reposts, reactions, and rich media
- **Private messaging** — NIP-04 and NIP-17 gift-wrapped DMs
- **Communities & events** — moderated communities and calendar events
- **Lightning tipping** — zaps via Nostr Wallet Connect and WebLN (tipping only — *not* campaigns)
- **Native mobile apps** — Android & iOS via Capacitor
- **Self-hostable** — static web build with configurable relays and upload servers
- **15+ languages** — Arabic, Spanish, Farsi, French, Hindi, Indonesian, Khmer, Pashto, Portuguese, Russian, Shona, Swahili, Turkish, Chinese, and more

---

## How It Works

```
   Donor                         Nostr Relays                    Campaign
     │                                │                             │
     │  1. discover campaign ─────────┤                             │
     │◀───── kind 33863 event ────────┤                             │
     │                                │                             │
     │  2. pay Bitcoin address directly (on-chain, peer-to-peer)    │
     │─────────────────────────────────────────────────────────────▶│
     │                                │                             │
     │  3. publish receipt ──────────▶│  kind 8333                  │
     │                                │                             │
                        Agora never touches the funds
```

Campaigns live as portable Nostr events. Donations are ordinary Bitcoin transactions to the campaign's address. Agora is the map and the courier — never the vault.

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 22+
- npm 10+

### Development

```sh
git clone https://gitlab.com/soapbox-pub/agora.git
cd agora
npm install
npm run dev
```

Development server: [`http://localhost:8080`](http://localhost:8080)

### Docker

Use Docker Compose for the nginx reverse-proxy stack (needed for decryptable media in NIP-17 messages):

```sh
git clone https://gitlab.com/soapbox-pub/agora.git
cd agora
cp .env.example .env
docker compose up --build
```

Proxy URL: [`http://localhost:8083`](http://localhost:8083)

Production-style container build:

```sh
docker compose -f docker-compose.prod.yml up --build
```

### Build

```sh
npm run build   # output: dist/
```

### Validate

```sh
npm test        # tsc --noEmit → eslint → vitest → vite build
```

---

## Configuration

Build-time defaults are read from `agora.json` in the repo root (gitignored, so each deployment provides its own):

```jsonc
{
  "theme": "dark",
  "relayMetadata": {
    "relays": [
      { "url": "wss://relay.ditto.pub", "read": true, "write": true },
      { "url": "wss://relay.primal.net", "read": true, "write": true },
      { "url": "wss://relay.damus.io", "read": true, "write": true }
    ]
  },
  "blossomServers": [
    "https://blossom.ditto.pub",
    "https://blossom.primal.net/"
  ]
}
```

Configuration priority (highest first):

1. User settings (local storage)
2. Build config (`agora.json`)
3. Hardcoded app defaults

Use a custom config path:

```sh
AGORA_CONFIG_FILE=./my-config.json npm run build
```

---

## Deployment

Agora builds to static files and deploys to any static host with SPA routing fallback (GitLab/GitHub Pages, Netlify, Vercel, or a plain web server).

### Android

```sh
npm run build
npx cap sync
npx cap open android
```

### iOS

```sh
npm run build
npx cap sync
npx cap open ios
```

---

## Custom Nostr Kinds

Agora defines several application-specific event kinds (fully documented in [`NIP.md`](NIP.md)):

| Kind    | Name                     | Purpose                                                        |
| ------- | ------------------------ | -------------------------------------------------------------- |
| `33863` | Campaign                 | Addressable fundraising campaign with Bitcoin payment endpoints |
| `8333`  | Onchain Zap              | Self-attested Bitcoin on-chain payment receipt                 |
| `36639` | Pledge                   | Donor pledge tied to a concrete submission                     |
| `14672` | Verifier Statement       | How an author verifies the campaigns they vouch for            |
| `30385` | Community Stats Snapshot | Pre-computed per-country and global leaderboards               |

Every first-class Agora object carries a `["t", "agora"]` tag so the activity feed can filter server-side.

---

## Tech Stack

| Layer     | Technology                                             |
| --------- | ------------------------------------------------------ |
| Framework | React 19                                               |
| Build     | Vite                                                   |
| Language  | TypeScript                                             |
| Styling   | TailwindCSS 3 + shadcn/ui                              |
| Routing   | React Router                                           |
| Data      | TanStack Query                                         |
| Nostr     | Nostrify + nostr-tools                                 |
| Bitcoin   | `@scure/btc-signer`, `@scure/bip32`, `@scure/bip39`, `@noble/curves` |
| Mobile    | Capacitor                                              |
| Testing   | Vitest + React Testing Library                         |

---

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a merge request.

## License

[AGPL-3.0](LICENSE)

<div align="center"><br /><sub>Built on <a href="https://nostr.com">Nostr</a> · Powered by <a href="https://bitcoin.org">Bitcoin</a> · A fork of <a href="https://gitlab.com/soapbox-pub/ditto">Ditto</a></sub></div>
