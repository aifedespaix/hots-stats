export interface AuthorizeParams {
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  deviceName: string;
}

export type ReadAuthorizeResult = { ok: true; params: AuthorizeParams } | { ok: false; reason: string };

/** base64url of a SHA-256 digest: 43 characters, URL-safe alphabet. */
const BASE64URL_43_128 = /^[A-Za-z0-9_-]{43,128}$/;

/**
 * Mirrors the API's rule closely enough to hide the action buttons for a
 * link that could never work; the API still re-validates and is the
 * authority. Kept in sync by hand -- see the C1 design doc.
 */
export function isPlausibleLoopbackRedirect(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return (
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
    url.port !== "" &&
    url.pathname === "/callback" &&
    url.search === "" &&
    url.hash === ""
  );
}

export function readAuthorizeParams(query: Record<string, unknown>): ReadAuthorizeResult {
  const redirectUri = typeof query.redirectUri === "string" ? query.redirectUri : "";
  const state = typeof query.state === "string" ? query.state : "";
  const codeChallenge = typeof query.codeChallenge === "string" ? query.codeChallenge : "";
  const method = typeof query.codeChallengeMethod === "string" ? query.codeChallengeMethod : "S256";
  const rawDeviceName = typeof query.deviceName === "string" ? query.deviceName.trim() : "";
  const deviceName = rawDeviceName ? rawDeviceName.slice(0, 64) : "Daemon";

  if (!isPlausibleLoopbackRedirect(redirectUri)) {
    return { ok: false, reason: "L'adresse de redirection est invalide." };
  }
  if (state.length < 8 || state.length > 128) {
    return { ok: false, reason: "Le paramètre de sécurité (state) est invalide." };
  }
  if (!BASE64URL_43_128.test(codeChallenge)) {
    return { ok: false, reason: "Le défi PKCE est invalide." };
  }
  if (method !== "S256") {
    return { ok: false, reason: "Méthode PKCE non supportée." };
  }

  return {
    ok: true,
    params: { redirectUri, state, codeChallenge, codeChallengeMethod: "S256", deviceName },
  };
}

export function buildCancelUrl(redirectUri: string, state: string): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", "access_denied");
  url.searchParams.set("state", state);
  return url.toString();
}
