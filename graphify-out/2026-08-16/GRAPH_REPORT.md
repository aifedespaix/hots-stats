# Graph Report - hots-stats  (2026-08-14)

## Corpus Check
- 250 files · ~223,265 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1754 nodes · 3375 edges · 130 communities (108 shown, 22 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 62 edges (avg confidence: 0.63)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `503b2fe7`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- test_parser.py
- draft_layout.py
- dependencies
- schema/index.ts
- SyncState
- adapters/index.ts
- OcrResult
- ApiClient
- api/src/index.ts
- test_draft_capture.py
- test_screen_capture.py
- internal.ts
- watch_replays
- api/package.json
- settings/index.vue
- routes/friends.ts
- TeamCropResult
- test_hotkey.py
- talents.service.ts
- db/package.json
- routes/auth.ts
- UpdateStatusTracker
- test_config.py
- daemon-python README
- ingest.ts
- scripts
- auth-token.ts
- matches/index.vue
- _SettingsWindow
- test_app.py
- draft_capture.py
- quarantine.ts
- gui.py
- tray.py
- StatusTracker
- find_update
- test_updater.py
- users.ts
- [id].vue
- _DaemonRunner
- replay-payload.ts
- players.service.ts
- app.py
- compilerOptions
- draft.service.ts
- shared-types/package.json
- friends/index.vue
- players/index.vue
- [battletag].vue
- ._build_ui
- autostart.py
- updater.py
- WinrateTrendModal.vue
- DraftPlayerStats.vue
- draft/index.vue
- daemon-error.ts
- TestChooseReading
- [userId].vue
- heroes/index.vue
- fake_engines
- Path
- useFormat.ts
- types/friends.ts
- Lock
- guess_settings_url
- apply_update_and_exit
- _render_relaunch_script
- analytics.ts
- Enum
- Event
- _FakeStreamingResponse
- routes/draft.ts
- DataTable.vue
- [slug].vue
- acquire
- src/draft.ts
- shared-types/src/index.ts
- default.vue
- DEPLOYMENT.md — Raspberry Pi + Dokploy Guide
- TopHeroesTop3.vue
- _version_gte
- trigger_manual_update
- DraftTeamColumn.vue
- HOTS Stats Favicon
- str
- sync_state_file_path
- ReplayErrorRecord
- db/tsconfig.json
- api/tsconfig.json
- pages/index.vue
- shared-types/tsconfig.json
- DraftSnapshot
- [handle].vue
- _now
- ThemeSwitcher.vue
- useApiFetch.ts
- Hero Detail OG Image
- Home Page OG Image
- Login Page OG Image
- Match Detail OG Image
- Matches Index OG Image
- Player Profile OG Image
- Players Index OG Image
- User Profile OG Image
- generate-og.ts
- web/tsconfig.json
- generate_icons.py
- generate_protocol_manifest.py
- ._crop_to_photo
- migrate.ts
- docker-entrypoint.sh
- HOTS Draft Capture / OCR
- Epic 5 — Web Core Brief
- Bw Modelica Font Specimen (PDF)
- Heroes Index OG Image
- Settings Page OG Image
- hots-analytics-daemon

## God Nodes (most connected - your core abstractions)
1. `SyncState` - 71 edges
2. `_SettingsWindow` - 56 edges
3. `ApiClient` - 45 edges
4. `UpdateStatusTracker` - 40 edges
5. `ingest_file()` - 31 edges
6. `OcrResult` - 28 edges
7. `StatusTracker` - 26 edges
8. `_DaemonRunner` - 26 edges
9. `AvailableUpdate` - 24 edges
10. `build_payload()` - 24 edges

## Surprising Connections (you probably didn't know these)
- `file_hash_cache Table (skip re-hashing unchanged replays)` --semantically_similar_to--> `SQLite-backed Sync State Cache`  [INFERRED] [semantically similar]
  tasks/daemon-audit-2026-08-12.md → daemon-python/README.md
- `Epic 3 — Daemon & Ingestion Pipeline Brief` --conceptually_related_to--> `daemon-python README`  [INFERRED]
  tasks/epic-3-daemon-ingestion.md → daemon-python/README.md
- `Section` --references--> `DraftHeroStat`  [EXTRACTED]
  apps/web/components/draft/DraftPlayerStats.vue → packages/shared-types/src/draft.ts
- `DraftPlayerStatsResponse` --references--> `DraftPlayerStats`  [EXTRACTED]
  apps/web/types/draft.ts → packages/shared-types/src/draft.ts
- `FriendSummaryResponse` --references--> `HeroStatsScope`  [EXTRACTED]
  apps/web/types/friends.ts → packages/shared-types/src/stats.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Dokploy Deployment Bundle** — deployment_guide, docker_compose_backend_compose, docker_compose_frontend_compose [EXTRACTED 1.00]
- **Epics Roadmap Bundle** — tasks_readme_roadmap, tasks_epic_3_daemon_ingestion_brief, tasks_epic_4_daemon_cicd_brief, tasks_epic_5_web_core_brief, tasks_epic_6_web_analytics_brief [EXTRACTED 1.00]
- **Daemon Hardening Audit Program** — daemon_python_readme_guide, tasks_daemon_audit_2026_08_12_report, concept_file_hash_cache, concept_initial_sync_threadpool, concept_proactive_tray_notifications [INFERRED 0.85]

## Communities (130 total, 22 thin omitted)

### Community 0 - "test_parser.py"
Cohesion: 0.07
Nodes (73): Any, Tracker stat name (e.g. "HeroDamage") -> API payload field name (e.g.…, stat_field_name(), _apply_score_event(), _attribute_scope_by_player_list_index(), build_payload(), _build_protocol(), _extract_battletags() (+65 more)

### Community 1 - "draft_layout.py"
Cohesion: 0.11
Nodes (41): _box_from_list(), _box_to_list(), crop_config_file_path(), _crop_rel(), default_crop_config(), ensure_crop_config_file(), extract_player_crops(), _extract_team() (+33 more)

### Community 2 - "dependencies"
Cohesion: 0.05
Nodes (40): dependencies, chart.js, @hots-stats/shared-types, nuxt, @nuxt/fonts, @nuxt/ui, sharp, vue (+32 more)

### Community 3 - "schema/index.ts"
Cohesion: 0.11
Nodes (21): Hero, heroes, heroRoleEnum, NewHero, Map, maps, NewMap, MatchPlayer (+13 more)

### Community 4 - "SyncState"
Cohesion: 0.09
Nodes (29): Tracks, per replay (keyed by content hash), whether it's synced or errored, at…, Drops every "synced"/"error" record, regardless of parser version -- unlike…, Updates `file_exists` for every tracked replay against the set of…, Returns the previously computed hash for `file_path`, but only if its size and…, Records `file_path`'s freshly computed hash alongside the size/mtime it was…, SyncState, A replay overwritten in place (same size, by coincidence) but with a newer…, A daemon update that bumps PARSER_VERSION must make previously synced replays… (+21 more)

### Community 5 - "adapters/index.ts"
Cohesion: 0.33
Nodes (7): DefaultAdapter, ReplayValidationError, CUSTOM_ADAPTERS, getCustomAdapter(), resolveAdapter(), ParsedReplayData, ReplayAdapter

### Community 6 - "OcrResult"
Cohesion: 0.10
Nodes (40): _build_team_payload(), _background_color(), _clean_text(), _get_latin_engine(), _get_multilingual_engine(), OcrResult, _prepare_crop(), Image (+32 more)

### Community 7 - "ApiClient"
Cohesion: 0.05
Nodes (95): ApiClient, ApiClientError, AuthError, fetch_summary(), fetch_version(), IngestResult, ping_health(), Exception (+87 more)

### Community 8 - "api/src/index.ts"
Cohesion: 0.14
Nodes (19): app, requireUser, healthRoute, buildMatchConditions(), Env, filtersQuerySchema, listQuerySchema, matchesRoute (+11 more)

### Community 9 - "test_draft_capture.py"
Cohesion: 0.10
Nodes (32): capture_and_submit(), CaptureStatus, DraftCaptureCoordinator, Runs one full capture. Never raises: this is called directly from the global…, Thread-safe, shared across every hotkey-triggered capture for the daemon's…, No-ops if `generation` has since been superseded, so a stale run's phase update…, Like `finish`, but leaves the failure visible (ERROR, with `message`) instead…, _client() (+24 more)

### Community 10 - "test_screen_capture.py"
Cohesion: 0.11
Nodes (29): capture_foreground_window(), capture_game_window(), capture_window(), find_foreground_window(), find_game_window(), GameWindowNotFoundError, Exception, Image (+21 more)

### Community 11 - "internal.ts"
Cohesion: 0.18
Nodes (17): main(), errorsQuerySchema, internalRoute, paramsSchema, querySchema, resolveErrorsSchema, QuarantineVerificationResult, verifyQuarantinedBuild() (+9 more)

### Community 12 - "watch_replays"
Cohesion: 0.13
Nodes (26): Event, Lock, Path, Watches the replays folder for newly-written `.StormReplay` files., Polls the file size until it stops changing. Returns False if the file…, Lists `.StormReplay` files in `replays_dir` not already in `seen`, marks them…, Blocks, calling `on_replay_ready(path)` for each new stable `.StormReplay`…, _ReplayHandler (+18 more)

### Community 13 - "api/package.json"
Cohesion: 0.07
Nodes (28): dependencies, arctic, drizzle-orm, hono, @hots-stats/db, @hots-stats/shared-types, zod, devDependencies (+20 more)

### Community 14 - "settings/index.vue"
Cohesion: 0.07
Nodes (21): battletag, battletagError, canConfirmReset, config, createdToken, { data: tokensData, refresh: refreshTokens }, newTokenName, PatSummary (+13 more)

### Community 15 - "routes/friends.ts"
Cohesion: 0.16
Nodes (26): Env, friendsRoute, matchesQuerySchema, scopeQuerySchema, searchQuerySchema, sendRequestSchema, areFriends(), cancelFriendRequest() (+18 more)

### Community 16 - "TeamCropResult"
Cohesion: 0.17
Nodes (25): debug_dir(), install_file_log_handler(), Image, Path, Persists debug artifacts for the live-draft capture feature -- every crop the…, Saves the full screenshot, every team/rotation/player-name crop, and a `crop-…, `%APPDATA%/hots-analytics/live-draft/`., Mirrors WARNING+ records from the live-draft modules into `live-draft/live-… (+17 more)

### Community 17 - "test_hotkey.py"
Cohesion: 0.12
Nodes (20): HotkeyManager, InvalidHotkeyError, Global keyboard shortcut that triggers a live-draft capture. Backed by the…, Raised by `validate` for a combo that can't be registered., Normalizes and validates a hotkey string (e.g. "ctrl+shift+d"), raising…, Registers a single global hotkey and calls `on_trigger` (on `keyboard`'s own…, Validates and registers `hotkey`, replacing any previously registered one. Logs…, validate() (+12 more)

### Community 18 - "talents.service.ts"
Cohesion: 0.23
Nodes (11): Env, heroesRoute, listQuerySchema, getHeroSummaries(), getHeroSummary(), getTalentTierStats(), heroStatsQuery(), HeroStatsRow (+3 more)

### Community 19 - "db/package.json"
Cohesion: 0.08
Nodes (25): drizzle-kit, dependencies, drizzle-orm, postgres, devDependencies, drizzle-kit, @types/bun, typescript (+17 more)

### Community 20 - "routes/auth.ts"
Cohesion: 0.15
Nodes (18): env, envSchema, google, createSessionToken(), SESSION_COOKIE_MAX_AGE, SESSION_COOKIE_NAME, verifySessionToken(), authSession (+10 more)

### Community 21 - "UpdateStatusTracker"
Cohesion: 0.13
Nodes (27): AvailableUpdate, perform_update(), Thread-safe last-known-state of the updater, polled by the settings window (see…, Downloads and applies `update`, reporting progress on `status` throughout.…, Runs for the app's lifetime on a background thread: checks for a newer release…, UpdateStatusTracker, watch_for_updates(), `apply_update_and_exit` returning False means it aborted instead of exiting… (+19 more)

### Community 22 - "test_config.py"
Cohesion: 0.08
Nodes (44): config_file_path(), ConfigError, default_replays_dir(), is_auto_update_enabled(), load_config(), open_config_folder(), open_path(), Exception (+36 more)

### Community 23 - "daemon-python README"
Cohesion: 0.10
Nodes (23): Auto-Update Self-Replace/Relaunch Handoff, Daemon pytest CI Job Kept Separate From Windows Release Build, Account Data Reset Wipes Local Sync Cache, file_hash_cache Table (skip re-hashing unchanged replays), Generation-Number Cooperative Capture Cancellation, ThreadPoolExecutor for Initial Sync Backlog, Live Draft Capture Feature, Nuitka Compilation Cache Persistence (+15 more)

### Community 24 - "ingest.ts"
Cohesion: 0.24
Nodes (11): API_VERSION, MIN_PARSER_VERSION, Env, extractBaseBuild(), ingestRoute, recordDaemonError(), quarantineRawReplay(), displayNameFromSlug() (+3 more)

### Community 25 - "scripts"
Cohesion: 0.09
Nodes (22): devDependencies, typescript, typescript, name, private, scripts, build, check-build (+14 more)

### Community 26 - "auth-token.ts"
Cohesion: 0.24
Nodes (9): generatePersonalAccessToken(), hashToken(), authToken, Env, createTokenSchema, tokensRoute, NewPersonalAccessToken, PersonalAccessToken (+1 more)

### Community 27 - "matches/index.vue"
Cohesion: 0.10
Nodes (18): activeFilters, apiSortBy, columns, { data: filterOptions }, { data: matchesData, pending }, dateFrom, dateTo, FiltersResponse (+10 more)

### Community 28 - "_SettingsWindow"
Cohesion: 0.08
Nodes (10): Caps `text` at `max_chars`, replacing anything cut off with an ellipsis, so a…, Locks the window to a fixed size and centers it. Without an explicit "WxH", Tk…, Temporarily fills every dynamically-updated label with max-length placeholder…, `self._root.after(0, func, *args)`, but a no-op once the window has closed.…, Records a rebind by listening for the next real key combo instead of asking the…, Polled while the window is open (see `__init__`/`_on_close`) so a hotkey-…, _SettingsWindow, _truncate() (+2 more)

### Community 29 - "test_app.py"
Cohesion: 0.16
Nodes (23): Event, Path, Called once per daemon start: asks the API its version and, if it reports a…, Uploads every replay already on disk -- via a small pool of worker threads, see…, _run_sync_loop(), _sync_api_version(), _config(), Regression test: an install that has synced replays before but has never yet… (+15 more)

### Community 30 - "draft_capture.py"
Cohesion: 0.22
Nodes (10): CapturePhase, Enum, str, Orchestrates one live-draft capture: hotkey press -> find the game window ->…, Everything the settings window's "Tester la capture" button (see…, Runs the same screenshot -> crop -> OCR pipeline as a real hotkey press…, run_test_capture(), TestCaptureResult (+2 more)

### Community 31 - "quarantine.ts"
Cohesion: 0.25
Nodes (7): KnownBuild, knownBuilds, NewKnownBuild, NewRawReplayQuarantine, quarantineStatusEnum, RawReplayQuarantine, rawReplaysQuarantine

### Community 32 - "gui.py"
Cohesion: 0.13
Nodes (12): _apply_dark_style(), _format_update_status(), _ProgressBarDriver, Settings window: shown on first run to collect the 3 required fields, and…, Renders the updater's current phase as one French status line -- including…, Switches a `ttk.Progressbar` between determinate (a known 0-100%) and…, Builds the shared dark ttk theme -- called every time a window is created (the…, _UpdateProgressWindow (+4 more)

### Community 33 - "tray.py"
Cohesion: 0.22
Nodes (6): Base64-encoded tray icon PNG, generated from apps/web/public/favicon.svg (the…, _build_icon_image(), Image, System tray icon (pystray): reopen the settings window, or quit cleanly.…, Loads the app's icon (the web app's favicon, composited onto a small dark…, Lock

### Community 34 - "StatusTracker"
Cohesion: 0.16
Nodes (10): DaemonStatus, Thread-safe snapshot of the background daemon's live state: how many replays it…, StatusTracker, The initial backlog is ingested by a small pool of worker threads (see app.py's…, test_consecutive_failures_counts_a_run_without_success(), test_initial_snapshot_is_empty(), test_set_found_and_bump_found(), test_syncing_lifecycle_failure_keeps_last_error() (+2 more)

### Community 35 - "find_update"
Cohesion: 0.19
Nodes (19): check_for_update(), find_update(), Pure decision logic, split out from `check_for_update` for testing: given a…, Best-effort check against GitHub's "latest release" API. Returns None on any…, _asset(), The asset itself is never versioned (see updater._ASSET_NAME) -- the release's…, Exact match, not a prefix/suffix check -- a differently-purposed asset that…, _release() (+11 more)

### Community 36 - "test_updater.py"
Cohesion: 0.14
Nodes (22): cleanup_stale_downloads(), downloads_dir(), parse_version(), _powershell_diagnostics(), Where a downloaded update build is staged before being handed off to the…, Clears `downloads_dir()` of anything left over from a previous run -- an update…, "v1.2.3" / "1.2.3" -> (1, 2, 3). None for anything that isn't a plain dotted-…, A best-effort environment fingerprint, logged right before every relaunch… (+14 more)

### Community 37 - "users.ts"
Cohesion: 0.11
Nodes (15): daemonErrorStatusEnum, daemonErrorTypeEnum, DaemonIngestError, daemonIngestErrors, NewDaemonIngestError, DraftPseudoPreference, draftPseudoPreferences, NewDraftPseudoPreference (+7 more)

### Community 38 - "[id].vue"
Cohesion: 0.14
Nodes (17): allPlayers, columns, { data: authData }, { data, error }, isAlly(), isMe(), matchSeoDescription, matchTitle (+9 more)

### Community 39 - "_DaemonRunner"
Cohesion: 0.10
Nodes (19): _DaemonRunner, Starts/stops the background replay-watcher thread, one instance at a time., Wires up `TrayController.notify` (message, title) so this runner can…, Checks the just-updated status and, the first time consecutive failures cross…, `announce_initial_scan`, when True, has the tray post a one-time "found N…, _fail_once(), A run of failures crossing the threshold, then recovering, then failing again…, A `_DaemonRunner` that never had `set_tray_notify` called (every headless test… (+11 more)

### Community 40 - "replay-payload.ts"
Cohesion: 0.29
Nodes (6): ReplayPayload, replayPayloadSchema, ReplayPlayer, replayPlayerSchema, TalentPick, talentPickSchema

### Community 41 - "players.service.ts"
Cohesion: 0.18
Nodes (13): gameModeListSchema, Env, listQuerySchema, playersRoute, encounterBase(), getPlayerHeroBreakdown(), listPlayerEncounters(), PlayerHeroBreakdown (+5 more)

### Community 42 - "app.py"
Cohesion: 0.09
Nodes (20): Top-level launcher used only for the compiled (Nuitka) build. Nuitka compiles…, _notify_already_running(), Wires together first-run setup, the tray icon, and the background sync daemon.…, A second launch (double-click, or autostart racing a manual start) must not…, run_app(), config_exists(), Opens the settings window and blocks (on the calling thread) until it's closed.…, A small, always-on-top standalone window shown while an update… (+12 more)

### Community 43 - "compilerOptions"
Cohesion: 0.12
Nodes (16): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, lib, module, moduleResolution, noEmit (+8 more)

### Community 44 - "draft.service.ts"
Cohesion: 0.21
Nodes (15): getCurrentSnapshotForViewer(), ingestDraftSnapshot(), isNewGame(), latestSnapshotByUserId, loadPreferences(), mergeTeam(), pooledNames(), publish() (+7 more)

### Community 45 - "shared-types/package.json"
Cohesion: 0.12
Nodes (15): dependencies, zod, devDependencies, typescript, exports, typescript, zod, main (+7 more)

### Community 46 - "friends/index.vue"
Cohesion: 0.20
Nodes (14): acceptRequest(), actionError, cancelRequest(), config, { data: friendsData, refresh: refreshFriends }, { data: requestsData, refresh: refreshRequests }, declineRequest(), extractError() (+6 more)

### Community 47 - "players/index.vue"
Cohesion: 0.13
Nodes (12): columns, config, { data, refresh }, mode, modeOptions, { page, pageSize, total, paginated: pagedRows }, query, rows (+4 more)

### Community 48 - "[battletag].vue"
Cohesion: 0.14
Nodes (11): battletag, columns, config, { data, error, refresh }, { data: matchesData, pending }, page, playerSeoDescription, requestError (+3 more)

### Community 49 - "._build_ui"
Cohesion: 0.21
Nodes (6): BooleanVar, Checkbutton, A `Checkbutton` styled to match the dark ttk theme (plain `tk`, not `ttk`,…, Grids a label + entry + status indicator starting at `start_row`. Returns…, Frame, Notebook

### Community 50 - "autostart.py"
Cohesion: 0.22
Nodes (12): is_enabled(), is_supported(), Launch at Windows startup" toggle, backed by the current user's `Run` registry…, True only for the compiled .exe on Windows: there's no installed binary to…, Best-effort: a registry write can fail (permissions, a locked-down machine) but…, set_enabled(), Regression test: the Run key must point at `installed_exe_path()` (the real,…, test_is_enabled_false_when_not_supported() (+4 more)

### Community 51 - "updater.py"
Cohesion: 0.12
Nodes (24): _append_update_log_line(), installed_exe_path(), manual_fallback_exe_path(), manual_fallback_message(), Background self-update: checks GitHub Releases for a daemon build newer than…, The path of the .exe the user actually launched (double-clicked, or the…, Where a downloaded update ends up if the automatic swap+relaunch could never be…, Best-effort copy of the already-downloaded `new_exe` to… (+16 more)

### Community 52 - "WinrateTrendModal.vue"
Cohesion: 0.18
Nodes (11): chartData, chartOptions, cumulative, CumulativePoint, emit, errored, pending, points (+3 more)

### Community 53 - "DraftPlayerStats.vue"
Cohesion: 0.19
Nodes (11): config, errored, medals, pending, props, Section, sections, stats (+3 more)

### Community 54 - "draft/index.vue"
Cohesion: 0.18
Nodes (9): applyOverrides(), capturedAgoLabel, config, overrides, ownBattletag, selectedBattletag, { snapshot, connected }, teamLeft (+1 more)

### Community 55 - "daemon-error.ts"
Cohesion: 0.40
Nodes (4): DaemonErrorReportInput, daemonErrorReportInputSchema, DaemonErrorType, daemonErrorTypeSchema

### Community 56 - "TestChooseReading"
Cohesion: 0.23
Nodes (4): _choose_reading(), Reconciles the two engines' votes for one crop. The multilingual engine wins…, `_choose_reading` is the pure decision function reconciling the two engines'…, TestChooseReading

### Community 57 - "[userId].vue"
Cohesion: 0.17
Nodes (9): columns, { data, error }, { data: matchesData, pending: matchesPending }, friendId, friendName, page, route, { scope, saving: scopeSaving, setScope } (+1 more)

### Community 58 - "heroes/index.vue"
Cohesion: 0.17
Nodes (10): columns, { data }, mode, modeOptions, { page, pageSize, total, paginated: pagedHeroes }, query, { scope, saving: scopeSaving, setScope }, search (+2 more)

### Community 59 - "fake_engines"
Cohesion: 0.67
Nodes (3): fake_engines(), fixture, Two independent fake engines, distinguished by whether RapidOCR was constructed…

### Community 61 - "useFormat.ts"
Cohesion: 0.18
Nodes (3): gameModeFilterGroups, gameModeLabels, heroRoleLabels

### Community 62 - "types/friends.ts"
Cohesion: 0.17
Nodes (15): HeroStats, FriendRequestItem, FriendRequestsResponse, FriendSearchResponse, FriendSearchResult, FriendsListResponse, FriendSummaryResponse, FriendUser (+7 more)

### Community 64 - "guess_settings_url"
Cohesion: 0.29
Nodes (8): guess_settings_url(), Helpers for the two well-known URLs the settings window links to: the API's…, Best-effort guess at the web dashboard's Settings page (where access tokens are…, test_guess_settings_url_adds_default_scheme(), test_guess_settings_url_falls_back_for_empty_input(), test_guess_settings_url_falls_back_for_unrecognized_host(), test_guess_settings_url_replaces_api_dot_prefix_with_app(), test_guess_settings_url_strips_api_dash_prefix()

### Community 65 - "apply_update_and_exit"
Cohesion: 0.24
Nodes (11): apply_update_and_exit(), Hands off to a detached PowerShell script that waits for this process (by pid)…, _fake_process(), The bug this guards against: `Popen` succeeding only means Windows accepted the…, Previously the quick-exit log line was pure guesswork ("likely blocked by…, The diagnostics line must be written on every attempt, success or failure, so a…, test_apply_update_and_exit_aborts_when_powershell_fails_to_launch(), test_apply_update_and_exit_aborts_when_relaunch_script_dies_immediately() (+3 more)

### Community 66 - "_render_relaunch_script"
Cohesion: 0.18
Nodes (11): Pure string-formatting split out from `apply_update_and_exit` so the script's…, _render_relaunch_script(), The bug this guards against: if Copy-Item never succeeds (e.g. a lingering…, `Start-Process` with a bare -FilePath goes through the same ShellExecute path…, Paths are interpolated with single quotes, not double quotes: a `$` in a…, `Start-Process` doesn't wait, so on its own it can't tell "relaunched and…, test_render_relaunch_script_falls_back_to_previous_version_on_copy_failure(), test_render_relaunch_script_includes_paths_version_and_retry_logic() (+3 more)

### Community 67 - "analytics.ts"
Cohesion: 0.27
Nodes (9): HeroDetailResponse, HeroListResponse, HeroTalentsResponse, PlayerDetailResponse, PlayerHeroBreakdown, PlayerListResponse, PublicProfileResponse, PlayerEncounterStats (+1 more)

### Community 70 - "_FakeStreamingResponse"
Cohesion: 0.22
Nodes (5): download_update(), Streams the release asset to `dest_dir / update.asset_name`, calling…, _FakeStreamingResponse, test_download_update_reports_none_progress_without_content_length(), test_download_update_reports_progress_fraction()

### Community 71 - "routes/draft.ts"
Cohesion: 0.31
Nodes (8): draftRoute, Env, getPlayerDraftStats(), setDraftPseudoPreference(), subscribeToDraftUpdates(), getPlayerEncounter(), draftPreferenceInputSchema, draftSnapshotInputSchema

### Community 72 - "DataTable.vue"
Cohesion: 0.25
Nodes (8): cardColumns, DataTableColumn, emit, primaryKey, props, rows, sortableColumns, toggleSortDir()

### Community 73 - "[slug].vue"
Cohesion: 0.22
Nodes (8): { data, error }, { data: talentsData }, heroId, heroName, heroSeoDescription, route, talentsByTier, talentTiers

### Community 74 - "acquire"
Cohesion: 0.36
Nodes (7): acquire(), Prevents two copies of the daemon's tray app from running at once. Uses a named…, Returns True if this process now (exclusively) holds the daemon's single-…, _install_fake_win32_modules(), test_acquire_always_true_off_windows(), test_acquire_false_and_releases_handle_when_already_running(), test_acquire_true_when_no_other_instance_holds_it()

### Community 75 - "src/draft.ts"
Cohesion: 0.22
Nodes (8): DRAFT_MIN_RANKED_GAMES_FOR_RANKING, DRAFT_RANKED_MODES, DraftPreferenceInput, draftSlotInputSchema, DraftSlotStatus, draftSlotStatusSchema, DraftSnapshotInput, draftTeamInputSchema

### Community 76 - "shared-types/src/index.ts"
Cohesion: 0.21
Nodes (5): emit, isGlobal, props, AuthUser, HeroStatsScope

### Community 77 - "default.vue"
Cohesion: 0.25
Nodes (5): mobileNavItems, NavItem, navItems, route, sidebarExpanded

### Community 78 - "DEPLOYMENT.md — Raspberry Pi + Dokploy Guide"
Cohesion: 0.25
Nodes (5): Automatic DB Migrations on Container Startup, COOKIE_DOMAIN for Cross-Subdomain Session Sharing, Dokploy Separate Backend/Frontend Apps, DEPLOYMENT.md — Raspberry Pi + Dokploy Guide, README.md — HotS Analytics Overview

### Community 79 - "TopHeroesTop3.vue"
Cohesion: 0.29
Nodes (6): categories, Category, medals, props, rankings, TopHeroEntry

### Community 80 - "_version_gte"
Cohesion: 0.29
Nodes (5): True if `replay_hash` was already synced at `parser_version` or newer., Drops the "synced" record for every replay synced at a parser version older…, _version_gte(), _version_tuple(), test_version_tuple_numeric_compare()

### Community 81 - "trigger_manual_update"
Cohesion: 0.38
Nodes (7): Runs one check-and-apply cycle right now, on a background thread -- what the…, trigger_manual_update(), `apply_update_and_exit`'s diagnostics line only ever gets written during a real…, test_trigger_manual_update_applies_when_available(), test_trigger_manual_update_logs_diagnostics_even_when_up_to_date(), test_trigger_manual_update_reports_up_to_date(), _wait_until()

### Community 82 - "DraftTeamColumn.vue"
Cohesion: 0.33
Nodes (3): emit, props, DraftPlayerSlot

### Community 83 - "HOTS Stats Favicon"
Cohesion: 0.40
Nodes (6): prefers-color-scheme Dark Mode Adaptation, HOTS Stats Favicon, Stylized H Glyph with Compass Ticks, Hexagon Frame Mark, hotsGradient (Blue-to-Purple Linear Gradient), HOTS Stats Brand Identity

### Community 85 - "sync_state_file_path"
Cohesion: 0.40
Nodes (4): Connection, Path, Path to the local sync-state database, next to `config.json`., sync_state_file_path()

### Community 86 - "ReplayErrorRecord"
Cohesion: 0.50
Nodes (3): Every replay currently in an error state, most recent first -- backs the Debug…, One failed replay, as shown in the Debug window (gui.py)., ReplayErrorRecord

### Community 87 - "db/tsconfig.json"
Cohesion: 0.33
Nodes (5): extends, include, ../config/tsconfig-base/base.json, src, drizzle.config.ts

### Community 88 - "api/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, src, ../../packages/config/tsconfig-base/base.json

### Community 89 - "pages/index.vue"
Cohesion: 0.40
Nodes (3): columns, { data: recentMatches }, { data: summary }

### Community 91 - "shared-types/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, ../config/tsconfig-base/base.json, src

### Community 94 - "[handle].vue"
Cohesion: 0.50
Nodes (3): { data, error }, handle, route

### Community 98 - "Hero Detail OG Image"
Cohesion: 0.67
Nodes (3): Fava Hexagon Brand Logo, Hero Detail Page Route (/heroes/[slug]), Hero Detail OG Image

### Community 99 - "Home Page OG Image"
Cohesion: 0.67
Nodes (3): F Hexagon Brand Logo, Home Page (/), Home Page OG Image

### Community 100 - "Login Page OG Image"
Cohesion: 0.67
Nodes (3): Hexagonal Brand Logo Mark, Login Page (/login), Login Page OG Image

### Community 101 - "Match Detail OG Image"
Cohesion: 0.67
Nodes (3): FAVA Hexagon Logo Mark, Match Detail OG Image, Match Detail Page Route (/matches/[id])

### Community 102 - "Matches Index OG Image"
Cohesion: 0.67
Nodes (3): Matches Index OG Image, HOTS Stats Brand Logo (Hexagon F Icon), Matches Listing Page (/matches)

### Community 103 - "Player Profile OG Image"
Cohesion: 0.67
Nodes (3): hots-stats Hexagon Logo, Player Profile OG Image, /players/[battletag] Page Route

### Community 104 - "Players Index OG Image"
Cohesion: 0.67
Nodes (3): FAVA Hexagon Logo Mark, Players Index OG Image, Players Ranking Page (/players)

### Community 105 - "User Profile OG Image"
Cohesion: 0.67
Nodes (3): Hexagon Brand Logo (F monogram), User Profile OG Image, /u/[handle] Public Profile Page

## Knowledge Gaps
- **407 isolated node(s):** `QuarantineVerificationResult`, `DaemonErrorGroup`, `PatSummary`, `Env`, `FriendRequest` (+402 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **22 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `SyncState` connect `SyncState` to `ApiClient`, `_DaemonRunner`, `app.py`, `_version_gte`, `sync_state_file_path`, `test_config.py`, `ReplayErrorRecord`, `test_app.py`, `_now`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **Why does `UpdateStatusTracker` connect `UpdateStatusTracker` to `gui.py`, `test_updater.py`, `_FakeStreamingResponse`, `_DaemonRunner`, `app.py`, `trigger_manual_update`, `updater.py`, `_SettingsWindow`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Why does `_SettingsWindow` connect `_SettingsWindow` to `gui.py`, `guess_settings_url`, `app.py`, `._crop_to_photo`, `._build_ui`, `updater.py`, `UpdateStatusTracker`, `test_config.py`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `SyncState` (e.g. with `_DaemonRunner` and `IngestOutcome`) actually correct?**
  _`SyncState` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `_SettingsWindow` (e.g. with `UpdatePhase` and `UpdateStatus`) actually correct?**
  _`_SettingsWindow` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 5 inferred relationships involving `UpdateStatusTracker` (e.g. with `_DaemonRunner` and `_ProgressBarDriver`) actually correct?**
  _`UpdateStatusTracker` has 5 INFERRED edges - model-reasoned connections that need verification._
- **What connects `QuarantineVerificationResult`, `DaemonErrorGroup`, `PatSummary` to the rest of the system?**
  _407 weakly-connected nodes found - possible documentation gaps or missing edges._