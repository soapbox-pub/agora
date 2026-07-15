# Changelog

## [2.10.1] - 2026-07-15

A behind-the-scenes maintenance release with no user-facing changes.

### Fixed

- Fixed a build failure that prevented the iOS app from being published.

## [2.10.0] - 2026-07-15

Campaigns now have short, shareable links, and you can mention them by name while writing — they turn into cards right inside your posts. The home and campaigns pages are rebuilt around verified causes and curated lists, with search built in. Agora opens in light mode now, the compose box is decluttered, and signing in is one simple flow. Campaigns can accept card payments alongside Bitcoin, and your feed keeps working when the connection doesn't.

### Added

- Campaigns now have short, shareable links you can hand out anywhere, and the share button in the header copies the pretty version.
- Mention campaigns by name while you write: they autocomplete as you type and render as cards in posts and campaign stories, sitting side by side when you attach more than one.
- Campaigns can accept card payments alongside Bitcoin, and those donations count toward the campaign total.
- Search campaigns straight from the top of the campaigns page.
- Campaign lists get cover images, and the strip always shows every campaign in the list.
- A muted-content settings page to see and manage everyone you've muted.
- Signing up now walks you through verifying your key, with password-manager autofill along the way.
- Campaigns from unverified sources carry a banner, and hidden campaigns sit behind a gate.
- A revamped sponsorship page with partner and press logos.
- An Agora Funds entry in the FAQ.
- Your feed is cached on your device, so it loads instantly and survives a dropped connection.

### Changed

- Agora opens in light mode by default, with the home hero keeping its dark treatment.
- The home and campaigns pages are reorganized around verified campaigns and curated lists.
- A new brand direction built around "Give Without Borders", with a "Fundraise Without Borders" home hero.
- The compose box is decluttered: preview moved into a bottom toolbar toggle, the character count only appears as you approach the limit, and voice notes tuck into the More menu.
- Signing in is one consolidated dialog, with browser-extension login and a clearer path to creating an account.
- Editing a campaign is split into Details, Funding, and Discovery tabs.
- Verification badges now recognize reviews from any trusted reviewer, and verifying your own campaign no longer counts.
- "Open external wallet" replaces "Open Bitcoin wallet", and tells you what to do when no wallet app answers.
- Links open in an in-app browser on mobile instead of kicking you out to the share sheet.
- Muted authors no longer appear in campaign listings.
- Campaign pages drop a misleading donation count and duplicate engagement counters, and fold activity into a single stream.
- The Agora feed is now called "Latest", and says so clearly when it can't load.
- The About page is trimmed to the essentials.

### Fixed

- Campaign edits no longer revert moments after you save them.
- A newly created campaign no longer lands on a "not found" page.
- The wallet checks its inputs against the chain, so funds you've already spent can't reappear in your balance.
- Native overlays and detail pages respect the edges of your screen.
- Campaigns without a banner no longer stretch past the bottom of the screen.
- You can no longer mute yourself.
- Campaign story previews honor inline formatting.

## [2.9.3] - 2026-07-03

A behind-the-scenes maintenance release with no user-facing changes.

### Fixed

- Fixed a build failure in the Android release pipeline caused by a dependency variant conflict.

## [2.9.2] - 2026-07-02

The Venezuela earthquake relief appeal has wound down, so the home banner, popup, and relief page have been retired — relief campaigns themselves remain open for direct donations. Deleted campaigns now leave a permanent record page that preserves their donation history, and campaign creation picks up some polish: the wallet step waits until you've entered an address, and categories are capped at five.

### Added

- Deleted campaigns now show a permanent record page instead of vanishing: it notes when the organizer removed the campaign and preserves the full donation ledger when donations were recorded.

### Changed

- The campaign wizard's wallet step now stays locked until you've provided a wallet address or endpoint.
- Campaigns are limited to five category tags, with a notice when you hit the cap.
- The "Open in wallet" button no longer appears when you're viewing your own campaign.

### Removed

- The Venezuela earthquake relief appeal — the home-page banner, one-time popup, and dedicated relief page — as the relief response winds down. The relief campaigns themselves are still live and accepting donations.

## [2.9.1] - 2026-06-27

The Venezuela earthquake relief appeal now rallies behind every campaign on the ground, not just one. The home banner and relief page showcase a live, swipeable carousel of all Venezuelan relief efforts, with a running total of everything raised so far — so you can pick exactly who to help.

### Changed

- The Venezuela relief appeal now showcases every Venezuelan relief campaign in a live, auto-scrolling carousel you can swipe through, with a combined raised total across all of them, instead of featuring a single campaign.

## [2.9.0] - 2026-06-25

