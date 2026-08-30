# Graph Report - hots-stats  (2026-08-30)

## Corpus Check
- 395 files · ~776,587 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1627 nodes · 3274 edges · 101 communities (82 shown, 19 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 67 edges (avg confidence: 0.62)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `db817af7`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- test_parser.py
- draft_layout.py
- dependencies
- routes/matches.ts
- SyncState
- api_client.py
- OcrResult
- ApiClient
- api/src/index.ts
- test_draft_capture.py
- test_screen_capture.py
- internal.ts
- watch_replays
- api/package.json
- test_api_client.py
- routes/friends.ts
- TeamCropResult
- test_hotkey.py
- ocr.py
- db/package.json
- routes/auth.ts
- UpdateStatusTracker
- test_config.py
- daemon-python README
- ._set_status
- scripts
- auth-token.ts
- users.ts
- _SettingsWindow
- SpatialSlotGroup.vue
- draft_capture.py
- .__init__
- gui.py
- tray.py
- [id].vue
- find_update
- test_updater.py
- parser.py
- ingest.ts
- test_app.py
- main.py
- players.service.ts
- app.py
- compilerOptions
- draft.service.ts
- shared-types/package.json
- CLAUDE.md
- StatusTracker
- deathClustering.ts
- ._build_ui
- autostart.py
- updater.py
- SpatialHistorySlotConfig.vue
- useMatchSpatialSlot.ts
- [mapId].vue
- SpatialHeatmapView.vue
- TestChooseReading
- _sync_api_version
- _run_sync_loop
- fake_engines
- Path
- spatial.ts
- Lock
- guess_settings_url
- apply_update_and_exit
- _render_relaunch_script
- Enum
- Event
- _FakeStreamingResponse
- acquire
- DEPLOYMENT.md — Raspberry Pi + Dokploy Guide
- trigger_manual_update
- HOTS Stats Favicon
- str
- sync_state_file_path
- db/tsconfig.json
- api/tsconfig.json
- shared-types/tsconfig.json
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
7. `_DaemonRunner` - 26 edges
8. `StatusTracker` - 26 edges
9. `AvailableUpdate` - 24 edges
10. `build_payload()` - 24 edges

## Surprising Connections (you probably didn't know these)
- `file_hash_cache Table (skip re-hashing unchanged replays)` --semantically_similar_to--> `SQLite-backed Sync State Cache`  [INFERRED] [semantically similar]
  tasks/daemon-audit-2026-08-12.md → daemon-python/README.md
- `Epic 3 — Daemon & Ingestion Pipeline Brief` --conceptually_related_to--> `daemon-python README`  [INFERRED]
  tasks/epic-3-daemon-ingestion.md → daemon-python/README.md
- `Epic 4 — Daemon CI/CD Brief` --references--> `Build Daemon Workflow`  [EXTRACTED]
  tasks/epic-4-daemon-cicd.md → .github/workflows/build-daemon.yml
- `README.md — HotS Analytics Overview` --references--> `DEPLOYMENT.md — Raspberry Pi + Dokploy Guide`  [EXTRACTED]
  README.md → DEPLOYMENT.md
- `CapturePhase` --uses--> `TeamCropResult`  [INFERRED]
  daemon-python/src/draft_capture.py → daemon-python/src/draft_layout.py

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Dokploy Deployment Bundle** — deployment_guide, docker_compose_backend_compose, docker_compose_frontend_compose [EXTRACTED 1.00]
- **Epics Roadmap Bundle** — tasks_readme_roadmap, tasks_epic_3_daemon_ingestion_brief, tasks_epic_4_daemon_cicd_brief, tasks_epic_5_web_core_brief, tasks_epic_6_web_analytics_brief [EXTRACTED 1.00]
- **Daemon Hardening Audit Program** — daemon_python_readme_guide, tasks_daemon_audit_2026_08_12_report, concept_file_hash_cache, concept_initial_sync_threadpool, concept_proactive_tray_notifications [INFERRED 0.85]

## Communities (101 total, 19 thin omitted)

### Community 0 - "test_parser.py"
Cohesion: 0.07
Nodes (72): Any, Tracker stat name (e.g. "HeroDamage") -> API payload field name (e.g.…, stat_field_name(), _apply_score_event(), _attribute_scope_by_player_list_index(), build_payload(), _build_protocol(), _extract_battletags() (+64 more)

### Community 1 - "draft_layout.py"
Cohesion: 0.11
Nodes (41): _box_from_list(), _box_to_list(), crop_config_file_path(), _crop_rel(), default_crop_config(), ensure_crop_config_file(), extract_player_crops(), _extract_team() (+33 more)

### Community 2 - "dependencies"
Cohesion: 0.05
Nodes (40): dependencies, chart.js, @hots-stats/shared-types, nuxt, @nuxt/fonts, @nuxt/ui, sharp, vue (+32 more)

### Community 3 - "routes/matches.ts"
Cohesion: 0.07
Nodes (34): gameModeListSchema, buildMatchConditions(), Env, filtersQuerySchema, listQuerySchema, matchesRoute, SORTABLE_COLUMNS, displayNameFromSlug() (+26 more)

### Community 4 - "SyncState"
Cohesion: 0.06
Nodes (40): _now(), Local persistence of "this replay is already synced" state, backed by SQLite…, Tracks, per replay (keyed by content hash), whether it's synced or errored, at…, True if `replay_hash` was already synced at `parser_version` or newer., Records a failed parse/upload attempt so it shows up in the Debug report. A…, Drops the "synced" record for every replay synced at a parser version older…, Drops every "synced"/"error" record, regardless of parser version -- unlike…, Updates `file_exists` for every tracked replay against the set of… (+32 more)

### Community 5 - "api_client.py"
Cohesion: 0.13
Nodes (15): ApiClientError, AuthError, Exception, QuarantinedError, Thin HTTP client for POSTing parsed replay payloads to the ingestion API., POSTs a live-draft snapshot. Unlike `post_replay`, this is time-sensitive --…, POSTs one local ingestion failure to `/ingest/errors`, so it's triageable…, Base class for ingestion API errors. (+7 more)

### Community 6 - "OcrResult"
Cohesion: 0.22
Nodes (22): OcrResult, Reads a single player-name crop. Returns `OcrResult(None, 0.0)` for a missing…, read_player_name(), _crop(), Image, The multilingual engine failing to build (a corrupted install, a bad Nuitka…, A packaging mistake that drops `src/models/en_PP-OCRv5_rec_mobile.onnx` must…, A native ~30px-tall crop gives the recognition models far less detail to work… (+14 more)

### Community 7 - "ApiClient"
Cohesion: 0.18
Nodes (33): ApiClient, IngestResult, ingest_file(), IngestOutcome, Result of one `ingest_file` call, for callers that want to react to it: the…, Parses and uploads one replay. When `sync_state` is given, a replay already…, _config(), Mirrors sync_state's own local `mark_error` -- see `_report_error` in… (+25 more)

### Community 8 - "api/src/index.ts"
Cohesion: 0.14
Nodes (22): app, requireUser, healthRoute, Env, heroesRoute, listQuerySchema, publicRoute, Env (+14 more)

### Community 9 - "test_draft_capture.py"
Cohesion: 0.14
Nodes (29): capture_and_submit(), DraftCaptureCoordinator, Runs one full capture. Never raises: this is called directly from the global…, Thread-safe, shared across every hotkey-triggered capture for the daemon's…, _client(), _no_debug_log_handler(), fixture, A superseded (older) capture finishing after a newer one has already started… (+21 more)

### Community 10 - "test_screen_capture.py"
Cohesion: 0.11
Nodes (29): capture_foreground_window(), capture_game_window(), capture_window(), find_foreground_window(), find_game_window(), GameWindowNotFoundError, Exception, Image (+21 more)

### Community 11 - "internal.ts"
Cohesion: 0.12
Nodes (24): main(), errorsQuerySchema, internalRoute, paramsSchema, querySchema, resolveErrorsSchema, QuarantineVerificationResult, verifyQuarantinedBuild() (+16 more)

### Community 12 - "watch_replays"
Cohesion: 0.13
Nodes (26): Event, Lock, Path, Watches the replays folder for newly-written `.StormReplay` files., Polls the file size until it stops changing. Returns False if the file…, Lists `.StormReplay` files in `replays_dir` not already in `seen`, marks them…, Blocks, calling `on_replay_ready(path)` for each new stable `.StormReplay`…, _ReplayHandler (+18 more)

### Community 13 - "api/package.json"
Cohesion: 0.07
Nodes (28): dependencies, arctic, drizzle-orm, hono, @hots-stats/db, @hots-stats/shared-types, zod, devDependencies (+20 more)

### Community 14 - "test_api_client.py"
Cohesion: 0.14
Nodes (31): fetch_summary(), fetch_version(), ping_health(), True iff `GET {base_url}/health` responds 200. Used to validate the API Base…, Best-effort `GET {base_url}/ingest/version` fetch: `{"apiVersion": ...,…, Best-effort `GET {base_url}/ingest/summary` fetch, used to validate the Access…, _config(), _response() (+23 more)

### Community 15 - "routes/friends.ts"
Cohesion: 0.17
Nodes (25): Env, friendsRoute, matchesQuerySchema, scopeQuerySchema, searchQuerySchema, sendRequestSchema, areFriends(), cancelFriendRequest() (+17 more)

### Community 16 - "TeamCropResult"
Cohesion: 0.17
Nodes (25): debug_dir(), install_file_log_handler(), Image, Path, Persists debug artifacts for the live-draft capture feature -- every crop the…, Saves the full screenshot, every team/rotation/player-name crop, and a `crop-…, `%APPDATA%/hots-analytics/live-draft/`., Mirrors WARNING+ records from the live-draft modules into `live-draft/live-… (+17 more)

### Community 17 - "test_hotkey.py"
Cohesion: 0.12
Nodes (20): HotkeyManager, InvalidHotkeyError, Global keyboard shortcut that triggers a live-draft capture. Backed by the…, Raised by `validate` for a combo that can't be registered., Normalizes and validates a hotkey string (e.g. "ctrl+shift+d"), raising…, Registers a single global hotkey and calls `on_trigger` (on `keyboard`'s own…, Validates and registers `hotkey`, replacing any previously registered one. Logs…, validate() (+12 more)

### Community 18 - "ocr.py"
Cohesion: 0.14
Nodes (17): _background_color(), _clean_text(), _get_latin_engine(), _get_multilingual_engine(), _prepare_crop(), Image, OCR for the tiny player-name crops off the draft screen. Backed by RapidOCR…, Builds (and caches) RapidOCR's own default (multilingual) engine. Returns… (+9 more)

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
Cohesion: 0.09
Nodes (44): config_exists(), config_file_path(), ConfigError, default_replays_dir(), is_auto_update_enabled(), load_config(), open_config_folder(), open_path() (+36 more)

### Community 23 - "daemon-python README"
Cohesion: 0.10
Nodes (23): Auto-Update Self-Replace/Relaunch Handoff, Daemon pytest CI Job Kept Separate From Windows Release Build, Account Data Reset Wipes Local Sync Cache, file_hash_cache Table (skip re-hashing unchanged replays), Generation-Number Cooperative Capture Cancellation, ThreadPoolExecutor for Initial Sync Backlog, Live Draft Capture Feature, Nuitka Compilation Cache Persistence (+15 more)

### Community 24 - "._set_status"
Cohesion: 0.16
Nodes (6): Caps `text` at `max_chars`, replacing anything cut off with an ellipsis, so a…, Records a rebind by listening for the next real key combo instead of asking the…, Polled while the window is open (see `__init__`/`_on_close`) so a hotkey-…, _truncate(), Label, TestCaptureResult

### Community 25 - "scripts"
Cohesion: 0.09
Nodes (22): devDependencies, typescript, typescript, name, private, scripts, build, check-build (+14 more)

### Community 26 - "auth-token.ts"
Cohesion: 0.24
Nodes (9): generatePersonalAccessToken(), hashToken(), authToken, Env, createTokenSchema, tokensRoute, NewPersonalAccessToken, PersonalAccessToken (+1 more)

### Community 27 - "users.ts"
Cohesion: 0.11
Nodes (15): daemonErrorStatusEnum, daemonErrorTypeEnum, DaemonIngestError, daemonIngestErrors, NewDaemonIngestError, DraftPseudoPreference, draftPseudoPreferences, NewDraftPseudoPreference (+7 more)

### Community 29 - "SpatialSlotGroup.vue"
Cohesion: 0.07
Nodes (29): allowMatchScope, colorA, colorB, comparisonEnabled, effectiveGridCols, effectiveGridRows, exportView(), heatmapRef (+21 more)

### Community 30 - "draft_capture.py"
Cohesion: 0.11
Nodes (14): _build_team_payload(), CapturePhase, CaptureStatus, Enum, str, Orchestrates one live-draft capture: hotkey press -> find the game window ->…, Everything the settings window's "Tester la capture" button (see…, Runs the same screenshot -> crop -> OCR pipeline as a real hotkey press… (+6 more)

### Community 31 - ".__init__"
Cohesion: 0.18
Nodes (7): Locks the window to a fixed size and centers it. Without an explicit "WxH", Tk…, Temporarily fills every dynamically-updated label with max-length placeholder…, Opens the settings window and blocks (on the calling thread) until it's closed.…, run_settings_window(), DraftCaptureCoordinator, StatusTracker, SyncState

### Community 32 - "gui.py"
Cohesion: 0.12
Nodes (12): _apply_dark_style(), _format_update_status(), _ProgressBarDriver, Settings window: shown on first run to collect the 3 required fields, and…, Renders the updater's current phase as one French status line -- including…, Switches a `ttk.Progressbar` between determinate (a known 0-100%) and…, Builds the shared dark ttk theme -- called every time a window is created (the…, _UpdateProgressWindow (+4 more)

### Community 33 - "tray.py"
Cohesion: 0.22
Nodes (6): Base64-encoded tray icon PNG, generated from apps/web/public/favicon.svg (the…, _build_icon_image(), Image, System tray icon (pystray): reopen the settings window, or quit cleanly.…, Loads the app's icon (the web app's favicon, composited onto a small dark…, Lock

### Community 34 - "[id].vue"
Cohesion: 0.07
Nodes (27): allPlayers, annotationsStore, coachInsights, coachModalOpen, { data: authData }, { data, error }, displayedInsights, matchSeoDescription (+19 more)

### Community 35 - "find_update"
Cohesion: 0.19
Nodes (19): check_for_update(), find_update(), Pure decision logic, split out from `check_for_update` for testing: given a…, Best-effort check against GitHub's "latest release" API. Returns None on any…, _asset(), The asset itself is never versioned (see updater._ASSET_NAME) -- the release's…, Exact match, not a prefix/suffix check -- a differently-purposed asset that…, _release() (+11 more)

### Community 36 - "test_updater.py"
Cohesion: 0.14
Nodes (22): cleanup_stale_downloads(), downloads_dir(), parse_version(), _powershell_diagnostics(), Where a downloaded update build is staged before being handed off to the…, Clears `downloads_dir()` of anything left over from a previous run -- an update…, "v1.2.3" / "1.2.3" -> (1, 2, 3). None for anything that isn't a plain dotted-…, A best-effort environment fingerprint, logged right before every relaunch… (+14 more)

### Community 37 - "parser.py"
Cohesion: 0.17
Nodes (13): Static lookup tables used to translate raw replay data into the API's payload…, hash_replay_file(), Path, Stable, content-based hashing of replay files. A HotS replay file is never…, Returns the SHA-256 hex digest of the replay file's contents., Turns a replay file on disk into an upload, shared by the CLI (`main.py`) and…, Best-effort forwards one local ingestion failure to the API (`POST…, _report_error() (+5 more)

### Community 38 - "ingest.ts"
Cohesion: 0.09
Nodes (27): DefaultAdapter, ReplayValidationError, CUSTOM_ADAPTERS, getCustomAdapter(), resolveAdapter(), ParsedReplayData, ReplayAdapter, API_VERSION (+19 more)

### Community 39 - "test_app.py"
Cohesion: 0.15
Nodes (20): _DaemonRunner, Starts/stops the background replay-watcher thread, one instance at a time., Wires up `TrayController.notify` (message, title) so this runner can…, Checks the just-updated status and, the first time consecutive failures cross…, `announce_initial_scan`, when True, has the tray post a one-time "found N…, Config, _fail_once(), A run of failures crossing the threshold, then recovering, then failing again… (+12 more)

### Community 40 - "main.py"
Cohesion: 0.32
Nodes (6): Top-level launcher used only for the compiled (Nuitka) build. Nuitka compiles…, Path, Parses and (re-)uploads every replay in `replays_dir`. Safe to run repeatedly:…, resync(), main(), Entrypoint for the HotS Analytics replay daemon. Usage: python -m src.main #…

### Community 41 - "players.service.ts"
Cohesion: 0.14
Nodes (17): Env, listQuerySchema, playersRoute, getFriendshipStatuses(), encounterBase(), getPlayerHeroBreakdown(), listPlayerEncounters(), PlayerHeroBreakdown (+9 more)

### Community 42 - "app.py"
Cohesion: 0.15
Nodes (11): _notify_already_running(), Wires together first-run setup, the tray icon, and the background sync daemon.…, A second launch (double-click, or autostart racing a manual start) must not…, run_app(), A small, always-on-top standalone window shown while an update…, run_update_progress_window(), Blocks for the app's whole lifetime, pumping the tray icon's message loop., Shows a balloon/toast notification from the tray icon. Best-effort: not every… (+3 more)

### Community 43 - "compilerOptions"
Cohesion: 0.12
Nodes (16): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, lib, module, moduleResolution, noEmit (+8 more)

### Community 44 - "draft.service.ts"
Cohesion: 0.09
Nodes (36): draftRoute, Env, DraftEventSink, getCurrentSnapshotForViewer(), getPlayerDraftStats(), ingestDraftSnapshot(), isNewGame(), latestSnapshotByUserId (+28 more)

### Community 45 - "shared-types/package.json"
Cohesion: 0.12
Nodes (15): dependencies, zod, devDependencies, typescript, exports, typescript, zod, main (+7 more)

### Community 46 - "CLAUDE.md"
Cohesion: 0.29
Nodes (5): Architecture: replay ingestion, adapters, and versioning, Auth, Commands, graphify, Project

### Community 47 - "StatusTracker"
Cohesion: 0.15
Nodes (10): DaemonStatus, Thread-safe snapshot of the background daemon's live state: how many replays it…, StatusTracker, The initial backlog is ingested by a small pool of worker threads (see app.py's…, test_consecutive_failures_counts_a_run_without_success(), test_initial_snapshot_is_empty(), test_set_found_and_bump_found(), test_syncing_lifecycle_failure_keeps_last_error() (+2 more)

### Community 48 - "deathClustering.ts"
Cohesion: 0.16
Nodes (10): useMatchSpatialSlot(), buildSpatialEventPoints(), CLUSTER_DISTANCE_NORMALIZED, CLUSTER_TIME_WINDOW_SECONDS, clusterSpatialEvents(), find(), union(), distance() (+2 more)

### Community 49 - "._build_ui"
Cohesion: 0.21
Nodes (6): BooleanVar, Checkbutton, A `Checkbutton` styled to match the dark ttk theme (plain `tk`, not `ttk`,…, Grids a label + entry + status indicator starting at `start_row`. Returns…, Frame, Notebook

### Community 50 - "autostart.py"
Cohesion: 0.22
Nodes (12): is_enabled(), is_supported(), Launch at Windows startup" toggle, backed by the current user's `Run` registry…, True only for the compiled .exe on Windows: there's no installed binary to…, Best-effort: a registry write can fail (permissions, a locked-down machine) but…, set_enabled(), Regression test: the Run key must point at `installed_exe_path()` (the real,…, test_is_enabled_false_when_not_supported() (+4 more)

### Community 51 - "updater.py"
Cohesion: 0.12
Nodes (24): _append_update_log_line(), installed_exe_path(), manual_fallback_exe_path(), manual_fallback_message(), Background self-update: checks GitHub Releases for a daemon build newer than…, The path of the .exe the user actually launched (double-clicked, or the…, Where a downloaded update ends up if the automatic swap+relaunch could never be…, Best-effort copy of the already-downloaded `new_exe` to… (+16 more)

### Community 52 - "SpatialHistorySlotConfig.vue"
Cohesion: 0.17
Nodes (13): heroSelector, otherBattletag, outcome, playerMode, selectedHeroId, selectedRole, HISTORY_HERO_ROLES, HISTORY_ROLE_LABELS (+5 more)

### Community 53 - "useMatchSpatialSlot.ts"
Cohesion: 0.17
Nodes (11): emit, props, MatchSlotViewMode, ALLY_TEAM_RGB, colorForHeroIndex(), DEATH_MARKER_RGB, ENEMY_TEAM_RGB, HERO_CATEGORICAL_PALETTE (+3 more)

### Community 54 - "[mapId].vue"
Cohesion: 0.14
Nodes (14): { data: authData }, { data, error }, filteredMeta, mapId, mapName, metaColumns, metaSearch, personalColumns (+6 more)

### Community 55 - "SpatialHeatmapView.vue"
Cohesion: 0.18
Nodes (10): emit, imgEl, mapContainerEl, naturalHeight, naturalWidth, props, SpatialPresenceLayer, sumGridValues() (+2 more)

### Community 56 - "TestChooseReading"
Cohesion: 0.23
Nodes (4): _choose_reading(), Reconciles the two engines' votes for one crop. The multilingual engine wins…, `_choose_reading` is the pure decision function reconciling the two engines'…, TestChooseReading

### Community 57 - "_sync_api_version"
Cohesion: 0.26
Nodes (12): Called once per daemon start: asks the API its version and, if it reports a…, _sync_api_version(), _config(), Regression test: an install that has synced replays before but has never yet…, A genuinely fresh install (empty sync-state table, nothing ever synced) seeing…, test_sync_api_version_does_not_rewipe_on_unchanged_data_reset_at(), test_sync_api_version_first_sighting_is_a_noop_on_a_fresh_install(), test_sync_api_version_invalidates_stale_replays() (+4 more)

### Community 58 - "_run_sync_loop"
Cohesion: 0.22
Nodes (11): Event, Path, Uploads every replay already on disk -- via a small pool of worker threads, see…, _run_sync_loop(), Regression test for the bug this branch fixes: a folder that already had…, test_run_sync_loop_calls_on_initial_scan_once_with_the_found_count(), test_run_sync_loop_calls_on_initial_scan_with_zero_when_folder_is_empty(), test_run_sync_loop_ingests_existing_replays_before_watching() (+3 more)

### Community 59 - "fake_engines"
Cohesion: 0.67
Nodes (3): fake_engines(), fixture, Two independent fake engines, distinguished by whether RapidOCR was constructed…

### Community 61 - "spatial.ts"
Cohesion: 0.22
Nodes (8): props, MatchHeroTrajectory, MatchSlotHero, MatchSpatialData, MatchSpatialHero, SpatialAggregateResponse, SpatialOutcomeFilter, WireGrid

### Community 64 - "guess_settings_url"
Cohesion: 0.29
Nodes (8): guess_settings_url(), Helpers for the two well-known URLs the settings window links to: the API's…, Best-effort guess at the web dashboard's Settings page (where access tokens are…, test_guess_settings_url_adds_default_scheme(), test_guess_settings_url_falls_back_for_empty_input(), test_guess_settings_url_falls_back_for_unrecognized_host(), test_guess_settings_url_replaces_api_dot_prefix_with_app(), test_guess_settings_url_strips_api_dash_prefix()

### Community 65 - "apply_update_and_exit"
Cohesion: 0.24
Nodes (11): apply_update_and_exit(), Hands off to a detached PowerShell script that waits for this process (by pid)…, _fake_process(), The bug this guards against: `Popen` succeeding only means Windows accepted the…, Previously the quick-exit log line was pure guesswork ("likely blocked by…, The diagnostics line must be written on every attempt, success or failure, so a…, test_apply_update_and_exit_aborts_when_powershell_fails_to_launch(), test_apply_update_and_exit_aborts_when_relaunch_script_dies_immediately() (+3 more)

### Community 66 - "_render_relaunch_script"
Cohesion: 0.18
Nodes (11): Pure string-formatting split out from `apply_update_and_exit` so the script's…, _render_relaunch_script(), The bug this guards against: if Copy-Item never succeeds (e.g. a lingering…, `Start-Process` with a bare -FilePath goes through the same ShellExecute path…, Paths are interpolated with single quotes, not double quotes: a `$` in a…, `Start-Process` doesn't wait, so on its own it can't tell "relaunched and…, test_render_relaunch_script_falls_back_to_previous_version_on_copy_failure(), test_render_relaunch_script_includes_paths_version_and_retry_logic() (+3 more)

### Community 70 - "_FakeStreamingResponse"
Cohesion: 0.22
Nodes (5): download_update(), Streams the release asset to `dest_dir / update.asset_name`, calling…, _FakeStreamingResponse, test_download_update_reports_none_progress_without_content_length(), test_download_update_reports_progress_fraction()

### Community 74 - "acquire"
Cohesion: 0.36
Nodes (7): acquire(), Prevents two copies of the daemon's tray app from running at once. Uses a named…, Returns True if this process now (exclusively) holds the daemon's single-…, _install_fake_win32_modules(), test_acquire_always_true_off_windows(), test_acquire_false_and_releases_handle_when_already_running(), test_acquire_true_when_no_other_instance_holds_it()

### Community 78 - "DEPLOYMENT.md — Raspberry Pi + Dokploy Guide"
Cohesion: 0.25
Nodes (5): Automatic DB Migrations on Container Startup, COOKIE_DOMAIN for Cross-Subdomain Session Sharing, Dokploy Separate Backend/Frontend Apps, DEPLOYMENT.md — Raspberry Pi + Dokploy Guide, README.md — HotS Analytics Overview

### Community 81 - "trigger_manual_update"
Cohesion: 0.38
Nodes (7): Runs one check-and-apply cycle right now, on a background thread -- what the…, trigger_manual_update(), `apply_update_and_exit`'s diagnostics line only ever gets written during a real…, test_trigger_manual_update_applies_when_available(), test_trigger_manual_update_logs_diagnostics_even_when_up_to_date(), test_trigger_manual_update_reports_up_to_date(), _wait_until()

### Community 83 - "HOTS Stats Favicon"
Cohesion: 0.40
Nodes (6): prefers-color-scheme Dark Mode Adaptation, HOTS Stats Favicon, Stylized H Glyph with Compass Ticks, Hexagon Frame Mark, hotsGradient (Blue-to-Purple Linear Gradient), HOTS Stats Brand Identity

### Community 85 - "sync_state_file_path"
Cohesion: 0.40
Nodes (4): Connection, Path, Path to the local sync-state database, next to `config.json`., sync_state_file_path()

### Community 87 - "db/tsconfig.json"
Cohesion: 0.33
Nodes (5): extends, include, ../config/tsconfig-base/base.json, src, drizzle.config.ts

### Community 88 - "api/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, src, ../../packages/config/tsconfig-base/base.json

### Community 91 - "shared-types/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, ../config/tsconfig-base/base.json, src

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
- **329 isolated node(s):** `props`, `canvasEl`, `props`, `emit`, `imgEl` (+324 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `SyncState` connect `SyncState` to `parser.py`, `test_app.py`, `ApiClient`, `main.py`, `app.py`, `sync_state_file_path`, `_sync_api_version`, `_run_sync_loop`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._
- **Why does `_SettingsWindow` connect `_SettingsWindow` to `gui.py`, `guess_settings_url`, `._crop_to_photo`, `._build_ui`, `updater.py`, `UpdateStatusTracker`, `test_config.py`, `._set_status`, `.__init__`?**
  _High betweenness centrality (0.039) - this node is a cross-community bridge._
- **Why does `UpdateStatusTracker` connect `UpdateStatusTracker` to `gui.py`, `test_updater.py`, `_FakeStreamingResponse`, `test_app.py`, `app.py`, `trigger_manual_update`, `updater.py`, `_SettingsWindow`, `.__init__`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `SyncState` (e.g. with `_DaemonRunner` and `IngestOutcome`) actually correct?**
  _`SyncState` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `_SettingsWindow` (e.g. with `UpdatePhase` and `UpdateStatus`) actually correct?**
  _`_SettingsWindow` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 5 inferred relationships involving `UpdateStatusTracker` (e.g. with `_DaemonRunner` and `_ProgressBarDriver`) actually correct?**
  _`UpdateStatusTracker` has 5 INFERRED edges - model-reasoned connections that need verification._
- **What connects `props`, `canvasEl`, `props` to the rest of the system?**
  _329 weakly-connected nodes found - possible documentation gaps or missing edges._