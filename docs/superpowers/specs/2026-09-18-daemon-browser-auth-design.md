# Daemon Browser-Based Authorization — Design (C1)

**Statut :** implémenté (branche `feat/daemon-browser-auth`, 2026-09-20). A1
(table + endpoints), A2 (page de consentement, noms de tokens) et A3 (bouton
daemon, fallback manuel) sont couverts par les tests `bun test apps/api`,
`bun run --filter './apps/web' test` et `pytest`. Vérification manuelle du
parcours navigateur (Step 6 du plan) non réalisée dans cette session.

## Context

Today, connecting the daemon to a site account means: install the daemon, open the web
`/upload` page, sign in, click "Créer un token", copy the secret, paste it into the daemon's
masked "Token d'accès" field. The secret crosses the clipboard and the user leaves the daemon
mid-onboarding.

What already exists and makes a better flow cheap:

- `routes/tokens.ts`: `GET/POST /tokens`, `POST /tokens/:id/renew`, `DELETE /tokens/:id`,
  all session-cookie authenticated via `authSession` + `requireUser`. Creation is
  zero-friction (no name, no body) and the raw token is returned exactly once.
- Session cookie `hots_session` is a 30-day HS256 JWT (`lib/session.ts`), so the browser is
  already authenticated when the daemon sends the user there.
- PAT format `hots_pat_<64 hex>`, stored only as `sha256` (`lib/tokens.ts`,
  `middleware/auth-token.ts`), revocable, with `lastUsedAt`.
- `gui.py`'s Connexion section already links to the web settings page via
  `urls.guess_settings_url()`, which derives the dashboard host from the API host
  (`api-hots-stats.…` -> `hots-stats.…`, `api.…` -> `app.…`).
- `GET /health` (`routes/health.ts`) is public and already pinged by the daemon's connection
  check, so it is the natural place to advertise the web origin before the daemon holds any
  credential.

## Goal

"Connecter ce PC": one click in the daemon, one confirmation in the browser, and the daemon
holds a normal PAT. No copy/paste, no secret in a URL, no new credential type. The resulting
token is identifiable by machine name and revocable from the existing token list.

## Non-goals

- Replacing PAT as the daemon credential (no OAuth client, no refresh token).
- Changing the web session/JWT scheme or the Google/Battle.net login providers.
- A device-code flow in phase 1 (kept as the documented fallback if loopback is blocked by
  policy — see Decisions).
- Auto-updating the daemon's token if the user revokes it; revocation still surfaces as the
  existing 401 -> "Access token was rejected".

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Loopback redirect + authorization code + PKCE (S256) | Standard for native/CLI clients. Keeps the secret out of the browser's URL bar and history. No new credential type: the code is exchanged for an ordinary PAT. |
| 2 | Code is short-lived (60 s) and single-use | The loopback redirect URL can land in history/logs; a one-shot code narrows the window to near zero. |
| 3 | `redirectUri` restricted to `http://127.0.0.1[:port]/callback` or `http://localhost[:port]/callback` | Prevents the consent page from being turned into an open redirect. Never `https`, never a non-loopback host, never a different path. |
| 4 | The PAT is named `Daemon — <hostname>` | Appears in the existing token list; `TokenManager` currently shows only `createdAt`, so C1 also adds the name to the list (see Web). |
| 5 | Manual token entry is kept, demoted to an "Avancé" disclosure; `HOTS_ACCESS_TOKEN` keeps working | Escape hatch for dev/CI/offline/self-hosted setups and for loopback-blocked environments. |
| 6 | The daemon persists through its normal Save path | The window already validates (API reachable, token accepted) before writing. Auto-saving on authorization success would bypass that; the connect button fills the token and the existing Save commits it. C2 turns this into a wizard step. |
| 7 | PKCE failure, expiry, unknown code and replay all return the same `{ error: "invalid_grant" }` | No oracle for probing which part failed. |
| 8 | `webOrigin` is advertised on the public `GET /health` | The daemon needs the **web** origin to open the consent page, and it has no token yet. `guess_web_base_url()` remains the fallback for an older API. |

### Accepted risk: local port hijack

Any loopback-redirect flow is exposed to a malicious local process racing for the callback
port. Mitigations here: the port is ephemeral and bound before the browser opens, the consent
screen states the target machine and requires an explicit click, the code is bound to the
PKCE challenge, and its TTL is 60 s. This is the same risk profile as `gcloud`/`gh`/`az`
login and is accepted deliberately.