A big one. Private messaging arrives with a fast, searchable inbox you can reply to in your own language. Campaign organizers can now get verified by trusted reviewers through a guided sign-up, and verified badges appear right on campaigns. There's a new Venezuela earthquake relief appeal that takes you straight to donations, plus optional Tor routing on Android, separate Public and Private wallets, faster donation scanning, and refreshed profiles, settings, and login.

### Added

- Private direct messages: a dedicated inbox you can search by name, start new chats with inline recipient lookup, page back through old conversations, and read incoming messages translated into your language.
- Get verified: a guided sign-up for trusted reviewers to set up a verifier profile, publish a public "how we verify" statement, and vouch for campaigns. Verified badges now show on campaign pages, and a short tutorial walks you through it.
- A Venezuela earthquake relief appeal — a home-page banner, a one-time popup, and a shareable page that bakes in the relief campaign so you can read its story and donate without leaving.
- Optional Tor routing on Android for added privacy.
- Separate Public and Private wallets, keeping your spending and your private silent-payment funds cleanly apart.
- A "Don't have Bitcoin?" prompt on campaign pages that points first-time donors to Cash App.
- An always-visible language switcher in the top navigation, and a corporate sponsorship page.

### Changed

- Redesigned profiles with cleaner stats, a merged campaigns view, and a themed raised total.
- Redesigned Settings into an Apple-style grouped layout.
- Reworked the login and onboarding flow, including a new welcome screen built around the Agora brand.
- Silent-payment donations now scan faster and keep working in the background, with a progress bar on the private wallet.
- The home page now shows every featured campaign instead of capping the list.

### Fixed

- The audio, music, and podcast pages no longer crash.
- Backfilled and corrected translations across all sixteen languages.

## [2.8.9] - 2026-06-02

Adds an in-app prompt to grab the Android app from Zapstore, makes it easier to start or explore campaigns right from the home page, and irons out a batch of language and display fixes.

### Added

- A prompt to download the Android app from Zapstore, shown to mobile web visitors on the home page, in the account menu, and in the slide-out menu.
- A "Start a campaign" button alongside "Browse all" in the middle of the home page.

### Changed

- The "Explore campaigns" button now appears for everyone, not just logged-out visitors.

### Fixed

- Switching languages now takes effect immediately instead of showing stale text.
- The reply box and the replies heading on a post now show up in your chosen language.
- Account balances keep their Latin numerals regardless of display language.
- Filled in missing translations on the "Why Agora" screen.

## [2.8.8] - 2026-06-02

Fixes the app icon proportions and updates the loading splash to the Agora bolt.

### Fixed

- App icon no longer appears squashed.
- Loading splash now shows the Agora bolt instead of the old logo.

## [2.8.7] - 2026-06-02

Fixes the top navigation bar rendering behind the status bar on Android.

### Fixed

- Top navigation bar now clears the system status bar on Android.

## [2.8.6] - 2026-06-02

Refreshes the app icon to the orange Agora bolt mark across Android, iOS, and the web.

### Changed

- Update the app icon to the current Agora bolt on a brand-orange background.

## [2.8.5] - 2026-06-02

A maintenance release that fixes the Android build so signed releases publish correctly. No user-facing changes.

## [2.8.4] - 2026-06-02

A maintenance release that fixes the Android build so signed releases publish correctly. No user-facing changes.

## [2.8.3] - 2026-06-02

A maintenance release that fixes the Android build so signed releases publish correctly. No user-facing changes.

## [2.8.2] - 2026-06-02

A maintenance release that fixes the Android build pipeline so signed releases publish correctly. No user-facing changes.

## [2.8.1] - 2026-06-02

Agora becomes a home for putting your money where your heart is. Launch and back fundraising campaigns, rally around organizations with their own events and pledges, and send support straight from a built-in Bitcoin and Lightning wallet. Explore the world through immersive country pages, chat with a new AI agent, and move through a faster, cleaner app with a fresh look throughout.

### Added

- Fundraising campaigns as the new home surface — create, edit, and back campaigns, set goals, add beneficiaries, and follow progress.
- Organizations with their own events, pledges, members, and moderation tools.
- Built-in wallet for sending Bitcoin and Lightning payments, with transaction history and balances shown in USD.
- One-tap support: zap posts, profiles, campaigns, and organizations.
- AI agent chat with a model selector, tool-calling, and slash commands.
- Immersive country pages with anthems, flags, weather, and a country-scoped feed, plus a new Discover square for exploring the world.
- Comments and reactions on campaigns, and donation receipts shown inline.

### Changed

- Refreshed Agora branding, navigation, and app icons throughout.
- Streamlined onboarding with country and people follows.
- Polished campaign, organization, and donation flows end to end.

### Removed

- Direct messaging and ephemeral geo chat.

## [1.0.0] - 2026-04-30

### Added

- Initial Agora 3 release.
