# Multi-Account Support — Design

## Context

The app models a player as **one** BattleTag: `users.battletag` (unique) is resolved to
`match_players.userId` at ingest time (`replay-upsert.service.ts`), and every "personal scope"
query in the API filters on `match_players.userId`. That single-FK assumption is baked into
~34 query sites across 11 files (`stats`, `talents`, `maps`, `players`, `weaknesses`,
`hero-matchups`, `talent-analyzer`, `face-a-face`, `routes/matches.ts`, `routes/friends.ts`,
`upload-diagnostics`).

On the daemon side, `config.Config.replays_dir` holds **one** directory, and
`default_replays_dir()` globs every HotS account folder only to *pick a single winner*
(most replays). Everything else is silently never watched.

The user runs two HotS accounts on the same machine — a main and a smurf — and wants:

1. Daemon: watch **all** account replay folders, with the HotS path asked for once and
   accounts discovered automatically.
2. Web: choose, in the header, which account(s) the stats are computed from — one account,
   or several merged (main + smurf).
3. That selection persisted and applied to **every** stats query.
4. Matches of the user's accounts to be visible even when uploaded by **another** player.
5. Robustness: anticipate the bugs this introduces.

**Goal:** make a player account the set of BattleTags linked to a site account, scope every
personal query by that set (or a selection within it), auto-discover and watch every HotS
account folder, and expose the whole thing through a header selector + Settings.

**Non-goals:** no change to `heroStatsScope` semantics (`personal`/`global` stays, `global`
simply ignores accounts), no change to the replay parser's stat extraction, no change to
the friendship model, no i18n work, no new auth provider.

## Evidence: the account folder name *is* the toon handle

The HotS directory layout is `Documents/Heroes of the Storm/Accounts/<accountId>/<toonHandle>/...`
where `<toonHandle>` is exactly the string `parser._toon_handle()` already builds:
`{m_region}-{m_programId}-{m_realm}-{m_id}`.

Verified empirically on the development machine (two accounts present):

```
C:\Users\<user>\Documents\Heroes of the Storm\Accounts\
  1112776579\2-Hero-1-13560393\Replays\Multiplayer   (3 replays)
  415612224\2-Hero-1-4929240\Replays\Multiplayer   (952 replays)
```

Parsing one replay from each folder yields, in the replay's own player list:

| Folder (toon handle) | BattleTag in that replay |
|---|---|
| `2-Hero-1-4929240`   | `aife#21170`      |
| `2-Hero-1-13560393`  | `JeanPichet#2126` |

So "which account does this replay belong to?" is **deterministic**, not a heuristic.
(The web-side 100%-coverage heuristic already implemented as
`account-linking.service.ts#suggestBattletag` remains useful only for accounts that have no
local replay files, and for backwards compatibility.)

## Decisions (validated with the user)

| # | Decision |
|---|---|
| 1 | **Linking:** automatic (daemon declares the BattleTag of each folder) **plus** manual add/remove in Settings. |
| 2 | **Selection lives client-side:** Pinia store persisted to `localStorage`, injected as `?accounts=` by `useApiFetch` — the same single injection point as `?mode=`. |
| 3 | **Default selection:** the *primary* account only; merging several is opt-in and remembered. |
| 4 | **Daemon:** ask for the `Documents/Heroes of the Storm` root, auto-discover all account folders, watch them all. |
| 5 | **Battletag sharing is allowed:** several site accounts may see the same BattleTag (family/shared account). No 409 on claiming. |

### Consequence of decision 5

A BattleTag can belong to **several** site accounts, so:
- `match_players.userId` (a single FK) can no longer be the "personal scope" key. Personal
  scope becomes a **set of BattleTags**, filtered with `match_players.battletag IN (...)`.
- `match_players.userId` is kept, still populated, but demoted to informational (admin
  diagnostics only).
- `users.battletag` **stays unique** and is redefined as *the primary account's BattleTag*
  (a mirror column). A BattleTag may be primary for at most one site account and secondary
  for any number of others. This preserves every existing reverse lookup that assumes a
  single owner (friendship requests, `/u/` public profile, draft audience, `compare`,
  `promote-admin`), with no ambiguity introduced.

## Architecture

