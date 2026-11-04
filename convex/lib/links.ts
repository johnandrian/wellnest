// Links Wellnest hands out (share links, care circle invites): an unguessable token, on the app's public address.
// APP_URL is the custom domain (https://talktothebeak.health); without it, the deployment's .convex.site URL.

export function newToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const appUrl = () => (process.env.APP_URL || process.env.CONVEX_SITE_URL || "").replace(/\/$/, "");
