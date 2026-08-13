import { Google } from "arctic";
import { env } from "./env";

export const google = new Google(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  `${env.API_PUBLIC_URL}/auth/google/callback`,
);

export const battlenetEnabled = Boolean(env.BATTLENET_CLIENT_ID && env.BATTLENET_CLIENT_SECRET);

const BATTLENET_AUTHORIZATION_ENDPOINT = "https://oauth.battle.net/authorize";
const BATTLENET_TOKEN_ENDPOINT = "https://oauth.battle.net/token";

// `arctic` (used for Google above) has no Battle.net provider in the v2 line
// this project is pinned to -- it was only added in v3, a breaking major
// bump not worth pulling in for one extra provider. Battle.net's OAuth is a
// plain confidential-client authorization code grant with no PKCE support,
// so it's cheap to hand-roll with the same shape as arctic's own clients
// (`createAuthorizationURL` / `validateAuthorizationCode`) to keep the two
// providers symmetric in routes/auth.ts. Endpoints are the unified,
// region-less `oauth.battle.net` host documented at
// https://develop.battle.net/documentation/guides/using-oauth.
class BattleNetClient {
  constructor(
    private clientId: string,
    private clientSecret: string,
    private redirectURI: string,
  ) {}

  createAuthorizationURL(state: string): URL {
    const url = new URL(BATTLENET_AUTHORIZATION_ENDPOINT);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("state", state);
    url.searchParams.set("redirect_uri", this.redirectURI);
    return url;
  }

  async validateAuthorizationCode(code: string): Promise<{ accessToken: () => string }> {
    const body = new URLSearchParams();
    body.set("grant_type", "authorization_code");
    body.set("code", code);
    body.set("redirect_uri", this.redirectURI);
    body.set("client_id", this.clientId);
    body.set("client_secret", this.clientSecret);

    const response = await fetch(BATTLENET_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });
    if (!response.ok) {
      throw new Error(`Battle.net token exchange failed with status ${response.status}`);
    }

    const data = (await response.json()) as { access_token: string };
    return { accessToken: () => data.access_token };
  }
}

export const battlenet = battlenetEnabled
  ? new BattleNetClient(
      // Non-null: guarded by `battlenetEnabled` above.
      env.BATTLENET_CLIENT_ID as string,
      env.BATTLENET_CLIENT_SECRET as string,
      `${env.API_PUBLIC_URL}/auth/battlenet/callback`,
    )
  : null;