### Decision 9: no device-code flow in phase 1

A device-code flow (daemon displays a code, user types it at `/daemon`) needs no local
listener and survives a loopback-hostile environment, but costs the user real typing for a
scenario that has not been observed. The API shape below leaves room for it later: the
`daemon_authorization_codes` row is independent of how the code reaches the user.

## Flow

```
 daemon (127.0.0.1:P)             web (WEB_ORIGIN)                 API
        |                                |                          |
  1. bind P, PKCE, state                 |                          |
  2. open browser ---------------------->|                          |
     /daemon/authorize?redirect_uri=...  |                          |
        |                                | 3. consent (cookie)      |
        |                                | POST /auth/daemon/authorize
        |                                |------------------------->|
        |                                |        { code, redirectUrl }
        |                                |<-------------------------|
  4. <-- GET http://127.0.0.1:P/callback?code=...&state=... --------|
        |  (top-level navigation, no CORS)
  5. state ok -> POST /auth/daemon/token { code, codeVerifier } --->|
        |<-- { token } ---------------------------------------------|
  6. render "connecté", shutdown P       |                          |
```

## API

### New table `daemon_authorization_codes`

New file `packages/db/src/schema/daemon-authorization-codes.ts`, exported from
`schema/index.ts`, with a generated Drizzle migration.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk default `gen_random_uuid()` | |
| `userId` | uuid not null -> `users.id`, cascade delete | owner of the future PAT |
| `codeHash` | text not null unique | `sha256(code)`; the raw code is never stored |
| `codeChallenge` | text not null | S256 challenge, base64url |
| `codeChallengeMethod` | text not null default `'S256'` | forward-compatible |
| `redirectUri` | text not null | validated loopback `/callback` |
| `deviceName` | text | sanitized hostname, shown on the consent screen |
| `tokenName` | text not null | label given to the minted PAT |
| `createdAt` | timestamptz not null default now() | |
| `expiresAt` | timestamptz not null | `createdAt + 60s` |
| `consumedAt` | timestamptz | set exactly once, on successful exchange |

Index on `(expiresAt)` for cleanup, plus `(userId, createdAt)` if a per-user cap is added.

### `GET /health` — add `webOrigin`

`{ status: "ok", webOrigin: env.WEB_ORIGIN }`. Public, no auth. Used by the daemon before it
holds a token.

### `POST /auth/daemon/authorize` — session auth

New route file `apps/api/src/routes/daemon-auth.ts`, mounted in `index.ts` as
`app.route("/auth/daemon", daemonAuthRoute)`. This endpoint uses `authSession` +
`requireUser`; the exchange endpoint below is public.

Request (zod-validated body):

```ts
{
  redirectUri: string,         // must parse to http://127.0.0.1[:port]/callback | http://localhost[:port]/callback
  state: string,               // 8..128 chars
  codeChallenge: string,       // base64url, 43..128 chars
  codeChallengeMethod: "S256", // only S256 accepted
  deviceName?: string          // 1..64 chars after sanitization; default "Daemon"
}
```

Behavior:

1. Validate the body; 400 with a field-level error otherwise.
2. Re-parse `redirectUri` with `new URL`: protocol must be `http:`, hostname must be
   `127.0.0.1` or `localhost`, pathname must be exactly `/callback`. Anything else -> 400.
3. Rate-limit per user (see Rate limiting).
4. Generate the code: `randomBytes(32).toString("base64url")`. Store only `sha256(code)`,
   with `expiresAt = now + 60s` and `tokenName = "Daemon — " + deviceName`.
5. Opportunistically delete this user's expired/consumed rows older than 10 minutes (cheap,
   keeps the table from needing a job; C4 adds a job if volume ever warrants one).
6. Respond `201 { code, expiresAt, redirectUrl }` where `redirectUrl` is `redirectUri` with
   `?code=...&state=...` appended via `URL.searchParams`.

### `POST /auth/daemon/token` — public

Request: `{ code: string, codeVerifier: string }`.

Behavior:

1. Look up by `codeHash = sha256(code)`.
2. Reject unless the row exists, `consumedAt IS NULL` and `expiresAt > now()`.
3. Verify PKCE: `base64url(sha256(codeVerifier)) === codeChallenge`, compared with
   `timingSafeEqual` on equal-length buffers.
