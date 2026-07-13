import { Capacitor } from '@capacitor/core';

/**
 * Download a text file to the user's device.
 *
 * On the web this uses the classic `<a download>` trick.
 * On native (Android & iOS) the file is saved to the app's Documents
 * directory, which is visible in the iOS Files app and Android's
 * app-scoped documents. No permissions are required.
 */
export async function downloadTextFile(filename: string, content: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');

    // Write straight to Documents — visible in the iOS Files app and
    // Android's app-scoped documents. No storage permissions needed.
    // NOTE: encoding is required — without it Capacitor expects base64 data
    // and will throw for plain-text strings.
    await Filesystem.writeFile({
      path: filename,
      data: content,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
    });
  } else {
    // Web: use the anchor-click download pattern
    const blob = new Blob([content], { type: 'text/plain; charset=utf-8' });
    const url = globalThis.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    globalThis.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }
}

/**
 * `http:` / `https:` URLs open in an in-app browser on native (Safari View
 * Controller on iOS, Chrome Custom Tab on Android); everything else — schemes
 * like `mailto:`, `lightning:`, `bitcoin:` — is handed to the OS to route to
 * the appropriate app.
 */
function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Open a URL from the app.
 *
 * On the web this opens a new browser tab. On native (Capacitor) the
 * programmatic `<a target="_blank">` click pattern doesn't work inside
 * WKWebView, so behavior depends on the URL scheme:
 *
 * - **`http:` / `https:`** open in an in-app browser (Safari View Controller
 *   on iOS, Chrome Custom Tab on Android) via `@capacitor/browser`. This is
 *   the path web links like the campaign "Pay with card" page take.
 * - **Non-web schemes** (`mailto:`, `lightning:`, `bitcoin:`, etc.) are handed
 *   to the OS via the native share sheet, letting the user route them to the
 *   appropriate app. An in-app browser can't handle these.
 */
export async function openUrl(url: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    if (isWebUrl(url)) {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url });
    } else {
      const { Share } = await import('@capacitor/share');
      await Share.share({ url });
    }
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