```
daemon                                    API                                 web
------                                    ---                                 ---
discover Accounts/*/*/Replays/*  ──┐
 toon_handle = folder name         │
 parse replay → toon→battletag map │
 payload.selfBattletag ────────────┼──→ POST /ingest ──→ linkSelfBattletag(user, tag)
                                   │                        └→ user_accounts (source='daemon')
                                   │
                                   │    GET /auth/me ───────→ { accounts[], primaryBattletag }
                                   │                              │
                                   │                              ├→ useAccountsStore (localStorage)
                                   │                              │    selected = [primary] | [...]
                                   │                              │
                                   │    GET /stats/summary ?accounts=A,B ─┐
                                   │    GET /matches ?accounts=A,B        ├─ useApiFetch injects
                                   │    ... every stats route ────────────┘  the selection
                                   └──→ resolvePersonalScope(user, param)
                                        ├─ validate ⊆ user_accounts (400 otherwise)
                                        └─ inArray(match_players.battletag, scope)
```

## 1. Data model

New table `packages/db/src/schema/user-accounts.ts`:

```ts
export const userAccountSourceEnum = pgEnum("user_account_source", [
  "legacy", "battlenet", "daemon", "manual",
]);

export const userAccounts = pgTable("user_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  battletag: text("battletag").notNull(),
  // Stable across a BattleTag rename -- lets the daemon update the tag in place
  // instead of accumulating a second account row. Ex: "2-Hero-1-4929240".
  toonHandle: text("toon_handle"),
  label: text("label"),
  isPrimary: boolean("is_primary").notNull().default(false),
  source: userAccountSourceEnum("source").notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userBattletagUnique: uniqueIndex("user_accounts_user_id_battletag_idx").on(table.userId, table.battletag),
  battletagIdx: index("user_accounts_battletag_idx").on(table.battletag),
  primaryUnique: uniqueIndex("user_accounts_primary_idx").on(table.userId).where(sql`${table.isPrimary}`),
}));
```

Additional index on `match_players`:

```ts
battletagIdx: index("match_players_battletag_idx").on(table.battletag),
```

Rationale: today `match_players` only has the composite unique `(match_id, battletag)` and a
trigram GIN index (which serves `ILIKE '%…%'`, not equality). Without a plain btree, every
personal-scope query becomes a seq scan.

**Migration** (generated via `bun run db:generate`), additive only:
1. create enum + `user_accounts` + indexes;
2. add `match_players_battletag_idx`;
3. backfill `INSERT INTO user_accounts (user_id, battletag, is_primary, source)`
   `SELECT id, battletag, true, 'legacy' FROM users WHERE battletag IS NOT NULL`
   `ON CONFLICT DO NOTHING`.

No column is dropped, no constraint is removed, **`MIN_PARSER_VERSION` is not bumped** (see
§3) — so the 952 already-synced replays are *not* reparsed.

## 2. API

### 2.1 `apps/api/src/lib/account-scope.ts` (new)

Single source of truth for turning a request into a BattleTag set.

```ts
export const accountsQuerySchema = z.string().optional(); // "A#1,B#2"
export const MAX_LINKED_ACCOUNTS = 20;

export type Scope = { mode: "personal"; battletags: string[] } | { mode: "global" };

/** Resolves ?accounts= against the viewer's linked accounts. */
export async function resolvePersonalScope(userId: string, requested?: string): Promise<Scope>;
/** All BattleTags linked to a user, deduped, capped. Used for a friend's data. */
export async function linkedBattletags(userId: string): Promise<string[]>;
```

Rules:
- `requested` absent → every `user_accounts` row for the user; if none exist, fall back to
  `[users.battletag]` when non-null (covers the window between migration and first link),
  otherwise `{ mode: "personal", battletags: [] }`.
- `requested` present → split on `,`, trim, drop empties, dedupe with `lower()`
  (BattleTag casing is not stable across clients), then **intersect** with the user's linked
  set. Any requested tag not linked → `400 { error: "Compte non lié" }`. This is deliberate:
  silently dropping it would make a typo look like "no games", and accepting it would leak
  another player's stats.