4. **Atomically consume**: `UPDATE ... SET consumedAt = now() WHERE id = $1 AND consumedAt
   IS NULL RETURNING ...`. If nothing is returned, another caller won the race ->
   `invalid_grant`.
5. Mint the PAT with the existing helpers (`generatePersonalAccessToken`, `hashToken`) and
   insert into `personalAccessTokens` with `name = row.tokenName`.
6. Respond `201 { token, tokenId, createdAt, tokenName }`. The raw token appears here for the
   first and only time.
7. Every rejection path responds `400 { error: "invalid_grant" }` (Decision 7).

### Rate limiting

No limiter exists in the API today. Add a minimal in-memory fixed-window limiter
(`apps/api/src/lib/rate-limit.ts`) and apply it to `/auth/daemon/token` keyed by client IP
(e.g. 20 requests / 5 min) and to `/auth/daemon/authorize` keyed by `userId` (e.g. 10 / min).
Document in the code that it is per-process and therefore approximate behind multiple
instances — acceptable for this deployment, and the real backstop is the 60 s single-use code.

## Web

### New page `apps/web/app/pages/daemon/authorize.vue`

- `definePageMeta({ middleware: "auth" })` — an unauthenticated visitor is sent to login and
  returns here afterwards.
- Reads `redirectUri`, `state`, `codeChallenge`, `codeChallengeMethod`, `deviceName` from the
  route query and validates them client-side before offering any action.
- Consent card, in French, stating plainly: this will let a daemon on **this machine**
  (`<deviceName>`, `127.0.0.1:<port>`) upload your replays; only continue if you just clicked
  "Connecter ce PC" in that daemon. Buttons: **Autoriser ce PC** (primary) and **Annuler**
  (ghost).
- On approve: call `useDaemonAuthorization().authorize(...)` ->
  `POST /auth/daemon/authorize` -> `window.location.href = redirectUrl`.
- On cancel: navigate to `redirectUri` with `error=access_denied&state=...` appended, so the
  daemon stops waiting immediately instead of timing out.
- On failure (invalid params, API error): an error card with no action buttons.
- A short "Comment révoquer" footnote pointing at the token list.

### `TokenManager` / `TokenCard` show the device

`GET /tokens` currently selects only `id`, `lastUsedAt`, `createdAt`. Add `name` to the
select and render it in `TokenCard.vue` as the primary label ("Daemon — DESKTOP-ABC"), with
`createdAt` and "dernière utilisation : <lastUsedAt>" as secondary lines. This fixes the
existing wall-of-timestamps and makes the machine revocable at a glance. `name` is already
non-null and already generated server-side (`timestampedTokenName`), so no migration.

### Onboarding copy

`DaemonOnboarding.vue`'s "Récupérer mon token" button becomes "Connecter mon daemon" and
points at a short explanation of the one-click flow, with the manual-token instructions kept
in a collapsible "ça n'a pas marché ?" section.

## Daemon

### `src/urls.py`

- `guess_web_base_url(api_base_url) -> str`: the same host derivation as
  `guess_settings_url`, but returning the origin (no `/settings`), defaulting to the
  production dashboard. `guess_settings_url` is re-expressed in terms of it.
- `daemon_authorize_url(web_base_url) -> str`: `{web_base}/daemon/authorize`.

### `src/auth_flow.py` (new)

Public surface:

```python
`dataclass(frozen=True)
class AuthorizationResult:
    token: str | None
    error: str | None          # human-readable French message for the UI

