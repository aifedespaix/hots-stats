# Graph Report - .  (2026-08-13)

## Corpus Check
- 203 files · ~178,567 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1737 nodes · 3386 edges · 132 communities (113 shown, 19 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 76 edges (avg confidence: 0.59)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Replay Stat Parsing
- Draft Screen Crop Layout
- Web App Dependencies
- Matches API Route
- Sync State Tracking
- Replay Adapter Registry
- OCR Engine Loading
- API Client Health Checks
- Replay Ingestion Client
- Draft Capture Coordinator
- Game Window Screen Capture
- Quarantine Build Verification
- Replay Folder Watcher
- API Package Dependencies
- Settings Data Reset UI
- Friends API Route
- Draft Debug Artifacts
- Global Hotkey Manager
- Heroes API Route
- DB Package Dependencies
- Auth Env & OAuth Session
- Updater State Tracking
- Daemon Config File
- Daemon Hardening Rationale
- Daemon API Client
- Web Dev Dependencies
- Personal Access Tokens
- Matches History Page
- Settings Window (Tkinter)
- Initial Sync ThreadPool
- Draft Capture Pipeline
- Draft Capture Test Tools
- Update Progress UI
- Tray Icon Assets
- Daemon Status Tracker
- Update Availability Check
- Update Version Parsing
- Daemon Ingest Errors Schema
- Match Detail Page
- Daemon Runner Orchestration
- Daemon Config Defaults
- Players API Route
- Daemon Entrypoint & Single Instance
- TypeScript Base Config
- Draft Service (API)
- Shared Types Package
- Friends List Page
- Players List Page
- Player Profile Page
- Settings Window Widgets
- Windows Autostart Registration
- Daemon Auto-Update Core
- Winrate Trend Chart
- Draft Player Stats UI
- Live Draft Page
- Ingestion Constants & Pipeline
- OCR Reading Reconciliation
- Friend Detail Page
- Heroes List Page
- API Version Sync Check
- Updater Install Paths
- Formatting Composable
- Friend & Hero Stat Types
- Settings Window Dark Theme
- Daemon URL Helpers
- Update Relaunch Handoff
- PowerShell Relaunch Script
- Analytics API Types
- Replay File Hashing
- OCR Crop Preparation
- Update Download Streaming
- Draft API Route
- Data Table Component
- Hero Detail Page
- Single Instance Guard
- Draft Shared Types
- Auth Composable
- App Navigation Layout
- Deployment & Dokploy Docs
- Top Heroes Widget
- Sync State Version Checks
- Manual Update Trigger
- Draft Team Column UI
- Favicon Brand Identity
- Match API Types
- Sync State DB Connection
- Sync State Error Records
- DB Package TS Config
- API Package TS Config
- Dashboard Page
- Auto-Update Preference
- Shared Types TS Config
- Draft Live Stream Composable
- Stats Scope Toggle
- Public Profile Page
- Sync State Error Marking
- Theme Switcher Component
- API Fetch Composable
- Hero Detail OG Image
- Home Page OG Image
- Login Page OG Image
- Match Detail OG Image
- Matches Index OG Image
- Player Profile OG Image
- Players Index OG Image
- Public Profile OG Image
- OG Image Generator Script
- Web Nuxt TS Config
- Daemon Icon Generator
- Protocol Manifest Generator
- Tkinter Image Helpers
- DB Migration Runner
- API Docker Entrypoint
- Draft Capture Test Screenshot
- Web Epics Briefs
- Font Specimen Asset
- Heroes Index OG Image
- Settings Page OG Image
- Daemon Package Root

## God Nodes (most connected - your core abstractions)
1. `SyncState` - 77 edges
2. `_SettingsWindow` - 61 edges
3. `ApiClient` - 45 edges
4. `UpdateStatusTracker` - 40 edges
5. `OcrResult` - 32 edges
6. `StatusTracker` - 32 edges
7. `ingest_file()` - 31 edges
8. `DraftCaptureCoordinator` - 28 edges
9. `_DaemonRunner` - 26 edges
10. `config_file_path()` - 24 edges

## Surprising Connections (you probably didn't know these)
- `file_hash_cache Table (skip re-hashing unchanged replays)` --semantically_similar_to--> `SQLite-backed Sync State Cache`  [INFERRED] [semantically similar]
  tasks/daemon-audit-2026-08-12.md → daemon-python/README.md
- `Epic 3 — Daemon & Ingestion Pipeline Brief` --conceptually_related_to--> `daemon-python README`  [INFERRED]
  tasks/epic-3-daemon-ingestion.md → daemon-python/README.md
- `DraftEventSink` --references--> `DraftSnapshot`  [EXTRACTED]
  apps/api/src/services/draft.service.ts → packages/shared-types/src/draft.ts
- `Section` --references--> `DraftHeroStat`  [EXTRACTED]
  apps/web/components/draft/DraftPlayerStats.vue → packages/shared-types/src/draft.ts
- `AuthUser` --references--> `HeroStatsScope`  [EXTRACTED]
  apps/web/composables/useAuth.ts → packages/shared-types/src/stats.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Epics Roadmap Bundle** — tasks_readme_roadmap, tasks_epic_3_daemon_ingestion_brief, tasks_epic_4_daemon_cicd_brief, tasks_epic_5_web_core_brief, tasks_epic_6_web_analytics_brief [EXTRACTED 1.00]
- **Daemon Hardening Audit Program** — daemon_python_readme_guide, tasks_daemon_audit_2026_08_12_report, concept_file_hash_cache, concept_initial_sync_threadpool, concept_proactive_tray_notifications [INFERRED 0.85]
- **Dokploy Deployment Bundle** — deployment_guide, docker_compose_backend_compose, docker_compose_frontend_compose [EXTRACTED 1.00]

## Communities (132 total, 19 thin omitted)

### Community 0 - "Replay Stat Parsing"
Cohesion: 0.07
Nodes (73): Any, Tracker stat name (e.g. "HeroDamage") -> API payload field name (e.g.…, stat_field_name(), _apply_score_event(), _attribute_scope_by_player_list_index(), build_payload(), _build_protocol(), _extract_battletags() (+65 more)

### Community 1 - "Draft Screen Crop Layout"
Cohesion: 0.11
Nodes (41): _box_from_list(), _box_to_list(), crop_config_file_path(), _crop_rel(), default_crop_config(), ensure_crop_config_file(), extract_player_crops(), _extract_team() (+33 more)

### Community 2 - "Web App Dependencies"
Cohesion: 0.05
Nodes (40): dependencies, chart.js, @hots-stats/shared-types, nuxt, @nuxt/fonts, @nuxt/ui, sharp, vue (+32 more)

### Community 3 - "Matches API Route"
Cohesion: 0.08
Nodes (32): buildMatchConditions(), Env, filtersQuerySchema, listQuerySchema, matchesRoute, SORTABLE_COLUMNS, displayNameFromSlug(), isVersionGreater() (+24 more)

### Community 4 - "Sync State Tracking"
Cohesion: 0.09
Nodes (29): Tracks, per replay (keyed by content hash), whether it's synced or errored, at…, Drops every "synced"/"error" record, regardless of parser version -- unlike…, Updates `file_exists` for every tracked replay against the set of…, Returns the previously computed hash for `file_path`, but only if its size and…, Records `file_path`'s freshly computed hash alongside the size/mtime it was…, SyncState, A replay overwritten in place (same size, by coincidence) but with a newer…, A daemon update that bumps PARSER_VERSION must make previously synced replays… (+21 more)

### Community 5 - "Replay Adapter Registry"
Cohesion: 0.11
Nodes (24): DefaultAdapter, ReplayValidationError, CUSTOM_ADAPTERS, getCustomAdapter(), resolveAdapter(), ParsedReplayData, ReplayAdapter, API_VERSION (+16 more)

### Community 6 - "OCR Engine Loading"
Cohesion: 0.12
Nodes (33): _get_latin_engine(), _get_multilingual_engine(), OcrResult, Builds (and caches) RapidOCR's own default (multilingual) engine. Returns…, Builds (and caches) the Latin-specialized engine -- see the module docstring.…, Eagerly loads and caches both OCR engines (see `_get_multilingual_engine` /…, Reads a single player-name crop. Returns `OcrResult(None, 0.0)` for a missing…, read_player_name() (+25 more)

### Community 7 - "API Client Health Checks"
Cohesion: 0.14
Nodes (31): fetch_summary(), fetch_version(), ping_health(), True iff `GET {base_url}/health` responds 200. Used to validate the API Base…, Best-effort `GET {base_url}/ingest/version` fetch: `{"apiVersion": ...,…, Best-effort `GET {base_url}/ingest/summary` fetch, used to validate the Access…, _config(), _response() (+23 more)

### Community 8 - "Replay Ingestion Client"
Cohesion: 0.20
Nodes (30): ApiClient, IngestResult, ingest_file(), Parses and uploads one replay. When `sync_state` is given, a replay already…, _config(), Mirrors sync_state's own local `mark_error` -- see `_report_error` in…, A bare `ingest_file(client, path)` call (no `sync_state`) is not the real…, Regression test for the KeyError('upserted') crash: the server quarantines… (+22 more)

### Community 9 - "Draft Capture Coordinator"
Cohesion: 0.14
Nodes (29): capture_and_submit(), DraftCaptureCoordinator, Runs one full capture. Never raises: this is called directly from the global…, Thread-safe, shared across every hotkey-triggered capture for the daemon's…, _client(), _no_debug_log_handler(), fixture, A superseded (older) capture finishing after a newer one has already started… (+21 more)

### Community 10 - "Game Window Screen Capture"
Cohesion: 0.11
Nodes (29): capture_foreground_window(), capture_game_window(), capture_window(), find_foreground_window(), find_game_window(), GameWindowNotFoundError, Exception, Image (+21 more)

### Community 11 - "Quarantine Build Verification"
Cohesion: 0.12
Nodes (24): main(), errorsQuerySchema, internalRoute, paramsSchema, querySchema, resolveErrorsSchema, QuarantineVerificationResult, verifyQuarantinedBuild() (+16 more)

### Community 12 - "Replay Folder Watcher"
Cohesion: 0.13
Nodes (26): Event, Lock, Path, Watches the replays folder for newly-written `.StormReplay` files., Polls the file size until it stops changing. Returns False if the file…, Lists `.StormReplay` files in `replays_dir` not already in `seen`, marks them…, Blocks, calling `on_replay_ready(path)` for each new stable `.StormReplay`…, _ReplayHandler (+18 more)

### Community 13 - "API Package Dependencies"
Cohesion: 0.07
Nodes (28): dependencies, arctic, drizzle-orm, hono, @hots-stats/db, @hots-stats/shared-types, zod, devDependencies (+20 more)

### Community 14 - "Settings Data Reset UI"
Cohesion: 0.07
Nodes (21): battletag, battletagError, canConfirmReset, config, createdToken, { data: tokensData, refresh: refreshTokens }, newTokenName, PatSummary (+13 more)

### Community 15 - "Friends API Route"
Cohesion: 0.17
Nodes (25): Env, friendsRoute, matchesQuerySchema, scopeQuerySchema, searchQuerySchema, sendRequestSchema, areFriends(), cancelFriendRequest() (+17 more)

### Community 16 - "Draft Debug Artifacts"
Cohesion: 0.17
Nodes (25): debug_dir(), install_file_log_handler(), Image, Path, Persists debug artifacts for the live-draft capture feature -- every crop the…, Saves the full screenshot, every team/rotation/player-name crop, and a `crop-…, `%APPDATA%/hots-analytics/live-draft/`., Mirrors WARNING+ records from the live-draft modules into `live-draft/live-… (+17 more)

### Community 17 - "Global Hotkey Manager"
Cohesion: 0.12
Nodes (20): HotkeyManager, InvalidHotkeyError, Global keyboard shortcut that triggers a live-draft capture. Backed by the…, Raised by `validate` for a combo that can't be registered., Normalizes and validates a hotkey string (e.g. "ctrl+shift+d"), raising…, Registers a single global hotkey and calls `on_trigger` (on `keyboard`'s own…, Validates and registers `hotkey`, replacing any previously registered one. Logs…, validate() (+12 more)

### Community 18 - "Heroes API Route"
Cohesion: 0.14
Nodes (19): app, requireUser, Env, heroesRoute, listQuerySchema, publicRoute, Env, statsRoute (+11 more)

### Community 19 - "DB Package Dependencies"
Cohesion: 0.08
Nodes (25): drizzle-kit, dependencies, drizzle-orm, postgres, devDependencies, drizzle-kit, @types/bun, typescript (+17 more)

### Community 20 - "Auth Env & OAuth Session"
Cohesion: 0.15
Nodes (18): env, envSchema, google, createSessionToken(), SESSION_COOKIE_MAX_AGE, SESSION_COOKIE_NAME, verifySessionToken(), authSession (+10 more)

### Community 21 - "Updater State Tracking"
Cohesion: 0.16
Nodes (24): AvailableUpdate, perform_update(), Event, Thread-safe last-known-state of the updater, polled by the settings window (see…, Downloads and applies `update`, reporting progress on `status` throughout.…, Runs for the app's lifetime on a background thread: checks for a newer release…, UpdateStatusTracker, watch_for_updates() (+16 more)

### Community 22 - "Daemon Config File"
Cohesion: 0.15
Nodes (20): config_exists(), config_file_path(), open_config_folder(), open_path(), Path, Daemon configuration: API endpoint, access token, and replays folder.…, Writes the user-provided fields to the JSON config file, creating its parent…, Path to the JSON config file, e.g. `%APPDATA%\\hots-analytics\\config.json`. (+12 more)

### Community 23 - "Daemon Hardening Rationale"
Cohesion: 0.10
Nodes (23): Auto-Update Self-Replace/Relaunch Handoff, Daemon pytest CI Job Kept Separate From Windows Release Build, Account Data Reset Wipes Local Sync Cache, file_hash_cache Table (skip re-hashing unchanged replays), Generation-Number Cooperative Capture Cancellation, ThreadPoolExecutor for Initial Sync Backlog, Live Draft Capture Feature, Nuitka Compilation Cache Persistence (+15 more)

### Community 24 - "Daemon API Client"
Cohesion: 0.14
Nodes (16): ApiClientError, AuthError, Exception, QuarantinedError, Thin HTTP client for POSTing parsed replay payloads to the ingestion API., POSTs a live-draft snapshot. Unlike `post_replay`, this is time-sensitive --…, POSTs one local ingestion failure to `/ingest/errors`, so it's triageable…, Base class for ingestion API errors. (+8 more)

### Community 25 - "Web Dev Dependencies"
Cohesion: 0.09
Nodes (22): devDependencies, typescript, typescript, name, private, scripts, build, check-build (+14 more)

### Community 26 - "Personal Access Tokens"
Cohesion: 0.17
Nodes (13): generatePersonalAccessToken(), hashToken(), authToken, Env, healthRoute, createTokenSchema, tokensRoute, Database (+5 more)

### Community 27 - "Matches History Page"
Cohesion: 0.10
Nodes (18): activeFilters, apiSortBy, columns, { data: filterOptions }, { data: matchesData, pending }, dateFrom, dateTo, FiltersResponse (+10 more)

### Community 29 - "Initial Sync ThreadPool"
Cohesion: 0.18
Nodes (18): Event, Path, Uploads every replay already on disk -- via a small pool of worker threads, see…, _run_sync_loop(), Regression test for the bug this branch fixes: a folder that already had…, A first run whose replays folder is empty has nothing to report -- the toast…, test_run_sync_loop_calls_on_initial_scan_once_with_the_found_count(), test_run_sync_loop_calls_on_initial_scan_with_zero_when_folder_is_empty() (+10 more)

### Community 30 - "Draft Capture Pipeline"
Cohesion: 0.12
Nodes (12): _build_team_payload(), CapturePhase, CaptureStatus, Enum, str, Orchestrates one live-draft capture: hotkey press -> find the game window ->…, Runs the same screenshot -> crop -> OCR pipeline as a real hotkey press…, No-ops if `generation` has since been superseded, so a stale run's phase update… (+4 more)

### Community 31 - "Draft Capture Test Tools"
Cohesion: 0.13
Nodes (7): Everything the settings window's "Tester la capture" button (see…, TestCaptureResult, Caps `text` at `max_chars`, replacing anything cut off with an ellipsis, so a…, Records a rebind by listening for the next real key combo instead of asking the…, Polled while the window is open (see `__init__`/`_on_close`) so a hotkey-…, _truncate(), Label

### Community 32 - "Update Progress UI"
Cohesion: 0.14
Nodes (9): _format_update_status(), _ProgressBarDriver, Renders the updater's current phase as one French status line -- including…, Switches a `ttk.Progressbar` between determinate (a known 0-100%) and…, _UpdateProgressWindow, Atomically claims the "downloading/installing" state, unless another download…, UpdateStatus, Progressbar (+1 more)

### Community 33 - "Tray Icon Assets"
Cohesion: 0.12
Nodes (11): Base64-encoded tray icon PNG, generated from apps/web/public/favicon.svg (the…, _build_icon_image(), Image, Lock, System tray icon (pystray): reopen the settings window, or quit cleanly.…, Loads the app's icon (the web app's favicon, composited onto a small dark…, Blocks for the app's whole lifetime, pumping the tray icon's message loop., Shows a balloon/toast notification from the tray icon. Best-effort: not every… (+3 more)

### Community 34 - "Daemon Status Tracker"
Cohesion: 0.16
Nodes (10): DaemonStatus, Thread-safe snapshot of the background daemon's live state: how many replays it…, StatusTracker, The initial backlog is ingested by a small pool of worker threads (see app.py's…, test_consecutive_failures_counts_a_run_without_success(), test_initial_snapshot_is_empty(), test_set_found_and_bump_found(), test_syncing_lifecycle_failure_keeps_last_error() (+2 more)

### Community 35 - "Update Availability Check"
Cohesion: 0.19
Nodes (19): check_for_update(), find_update(), Pure decision logic, split out from `check_for_update` for testing: given a…, Best-effort check against GitHub's "latest release" API. Returns None on any…, _asset(), The asset itself is never versioned (see updater._ASSET_NAME) -- the release's…, Exact match, not a prefix/suffix check -- a differently-purposed asset that…, _release() (+11 more)

### Community 36 - "Update Version Parsing"
Cohesion: 0.16
Nodes (18): parse_version(), _powershell_diagnostics(), v1.2.3" / "1.2.3" -> (1, 2, 3). None for anything that isn't a plain dotted-…, A best-effort environment fingerprint, logged right before every relaunch…, _no_real_temp_cleanup(), fixture, test_parse_version_none_for_dev_build(), test_parse_version_none_for_empty() (+10 more)

### Community 37 - "Daemon Ingest Errors Schema"
Cohesion: 0.11
Nodes (15): daemonErrorStatusEnum, daemonErrorTypeEnum, DaemonIngestError, daemonIngestErrors, NewDaemonIngestError, DraftPseudoPreference, draftPseudoPreferences, NewDraftPseudoPreference (+7 more)

### Community 38 - "Match Detail Page"
Cohesion: 0.14
Nodes (17): allPlayers, columns, { data: authData }, { data, error }, isAlly(), isMe(), matchSeoDescription, matchTitle (+9 more)

### Community 39 - "Daemon Runner Orchestration"
Cohesion: 0.14
Nodes (12): _DaemonRunner, Starts/stops the background replay-watcher thread, one instance at a time., Wires up `TrayController.notify` (message, title) so this runner can…, Checks the just-updated status and, the first time consecutive failures cross…, `announce_initial_scan`, when True, has the tray post a one-time "found N…, _fail_once(), A run of failures crossing the threshold, then recovering, then failing again…, A `_DaemonRunner` that never had `set_tray_notify` called (every headless test… (+4 more)

### Community 40 - "Daemon Config Defaults"
Cohesion: 0.20
Nodes (17): default_replays_dir(), load_config(), Best-effort guess at the default HotS replays folder, e.g.…, _clear_env(), fixture, test_default_replays_dir_globs_account_folders(), test_default_replays_dir_prefers_account_with_replays(), test_default_replays_dir_returns_none_when_absent() (+9 more)

### Community 41 - "Players API Route"
Cohesion: 0.18
Nodes (14): gameModeListSchema, Env, listQuerySchema, playersRoute, getFriendshipStatuses(), encounterBase(), getPlayerHeroBreakdown(), listPlayerEncounters() (+6 more)

### Community 42 - "Daemon Entrypoint & Single Instance"
Cohesion: 0.16
Nodes (14): Top-level launcher used only for the compiled (Nuitka) build. Nuitka compiles…, _notify_already_running(), Wires together first-run setup, the tray icon, and the background sync daemon.…, A second launch (double-click, or autostart racing a manual start) must not…, run_app(), ConfigError, Exception, Raised when required configuration is missing or invalid. (+6 more)

### Community 43 - "TypeScript Base Config"
Cohesion: 0.12
Nodes (16): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, lib, module, moduleResolution, noEmit (+8 more)

### Community 44 - "Draft Service (API)"
Cohesion: 0.21
Nodes (15): getCurrentSnapshotForViewer(), ingestDraftSnapshot(), isNewGame(), latestSnapshotByUserId, loadPreferences(), mergeTeam(), pooledNames(), publish() (+7 more)

### Community 45 - "Shared Types Package"
Cohesion: 0.12
Nodes (15): dependencies, zod, devDependencies, typescript, exports, typescript, zod, main (+7 more)

### Community 46 - "Friends List Page"
Cohesion: 0.20
Nodes (14): acceptRequest(), actionError, cancelRequest(), config, { data: friendsData, refresh: refreshFriends }, { data: requestsData, refresh: refreshRequests }, declineRequest(), extractError() (+6 more)

### Community 47 - "Players List Page"
Cohesion: 0.13
Nodes (12): columns, config, { data, refresh }, mode, modeOptions, { page, pageSize, total, paginated: pagedRows }, query, rows (+4 more)

### Community 48 - "Player Profile Page"
Cohesion: 0.14
Nodes (11): battletag, columns, config, { data, error, refresh }, { data: matchesData, pending }, page, playerSeoDescription, requestError (+3 more)

### Community 49 - "Settings Window Widgets"
Cohesion: 0.21
Nodes (6): BooleanVar, Checkbutton, A `Checkbutton` styled to match the dark ttk theme (plain `tk`, not `ttk`,…, Grids a label + entry + status indicator starting at `start_row`. Returns…, Frame, Notebook

### Community 50 - "Windows Autostart Registration"
Cohesion: 0.22
Nodes (12): is_enabled(), is_supported(), Launch at Windows startup" toggle, backed by the current user's `Run` registry…, True only for the compiled .exe on Windows: there's no installed binary to…, Best-effort: a registry write can fail (permissions, a locked-down machine) but…, set_enabled(), Regression test: the Run key must point at `installed_exe_path()` (the real,…, test_is_enabled_false_when_not_supported() (+4 more)

### Community 51 - "Daemon Auto-Update Core"
Cohesion: 0.19
Nodes (13): _append_update_log_line(), Enum, str, Background self-update: checks GitHub Releases for a daemon build newer than…, `%APPDATA%\\hots-analytics\\update.log` -- next to `config.json`. The relaunch…, The last `max_lines` of `update.log`, most recent last -- for showing "what…, Best-effort append to `update.log`, timestamped the same way the relaunch…, read_last_update_log_lines() (+5 more)

### Community 52 - "Winrate Trend Chart"
Cohesion: 0.18
Nodes (11): chartData, chartOptions, cumulative, CumulativePoint, emit, errored, pending, points (+3 more)

### Community 53 - "Draft Player Stats UI"
Cohesion: 0.19
Nodes (11): config, errored, medals, pending, props, Section, sections, stats (+3 more)

### Community 54 - "Live Draft Page"
Cohesion: 0.18
Nodes (9): applyOverrides(), capturedAgoLabel, config, overrides, ownBattletag, selectedBattletag, { snapshot, connected }, teamLeft (+1 more)

### Community 55 - "Ingestion Constants & Pipeline"
Cohesion: 0.17
Nodes (10): Static lookup tables used to translate raw replay data into the API's payload…, IngestOutcome, Path, Turns a replay file on disk into an upload, shared by the CLI (`main.py`) and…, Parses and (re-)uploads every replay in `replays_dir`. Safe to run repeatedly:…, Result of one `ingest_file` call, for callers that want to react to it: the…, Best-effort forwards one local ingestion failure to the API (`POST…, _report_error() (+2 more)

### Community 56 - "OCR Reading Reconciliation"
Cohesion: 0.23
Nodes (4): _choose_reading(), Reconciles the two engines' votes for one crop. The multilingual engine wins…, `_choose_reading` is the pure decision function reconciling the two engines'…, TestChooseReading

### Community 57 - "Friend Detail Page"
Cohesion: 0.17
Nodes (9): columns, { data, error }, { data: matchesData, pending: matchesPending }, friendId, friendName, page, route, { scope, saving: scopeSaving, setScope } (+1 more)

### Community 58 - "Heroes List Page"
Cohesion: 0.17
Nodes (10): columns, { data }, mode, modeOptions, { page, pageSize, total, paginated: pagedHeroes }, query, { scope, saving: scopeSaving, setScope }, search (+2 more)

### Community 59 - "API Version Sync Check"
Cohesion: 0.26
Nodes (12): Called once per daemon start: asks the API its version and, if it reports a…, _sync_api_version(), _config(), Regression test: an install that has synced replays before but has never yet…, A genuinely fresh install (empty sync-state table, nothing ever synced) seeing…, test_sync_api_version_does_not_rewipe_on_unchanged_data_reset_at(), test_sync_api_version_first_sighting_is_a_noop_on_a_fresh_install(), test_sync_api_version_invalidates_stale_replays() (+4 more)

### Community 60 - "Updater Install Paths"
Cohesion: 0.17
Nodes (12): cleanup_stale_downloads(), downloads_dir(), installed_exe_path(), Path, The path of the .exe the user actually launched (double-clicked, or the…, Where a downloaded update build is staged before being handed off to the…, Clears `downloads_dir()` of anything left over from a previous run -- an update…, test_cleanup_stale_downloads_noop_when_dir_absent() (+4 more)

### Community 61 - "Formatting Composable"
Cohesion: 0.18
Nodes (3): gameModeFilterGroups, gameModeLabels, heroRoleLabels

### Community 62 - "Friend & Hero Stat Types"
Cohesion: 0.25
Nodes (10): HeroStats, FriendRequestItem, FriendRequestsResponse, FriendSearchResponse, FriendSearchResult, FriendsListResponse, FriendSummaryResponse, FriendUser (+2 more)

### Community 63 - "Settings Window Dark Theme"
Cohesion: 0.18
Nodes (4): _apply_dark_style(), Locks the window to a fixed size and centers it. Without an explicit "WxH", Tk…, Temporarily fills every dynamically-updated label with max-length placeholder…, Builds the shared dark ttk theme once per process (both the main settings…

### Community 64 - "Daemon URL Helpers"
Cohesion: 0.29
Nodes (8): guess_settings_url(), Helpers for the two well-known URLs the settings window links to: the API's…, Best-effort guess at the web dashboard's Settings page (where access tokens are…, test_guess_settings_url_adds_default_scheme(), test_guess_settings_url_falls_back_for_empty_input(), test_guess_settings_url_falls_back_for_unrecognized_host(), test_guess_settings_url_replaces_api_dot_prefix_with_app(), test_guess_settings_url_strips_api_dash_prefix()

### Community 65 - "Update Relaunch Handoff"
Cohesion: 0.24
Nodes (11): apply_update_and_exit(), Hands off to a detached PowerShell script that waits for this process (by pid)…, _fake_process(), The bug this guards against: `Popen` succeeding only means Windows accepted the…, Previously the quick-exit log line was pure guesswork ("likely blocked by…, The diagnostics line must be written on every attempt, success or failure, so a…, test_apply_update_and_exit_aborts_when_powershell_fails_to_launch(), test_apply_update_and_exit_aborts_when_relaunch_script_dies_immediately() (+3 more)

### Community 66 - "PowerShell Relaunch Script"
Cohesion: 0.18
Nodes (11): Pure string-formatting split out from `apply_update_and_exit` so the script's…, _render_relaunch_script(), The bug this guards against: if Copy-Item never succeeds (e.g. a lingering…, `Start-Process` with a bare -FilePath goes through the same ShellExecute path…, Paths are interpolated with single quotes, not double quotes: a `$` in a…, `Start-Process` doesn't wait, so on its own it can't tell "relaunched and…, test_render_relaunch_script_falls_back_to_previous_version_on_copy_failure(), test_render_relaunch_script_includes_paths_version_and_retry_logic() (+3 more)

### Community 67 - "Analytics API Types"
Cohesion: 0.27
Nodes (9): HeroDetailResponse, HeroListResponse, HeroTalentsResponse, PlayerDetailResponse, PlayerHeroBreakdown, PlayerListResponse, PublicProfileResponse, PlayerEncounterStats (+1 more)

### Community 68 - "Replay File Hashing"
Cohesion: 0.33
Nodes (8): hash_replay_file(), Path, Stable, content-based hashing of replay files. A HotS replay file is never…, Returns the SHA-256 hex digest of the replay file's contents., Path, test_hash_differs_for_different_content(), test_hash_matches_manual_sha256(), test_hash_stable_across_calls()

### Community 69 - "OCR Crop Preparation"
Cohesion: 0.24
Nodes (9): _background_color(), _clean_text(), _prepare_crop(), Image, OCR for the tiny player-name crops off the draft screen. Backed by RapidOCR…, Upscales a player-name crop (Lanczos, for quality) and pads it with a border…, Runs one engine against an already-prepared (upscaled + padded) crop.…, _read_with_engine() (+1 more)

### Community 70 - "Update Download Streaming"
Cohesion: 0.22
Nodes (5): download_update(), Streams the release asset to `dest_dir / update.asset_name`, calling…, _FakeStreamingResponse, test_download_update_reports_none_progress_without_content_length(), test_download_update_reports_progress_fraction()

### Community 71 - "Draft API Route"
Cohesion: 0.31
Nodes (8): draftRoute, Env, getPlayerDraftStats(), setDraftPseudoPreference(), subscribeToDraftUpdates(), getPlayerEncounter(), draftPreferenceInputSchema, draftSnapshotInputSchema

### Community 72 - "Data Table Component"
Cohesion: 0.25
Nodes (8): cardColumns, DataTableColumn, emit, primaryKey, props, rows, sortableColumns, toggleSortDir()

### Community 73 - "Hero Detail Page"
Cohesion: 0.22
Nodes (8): { data, error }, { data: talentsData }, heroId, heroName, heroSeoDescription, route, talentsByTier, talentTiers

### Community 74 - "Single Instance Guard"
Cohesion: 0.36
Nodes (7): acquire(), Prevents two copies of the daemon's tray app from running at once. Uses a named…, Returns True if this process now (exclusively) holds the daemon's single-…, _install_fake_win32_modules(), test_acquire_always_true_off_windows(), test_acquire_false_and_releases_handle_when_already_running(), test_acquire_true_when_no_other_instance_holds_it()

### Community 75 - "Draft Shared Types"
Cohesion: 0.22
Nodes (8): DRAFT_MIN_RANKED_GAMES_FOR_RANKING, DRAFT_RANKED_MODES, DraftPreferenceInput, draftSlotInputSchema, DraftSlotStatus, draftSlotStatusSchema, DraftSnapshotInput, draftTeamInputSchema

### Community 77 - "App Navigation Layout"
Cohesion: 0.25
Nodes (5): mobileNavItems, NavItem, navItems, route, sidebarExpanded

### Community 78 - "Deployment & Dokploy Docs"
Cohesion: 0.25
Nodes (5): Automatic DB Migrations on Container Startup, COOKIE_DOMAIN for Cross-Subdomain Session Sharing, Dokploy Separate Backend/Frontend Apps, DEPLOYMENT.md — Raspberry Pi + Dokploy Guide, README.md — HotS Analytics Overview

### Community 79 - "Top Heroes Widget"
Cohesion: 0.29
Nodes (6): categories, Category, medals, props, rankings, TopHeroEntry

### Community 80 - "Sync State Version Checks"
Cohesion: 0.29
Nodes (5): True if `replay_hash` was already synced at `parser_version` or newer., Drops the "synced" record for every replay synced at a parser version older…, _version_gte(), _version_tuple(), test_version_tuple_numeric_compare()

### Community 81 - "Manual Update Trigger"
Cohesion: 0.38
Nodes (7): Runs one check-and-apply cycle right now, on a background thread -- what the…, trigger_manual_update(), `apply_update_and_exit`'s diagnostics line only ever gets written during a real…, test_trigger_manual_update_applies_when_available(), test_trigger_manual_update_logs_diagnostics_even_when_up_to_date(), test_trigger_manual_update_reports_up_to_date(), _wait_until()

### Community 82 - "Draft Team Column UI"
Cohesion: 0.33
Nodes (3): emit, props, DraftPlayerSlot

### Community 83 - "Favicon Brand Identity"
Cohesion: 0.40
Nodes (6): prefers-color-scheme Dark Mode Adaptation, HOTS Stats Favicon, Stylized H Glyph with Compass Ticks, Hexagon Frame Mark, hotsGradient (Blue-to-Purple Linear Gradient), HOTS Stats Brand Identity

### Community 84 - "Match API Types"
Cohesion: 0.47
Nodes (5): MatchDetailPlayer, MatchDetailResponse, MatchListItem, MatchListResponse, GameMode

### Community 85 - "Sync State DB Connection"
Cohesion: 0.40
Nodes (4): Connection, Path, Path to the local sync-state database, next to `config.json`., sync_state_file_path()

### Community 86 - "Sync State Error Records"
Cohesion: 0.33
Nodes (4): Local persistence of "this replay is already synced" state, backed by SQLite…, Every replay currently in an error state, most recent first -- backs the Debug…, One failed replay, as shown in the Debug window (gui.py)., ReplayErrorRecord

### Community 87 - "DB Package TS Config"
Cohesion: 0.33
Nodes (5): extends, include, ../config/tsconfig-base/base.json, src, drizzle.config.ts

### Community 88 - "API Package TS Config"
Cohesion: 0.40
Nodes (4): extends, include, src, ../../packages/config/tsconfig-base/base.json

### Community 89 - "Dashboard Page"
Cohesion: 0.40
Nodes (3): columns, { data: recentMatches }, { data: summary }

### Community 90 - "Auto-Update Preference"
Cohesion: 0.40
Nodes (5): is_auto_update_enabled(), Reads just the `autoUpdateEnabled` preference, independent of the rest of…, test_is_auto_update_enabled_reads_saved_value(), test_is_auto_update_enabled_true_on_unreadable_config(), test_is_auto_update_enabled_true_when_no_config_file()

### Community 91 - "Shared Types TS Config"
Cohesion: 0.40
Nodes (4): extends, include, ../config/tsconfig-base/base.json, src

### Community 93 - "Stats Scope Toggle"
Cohesion: 0.67
Nodes (3): emit, isGlobal, props

### Community 94 - "Public Profile Page"
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

### Community 105 - "Public Profile OG Image"
Cohesion: 0.67
Nodes (3): Hexagon Brand Logo (F monogram), User Profile OG Image, /u/[handle] Public Profile Page

## Knowledge Gaps
- **407 isolated node(s):** `docker-entrypoint.sh script`, `name`, `version`, `private`, `type` (+402 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `_SettingsWindow` connect `Settings Window (Tkinter)` to `Daemon URL Helpers`, `Update Progress UI`, `Daemon Status Tracker`, `Sync State Tracking`, `OCR Engine Loading`, `Draft Capture Coordinator`, `Daemon Entrypoint & Single Instance`, `Tkinter Image Helpers`, `Draft Debug Artifacts`, `Settings Window Widgets`, `Daemon Auto-Update Core`, `Updater State Tracking`, `Daemon Config File`, `Settings Window Dark Theme`, `Draft Capture Pipeline`, `Draft Capture Test Tools`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **Why does `SyncState` connect `Sync State Tracking` to `Update Progress UI`, `Daemon Runner Orchestration`, `Replay Ingestion Client`, `Daemon Entrypoint & Single Instance`, `Sync State Version Checks`, `Sync State DB Connection`, `Daemon Config File`, `Ingestion Constants & Pipeline`, `Sync State Error Records`, `API Version Sync Check`, `Settings Window (Tkinter)`, `Initial Sync ThreadPool`, `Sync State Error Marking`, `Settings Window Dark Theme`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **Why does `UpdateStatusTracker` connect `Updater State Tracking` to `Update Progress UI`, `Update Version Parsing`, `Update Download Streaming`, `Daemon Runner Orchestration`, `Daemon Entrypoint & Single Instance`, `Manual Update Trigger`, `Daemon Auto-Update Core`, `Daemon Config File`, `Settings Window (Tkinter)`, `Settings Window Dark Theme`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `SyncState` (e.g. with `_DaemonRunner` and `_ProgressBarDriver`) actually correct?**
  _`SyncState` has 5 INFERRED edges - model-reasoned connections that need verification._
- **Are the 9 inferred relationships involving `_SettingsWindow` (e.g. with `CapturePhase` and `DraftCaptureCoordinator`) actually correct?**
  _`_SettingsWindow` has 9 INFERRED edges - model-reasoned connections that need verification._
- **Are the 5 inferred relationships involving `UpdateStatusTracker` (e.g. with `_DaemonRunner` and `_ProgressBarDriver`) actually correct?**
  _`UpdateStatusTracker` has 5 INFERRED edges - model-reasoned connections that need verification._
- **Are the 8 inferred relationships involving `OcrResult` (e.g. with `CapturePhase` and `CaptureStatus`) actually correct?**
  _`OcrResult` has 8 INFERRED edges - model-reasoned connections that need verification._