- `> MAX_LINKED_ACCOUNTS` requested → `400`.
- The returned `battletags` keep their stored casing (that is what `match_players.battletag`
  contains), the comparison for validation is case-insensitive.

### 2.2 `apps/api/src/services/player-accounts.service.ts` (new)

```ts
listAccounts(userId): Promise<PlayerAccount[]>;
addAccount(userId, battletag, { source, toonHandle?, label? }): Promise<PlayerAccount>;
removeAccount(userId, battletag): Promise<void>;
updateAccount(userId, battletag, { label?, isPrimary? }): Promise<PlayerAccount>;
linkSelfBattletag(userId, battletag, toonHandle?): Promise<"linked" | "updated">;
```

Link rules (shared by the daemon auto-link and the manual add):
- already linked to this user → bump `lastSeenAt`, update `toonHandle` if newly known; if the
  stored BattleTag differs but the `toonHandle` matches an existing row, **rename that row**
  (handles BattleTag renames).
- otherwise insert. `is_primary` is `true` only when the user has no primary *and*
  `users.battletag` is `NULL`; the tag is then mirrored into `users.battletag` in the same
  transaction. Otherwise `is_primary = false`. **Never throws on a BattleTag already used by
  another account** (decision 5).
- `removeAccount` never touches matches (history stays, scoped by BattleTag). Unlinking the
  primary while other accounts remain requires the caller to name the replacement in the same
  request (`DELETE /auth/me/accounts/:battletag?promote=<battletag>`); unlinking the last
  account clears `is_primary` and `users.battletag`.
- Changing the primary rewrites `users.battletag`; if the new primary is already the primary
  of another site account, the change is rejected (the column is unique).

### 2.3 Route surface

| Route | Change |
|---|---|
| `GET /auth/me` | `toPublicUser` gains `accounts: PlayerAccount[]` and `primaryBattletag`. |
| `POST /auth/me/accounts` | body `{ battletag, label? }` → add. No 409 on conflict. |
| `PATCH /auth/me/accounts/:battletag` | `{ label?, isPrimary? }`. |
| `DELETE /auth/me/accounts/:battletag` | unlink. |
| `PATCH /auth/me` | `battletag` becomes "set/replace the primary". The existing uniqueness check stays, but now means *"this BattleTag is already another account's primary"* rather than "owned by" — adding a shared BattleTag as a **secondary** goes through `POST /auth/me/accounts` and never 409s. |
| `POST /ingest` | reads `selfBattletag` from the payload → `linkSelfBattletag`. Never fails the ingest on a link error (logged). |
| `GET /ingest/accounts` | **new**, token auth — linked accounts, so the settings window can display them. |
| `GET /ingest/summary` | scopes on **all** linked accounts (no `?accounts=` for the daemon). |
| every personal stats route | `accounts: accountsQuerySchema` added to its existing zod query schema, then `resolvePersonalScope`. |

Routes that must **not** carry `accounts`: `auth`, `tokens`, `health`, `players/annotations`,
admin, spatial calibration, public profile. This is mirrored client-side by
`useApiFetch(url, { withAccounts: false })`.

### 2.4 The 34 query sites

Mechanical replacement of `eq(matchPlayers.userId, userId)` with
`inArray(matchPlayers.battletag, scope.battletags)`:

| File | Lines |
|---|---|
| `routes/matches.ts` | 107, 228, 235, 241, 275, 418 |
| `routes/friends.ts` | 144 (resolves the **friend's** linked set, not the viewer's selection) |
| `services/maps.service.ts` | 50, 97, 193, 271, 335, 398 |
| `services/players.service.ts` | 49, 203, 256, 296, 336 |
| `services/weaknesses.service.ts` | 41, 69, 112, 122 |
| `services/talents.service.ts` | 40, 99 |
| `services/stats.service.ts` | 17 |
| `services/hero-matchups.service.ts` | 46 |
| `services/face-a-face.service.ts` | 25 |
| `services/talent-analyzer.service.ts` | 37 |
| `services/uploads-diagnostics.service.ts` | 40, 46, 47, 54 (diagnostics only; keep `userId` semantics) |

Service signatures change from `userId: string` (plus a separate `scope: HeroStatsScope`)
to a single `scope: Scope`. Call sites that need a *specific other user's* personal scope
(`players.ts#getOwnStats`, `friend.ts`) call `linkedBattletags(otherUserId)` explicitly.