def request_authorization(
    *,
    api_base_url: str,
    web_base_url: str | None = None,
    device_name: str | None = None,
    timeout: float = 180.0,
    cancel_event: threading.Event | None = None,
) -> AuthorizationResult: ...
```

Internals:

- `_PkcePair`: `code_verifier = secrets.token_urlsafe(64)`;
  `code_challenge = base64url(sha256(verifier))` with padding stripped.
- `_LoopbackReceiver`: `http.server.HTTPServer` bound to `("127.0.0.1", 0)`; a one-shot
  `do_GET` that accepts only `/callback`, captures `code`/`state`/`error`, responds with a
  small self-contained HTML "✅ Daemon connecté, vous pouvez fermer cet onglet" (no external
  assets), sets an event, and shuts the server down. Any other path -> 404.
- `request_authorization` sequence: resolve the web origin (prefer the `webOrigin` advertised
  by `GET /health`, fall back to `guess_web_base_url`); bind the receiver to get the port;
  build the authorize URL; `webbrowser.open(...)`; wait on the receiver event, the cancel
  event, or the timeout; on `error=access_denied` return that message; on a valid `code` with
  a matching `state` POST `{code, codeVerifier}` to `{api}/auth/daemon/token` and return the
  token.
- Never raises: every failure path returns an `AuthorizationResult` with a French `error`.
  A `state` mismatch and unexpected paths are failures, not acceptances.
- Thread-safe and cancellable; the server is always shut down in a `finally` so no port leak
  survives a failed attempt.

### `src/api_client.py`

- Add `post_daemon_token(base_url, code, code_verifier, timeout=15) -> str | None` (plain
  `requests`, no auth header) and `fetch_web_origin(base_url) -> str | None` reading
  `GET /health`. Both best-effort, like the existing `ping_health`/`fetch_version` helpers.

### `src/gui.py` Connexion section

- The token field and its "Générer / gérer mon token ->" link move into a collapsible
  **Avancé : coller un token manuellement** block.
- New primary action above it: **Connecter ce PC via le navigateur** (Accent button), plus a
  status line cycling through: idle -> "Ouverture du navigateur…" -> "En attente de votre
  autorisation dans le navigateur…" (with an **Annuler** ghost button) -> "✓ Connecté :
  <nom du token>" / "✗ Autorisation refusée" / "✗ Délai dépassé — réessayer".
- The work runs on a worker thread; results post back with `root.after`, matching the module's
  existing threading contract. `_on_close` sets the cancel event so closing the window aborts
  a pending authorization and frees the port.
- If `webbrowser.open` fails or the browser did not come up, a "Copier le lien" button and an
  "Ouvrir à nouveau" action appear once the flow is waiting.
- On success the token variable is filled and the existing debounced connection check runs,
  so the user sees the green token indicator before saving.

### No config-format change

The token still lives in `config.json`'s `accessToken` and `HOTS_ACCESS_TOKEN` still wins.
Nothing downstream of `Config.access_token` changes.

## Error handling

- Daemon: `request_authorization` never raises and never blocks the Tk thread; all OS/network
  errors become an `AuthorizationResult.error`.
- API: invalid body -> 400 field errors; `invalid_grant` for every exchange failure; 429 when
  rate-limited.
- Web: invalid query params render an inert error card; a failed authorize call shows the API
  message and an "Annuler" path so the daemon is released.

## Testing

Daemon (`daemon-python/tests/test_auth_flow.py`, mocks for `webbrowser` and a local HTTP
server; follow the existing `test_api_client.py` style):

- PKCE challenge derivation against the RFC 7636 test vector.
- Successful callback -> token returned and the exchange POST made with the right body.
- `state` mismatch -> rejected, no exchange.
- `error=access_denied` -> French refusal message, no exchange.
- Timeout and cancel-event paths return errors and always release the socket.
- Non-`/callback` paths are ignored.

API (`apps/api/src/routes/daemon-auth.test.ts` or the repo's existing API test style):

- `authorize`: happy path creates a row and returns a `redirectUrl` carrying code + state;
  non-loopback / `https` / wrong-path redirects are rejected; bad `codeChallenge` rejected.
- `token`: happy path mints a PAT whose hash matches and whose name is the device label;
  wrong verifier, expired code, unknown code and a second exchange of the same code all
  return `invalid_grant`; the code row ends up consumed exactly once.
- `health`: includes `webOrigin`.

Web: a Vitest test for the consent helpers (param validation, cancel URL construction),
following the existing `apps/web` test conventions.

## Files touched

`packages/db/src/schema/daemon-authorization-codes.ts` (new),
`packages/db/src/schema/index.ts`, a generated migration under `packages/db/drizzle/`,
`apps/api/src/routes/daemon-auth.ts` (new), `apps/api/src/routes/health.ts`,
`apps/api/src/routes/tokens.ts`, `apps/api/src/lib/rate-limit.ts` (new),
`apps/api/src/index.ts`, `apps/web/app/pages/daemon/authorize.vue` (new),
`apps/web/app/composables/useDaemonAuthorization.ts` (new),
`apps/web/app/components/upload/TokenCard.vue`, `TokenManager.vue`,
`DaemonOnboarding.vue`, `daemon-python/src/auth_flow.py` (new),
`daemon-python/src/urls.py`, `daemon-python/src/api_client.py`,
`daemon-python/src/gui.py`, plus `daemon-python/tests/test_auth_flow.py` (new) and
`tests/test_urls.py`.