`face-a-face.service.ts`'s `FaceAFaceTarget` union `{ userId } | { battletag }` becomes
`{ battletags: string[] } | { battletag: string }` — the "me" side is now always a set.

### 2.5 Account-linking service

- `suggestBattletag(userId)` must exclude tags already in `user_accounts` for that user.
- `linkUnclaimedMatchPlayers` stays (it keeps `match_players.userId` meaningful for the
  admin diagnostics page), but is no longer load-bearing for scoping.
- `players.service.ts#resolveAccountLinks` returns **all** accounts matching a BattleTag and
  marks `friendshipStatus: "self"` when *any* of them is the viewer (or is in the viewer's
  linked set). Precedence for `accountUserId`: self → friends → pending → first.

## 3. Daemon (`daemon-python`)

### 3.1 Config

```python
@dataclass(frozen=True)
class Config:
    ...
    hots_dir: Path              # Documents/Heroes of the Storm  (was: replays_dir)
    extra_replay_dirs: tuple[Path, ...] = ()   # manual override, rarely needed
```

- New `discover_account_folders(hots_dir) -> list[AccountFolder]` in
  `src/accounts_discovery.py`, globbing `Accounts/*/*/Replays/*`; each entry carries
  `folder: Path`, `toon_handle: str` (the account folder's name) and `account_id: str`.
- `default_hots_dir()` replaces `default_replays_dir()`: returns
  `~/Documents/Heroes of the Storm` when it exists (the glob is no longer used to pick one
  account).
- **Config migration**: if the JSON config has the old `replaysDir` and no `hotsDir`, derive
  `hots_dir` by walking up from the old path until the parent folder is named `Accounts` and
  taking *its* parent, then keep the old path in `extraReplayDirs` so nothing stops being
  watched. `HOTS_REPLAYS_DIR` keeps working as an extra dir; `HOTS_DIR` is the new env var.
- `save_config()` writes `hotsDir` + `extraReplayDirs`; the legacy key is preserved once, then
  dropped.

### 3.2 Parser

- `parse_replay()` gains an optional `expected_toon_handle: str | None`. When given,
  `build_payload` resolves it against the toon→BattleTag map it already builds in
  `_extract_battletags` and emits `payload["selfBattletag"]`.
- Not found (folder belongs to an account not in the game, corrupt lobby buffer) → `None`,
  logged at `info`; the replay still uploads.
- `PARSER_VERSION` is **not** bumped: `selfBattletag` is not persisted server-side, it only
  drives a link. No resync storm.

### 3.3 Watcher / sync loop

- `watch_replays(replays_dirs: Sequence[Path], ...)`: one `Observer` with one
  `schedule()` per folder, a single shared `seen` set (paths are absolute, so no collisions),
  and the periodic re-scan iterating all folders.
- `_run_sync_loop` takes the folder list, merges the initial scans, and passes each path's
  folder down so `_ingest_and_track` can hand the right `toon_handle` to `ingest_file`.
- `StatusTracker` counts across all folders (unchanged shape).
- `--resync` with no argument → every discovered folder; with an explicit path → that folder
  only (legacy behaviour preserved).

### 3.4 Settings window

- Field renamed: "Dossier Heroes of the Storm", with its own browse button and validation
  (must contain `Accounts/`).
- New read-only list: detected account folders (toon handle + replay count) and, when the API
  is reachable, the linked accounts from `GET /ingest/accounts` (BattleTag + label), with a
  hint when a detected folder has no matching linked account ("sera lié au premier envoi").

## 4. Web

### 4.1 `useAccountsStore` (new, `app/stores/useAccountsStore.ts`)

```ts
state: { selected: string[] | null }   // null = "server default" (primary only)
getters: accountsQueryParam(): string | undefined
actions: toggle(battletag), selectAll(), selectOnly(battletag), reset()
persist: { key: "hots-stats:accounts", pick: ["selected"] }
```

- The list of *available* accounts is **not** persisted: it comes from `useAuthUser()`
  (`accounts` + `primaryBattletag`), so it is present during SSR and always in sync with the
  server.
- `selected === null` (or empty/unknown tags after unlinking) → the store computes the
  effective selection as `[primaryBattletag]`.
- Same hydration caveat as `GameModeFilter.vue` (persisted state is only restored on the
  client; server renders the default). The account-scoped fetches therefore key on the store
  value so Nuxt refetches once it hydrates, and the switcher re-renders client-side after
  mount like `GameModeFilter` does.

### 4.2 `useApiFetch`

```ts
type ApiFetchOptions = {
  query?: ...;
  withGameMode?: boolean;
  withAccounts?: boolean;   // default true
};
```

The query computed adds `accounts: accountsStore.accountsQueryParam` **before** the caller's
own `opts.query` (so a page can still override explicitly, e.g. an admin tool). Nothing else
changes; every existing stats page is scoped automatically.

### 4.3 UI

- `app/components/ui/AccountSwitcher.vue` (new): compact trigger showing the effective
  selection ("aife#21170" / "aife#21170 +1" / "Tous"), opening a checkbox list of linked
  accounts with a "principal" badge and a "Tous" row. Placed in `layouts/default.vue` next to
  `UiGameModeFilter`. Hidden when the user has 0 or 1 linked account.
- `pages/settings/index.vue`: the single "BattleTag" input becomes a "Comptes liés" section —
  list with label editing, "principal" radio, unlink button, and an add field with the
  existing `/auth/me/battletag-suggestion` hint. The old field stays as the *primary* editor.
- `pages/matches/[id].vue`: `myBattletag` becomes `myBattletags: string[]` from
  `authData.user.accounts`; highlight/coach-picker treat any of them as "me".
- `components/players/ProfileDetail.vue`: `isSelf` checks membership in the linked set
  (a shared BattleTag is "self" for every linked account).
- `components/draft/DraftTeamColumn.vue` and `pages/draft/index.vue`: same membership check
  for the "(toi)" tag and for deciding which team is "mine".
- `components/ProComparisonView.vue` and `components/spatial/SpatialSlotGroup.vue`
  (+ `SpatialHistorySlotConfig.vue`): the `myBattletag` prop becomes the linked-account list;
  the heatmap history pickers default to the primary account still present in the option list.

## 5. Edge cases and failure modes to cover

1. **Own accounts listed as "players encountered".** `players.service.ts#encounterBase` and
   `face-a-face.service.ts` only exclude the *same* tag (`other.battletag != my.battletag`).
   They must exclude the **whole scope**, otherwise the smurf shows up as a frequent
   teammate/opponent of the main. Regression test required.
2. **BattleTag renames.** Keyed on `toon_handle`: the daemon-reported rename updates the
   existing row instead of creating a second account. Historical `match_players` rows keep
   the old tag (out of scope to rewrite).
3. **BattleTag casing.** Dedupe/normalise with `lower()` on add/validate; store the canonical
   string as observed (usually from the replay).
4. **Empty scope.** No linked account, or `global` mode → all services must return zeros /
   empty arrays, never `inArray([])` (Drizzle renders `false`, which is correct but easy to
   get wrong when conditions are built conditionally) and never a thrown error.
5. **Requested account not linked → 400.** Never silently ignored, never accepted.
6. **Over-injection.** `accounts` must not be sent to auth/token/global routes
   (`withAccounts: false`); the API ignores it there, so a mistake is invisible — covered by a
   web unit test on `useApiFetch`.
7. **`#` in the query string.** BattleTags contain `#`; the param must be
   `encodeURIComponent`-safe. Covered by a store test asserting the built param.
8. **Double counting (documented semantics, not a bug).** Personal scope is defined as *the set
   of player rows belonging to the selected accounts*. If two selected accounts appear in the
   same match (a shared/family BattleTag, or a custom game), that match legitimately contributes
   two rows and `gamesPlayed` counts 2. This is deliberately **not** deduped at the match
   level: doing so would silently change every per-player average and would mean rewriting all
   34 sites. Guard instead at link time: when a newly linked BattleTag already shares matches
   with an already-linked account, Settings shows a one-line warning ("ces comptes ont joué
   ensemble — les parties communes compteront deux fois"). Tested as documented behaviour.
9. **Primary uniqueness.** Setting a primary tag already primary elsewhere → 409 with a clear
   message. Auto-link never tries to steal a primary.
10. **Shared-BattleTag trust.** A manually added BattleTag is unverified: anyone can claim
    any tag (decision 5). Mitigation: the Settings UI labels manual accounts as
    "non vérifié" and the existing upload-coverage suggestion is offered first; daemon-linked
    accounts are marked `source='daemon'` (trusted, backed by a real replay file on the
    user's machine). **This is the residual risk the user accepted.**
11. **Draft audience.** `draft.service.ts` notifies all accounts linked to a resolved
    BattleTag, not just the primary.
12. **Data reset.** `POST /auth/me/reset-data` still deletes only matches uploaded by the
    user; matches uploaded by others that merely *contain* a linked account survive. Documented
    in the Settings copy.
13. **Daemon folder churn.** A folder can appear/disappear between scans; discovery is
    re-run at each daemon start (and on config save). A missing folder is logged and skipped,
    never fatal.
14. **Duplicate watch.** Two `Replays/*` subfolders are distinct paths, so the shared `seen`
    set needs no special casing; `sync_state` is keyed by path + hash already.
15. **Scale.** Both the number of accounts requested via `?accounts=` and the number linked
    per user are capped at `MAX_LINKED_ACCOUNTS` (20), bounding the `IN` list.
16. **Legacy window.** Between the migration and the first `user_accounts` write, a user has
    only `users.battletag` — `resolvePersonalScope` falls back to it so nothing breaks.
17. **SSR flash.** Persisted selection is client-only; the first server render uses the
    default (primary). Accepted, same as the game-mode filter; the switcher re-renders after
    mount.

## 6. Testing and verification

**Daemon (`pytest -q`, CI job `daemon-tests`)**
- `test_accounts_discovery.py`: layout `Accounts/<id>/<toon>/Replays/<sub>` → toon handles;
  other `Replays` subfolders picked up; empty/missing root.
- `test_config.py`: `default_hots_dir`; legacy `replaysDir` → `hotsDir` + `extraReplayDirs`
  migration; round-trip `save_config`; env overrides.
- `test_parser.py`: `expected_toon_handle` in the player list → `selfBattletag`; absent →
  `None` and the payload still valid.
- `test_watcher.py`: two watched folders, one shared seen set, no duplicate callbacks.

**API (`bun test apps/api` — `bun:test`; `apps/api/package.json` has no `test` script)**
- `account-scope.test.ts`: absent param → all linked; subset → intersected; unlinked → error;
  casing; empty; cap.
- `player-accounts.service` cases exercised through the route-level helpers where feasible
  (add/idempotent add/rename-by-toon/primary rules).

**Web (`vitest run`)**
- `useAccountsStore.test.ts`: default = primary; toggle; unknown tag after unlink falls back;
  `accountsQueryParam` encoding of `#`.
- `useApiFetch.test.ts`: injects `accounts` when `withAccounts` is not `false`; omits it
  when `false`; still injects `mode`.

**Whole-repo gates (what "fini" means)**
1. `bun install`
2. `bun run --filter './packages/db' generate` then `bun run --filter './packages/db' migrate`
   against the local dev Postgres
3. `bun run typecheck`
4. `bun run build`
5. `bun run --filter './apps/web' test`
6. `cd daemon-python && pytest -q`
7. Manual smoke: link `aife#21170` + `JeanPichet#2126`, verify the header selector changes
   the dashboard numbers, verify the smurf appears (merged), verify it is *not* listed in
   /players as an encountered player.

Only after all seven pass: commit + push (one or more logically-scoped commits).

## 7. Rollout

Additive migration, no destructive schema change, no `MIN_PARSER_VERSION` bump. Old daemon
builds keep working (they just never send `selfBattletag`; accounts are then linked manually
or via the existing suggestion). Old web builds keep working (no `?accounts=` → server
default = all linked, which is a superset of today's behaviour).

## 8. Out of scope

- Rewriting historical `match_players.battletag` on rename.
- A per-account "uploaded by" attribution column on `matches`.
- Any change to `heroStatsScope`, friendships, annotations, or the spatial pipeline.
- Cross-user visibility rules beyond the sharing model described here.
