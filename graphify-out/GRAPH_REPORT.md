# Graph Report - hots-stats  (2026-08-30)

## Corpus Check
- 401 files · ~797,359 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1936 nodes · 3998 edges · 123 communities (100 shown, 23 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 78 edges (avg confidence: 0.61)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `3af985f9`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- parser.py
- draft_layout.py
- dependencies
- seed.ts
- SyncState
- Config
- OcrResult
- test_ingestion.py
- match-players.ts
- test_draft_capture.py
- test_screen_capture.py
- internal.ts
- watch_replays
- api/package.json
- ApiClient
- routes/friends.ts
- TeamCropResult
- test_hotkey.py
- build_payload
- db/package.json
- routes/auth.ts
- UpdateStatusTracker
- app.py
- daemon-python README
- users
- scripts
- db/src/index.ts
- test_parser.py
- _SettingsWindow
- SpatialSlotGroup.vue
- draft_capture.py
- find_update
- gui.py
- test_app.py
- [id].vue
- test_updater.py
- replay-payload.ts
- test_hasher.py
- shared-types/src/index.ts
- StatusTracker
- sync_state.py
- players.service.ts
- TrayController
- compilerOptions
- draft.service.ts
- shared-types/package.json
- CLAUDE.md
- _unit_born_event
- deathClustering.ts
- src/draft.ts
- autostart.py
- updater.py
- SpatialHistorySlotConfig.vue
- useMatchSpatialSlot.ts
- [mapId].vue
- calibrate.vue
- TestChooseReading
- ._build_ui
- ReplayParseError
- index.vue
- Path
- spatial.ts
- DraftPseudoCombobox.vue
- Lock
- guess_settings_url
- _unit_died_event
- DraftTeamColumn.vue
- SpatialHeatmapView.vue
- Enum
- Event
- _FakeStreamingResponse
- _sync_api_version
- routes/matches.ts
- ingest.ts
- acquire
- Exception
- Path
- admin-spatial.ts
- DEPLOYMENT.md — Raspberry Pi + Dokploy Guide
- talents.service.ts
- spatial-calibration.ts
- build-verification.service.ts
- quarantine.ts
- HOTS Stats Favicon
- str
- sync_state_file_path
- daemon-error.ts
- db/tsconfig.json
- api/tsconfig.json
- spatial-layer.ts
- apply_update_and_exit
- shared-types/tsconfig.json
- _render_relaunch_script
- run_settings_window
- CalibrationCanvas.vue
- ._crop_to_photo
- trigger_manual_update
- SpatialCanvasLayer.vue
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
- constants.py
- migrate.ts
- docker-entrypoint.sh
- _report_error
- _clear_env
- HOTS Draft Capture / OCR
- Epic 5 — Web Core Brief
- Bw Modelica Font Specimen (PDF)
- Heroes Index OG Image
- Settings Page OG Image
- hots-analytics-daemon

## God Nodes (most connected - your core abstractions)
1. `SyncState` - 71 edges
2. `build_payload()` - 66 edges
3. `_SettingsWindow` - 56 edges
4. `ApiClient` - 45 edges
5. `_base_tracker_events()` - 42 edges
6. `_details()` - 40 edges
7. `UpdateStatusTracker` - 40 edges
8. `_initdata()` - 39 edges
9. `_header()` - 39 edges
10. `_battletags()` - 38 edges

## Surprising Connections (you probably didn't know these)
- `file_hash_cache Table (skip re-hashing unchanged replays)` --semantically_similar_to--> `SQLite-backed Sync State Cache`  [INFERRED] [semantically similar]
  tasks/daemon-audit-2026-08-12.md → daemon-python/README.md
- `Epic 3 — Daemon & Ingestion Pipeline Brief` --conceptually_related_to--> `daemon-python README`  [INFERRED]
  tasks/epic-3-daemon-ingestion.md → daemon-python/README.md
- `Epic 4 — Daemon CI/CD Brief` --references--> `Build Daemon Workflow`  [EXTRACTED]
  tasks/epic-4-daemon-cicd.md → .github/workflows/build-daemon.yml
- `README.md — HotS Analytics Overview` --references--> `DEPLOYMENT.md — Raspberry Pi + Dokploy Guide`  [EXTRACTED]
  README.md → DEPLOYMENT.md
- `test_build_payload_aram_never_falls_back_to_hero_attribute()` --uses--> `ReplayParseError`  [INFERRED]
  daemon-python/tests/test_parser.py → daemon-python/src/parser.py

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Dokploy Deployment Bundle** — deployment_guide, docker_compose_backend_compose, docker_compose_frontend_compose [EXTRACTED 1.00]
- **Epics Roadmap Bundle** — tasks_readme_roadmap, tasks_epic_3_daemon_ingestion_brief, tasks_epic_4_daemon_cicd_brief, tasks_epic_5_web_core_brief, tasks_epic_6_web_analytics_brief [EXTRACTED 1.00]
- **Daemon Hardening Audit Program** — daemon_python_readme_guide, tasks_daemon_audit_2026_08_12_report, concept_file_hash_cache, concept_initial_sync_threadpool, concept_proactive_tray_notifications [INFERRED 0.85]

## Communities (123 total, 23 thin omitted)

### Community 0 - "parser.py"
Cohesion: 0.07
Nodes (42): Any, _apply_score_event(), _attribute_scope_by_player_list_index(), _extract_battletags(), _extract_level_snapshots(), _extract_spatial(), _extract_trajectories(), _hero_attribute_code() (+34 more)

### Community 1 - "draft_layout.py"
Cohesion: 0.11
Nodes (41): _box_from_list(), _box_to_list(), crop_config_file_path(), _crop_rel(), default_crop_config(), ensure_crop_config_file(), extract_player_crops(), _extract_team() (+33 more)

### Community 2 - "dependencies"
Cohesion: 0.05
Nodes (40): dependencies, chart.js, @hots-stats/shared-types, nuxt, @nuxt/fonts, @nuxt/ui, sharp, vue (+32 more)

### Community 3 - "seed.ts"
Cohesion: 0.08
Nodes (26): HeroMapGlobalSpatialRollup, HeroMapPlayerSpatialRollup, matchOutcomeEnum, NewHeroMapGlobalSpatialRollup, NewHeroMapPlayerSpatialRollup, Hero, heroes, heroRoleEnum (+18 more)

### Community 4 - "SyncState"
Cohesion: 0.09
Nodes (29): Tracks, per replay (keyed by content hash), whether it's synced or errored, at…, Drops every "synced"/"error" record, regardless of parser version -- unlike…, Updates `file_exists` for every tracked replay against the set of…, Returns the previously computed hash for `file_path`, but only if its size and…, Records `file_path`'s freshly computed hash alongside the size/mtime it was…, SyncState, A replay overwritten in place (same size, by coincidence) but with a newer…, A daemon update that bumps PARSER_VERSION must make previously synced replays… (+21 more)

### Community 5 - "Config"
Cohesion: 0.14
Nodes (16): ApiClientError, AuthError, Exception, QuarantinedError, Thin HTTP client for POSTing parsed replay payloads to the ingestion API., POSTs a live-draft snapshot. Unlike `post_replay`, this is time-sensitive --…, POSTs one local ingestion failure to `/ingest/errors`, so it's triageable…, Base class for ingestion API errors. (+8 more)

### Community 6 - "OcrResult"
Cohesion: 0.09
Nodes (43): _build_team_payload(), _background_color(), _clean_text(), _get_latin_engine(), _get_multilingual_engine(), OcrResult, _prepare_crop(), Image (+35 more)

### Community 7 - "test_ingestion.py"
Cohesion: 0.12
Nodes (40): IngestResult, hash_replay_file(), Path, Stable, content-based hashing of replay files. A HotS replay file is never…, Returns the SHA-256 hex digest of the replay file's contents., ingest_file(), IngestOutcome, Path (+32 more)

### Community 8 - "match-players.ts"
Cohesion: 0.11
Nodes (16): killTypeEnum, MatchDeath, matchDeaths, NewMatchDeath, matchHeroTrajectories, MatchHeroTrajectory, NewMatchHeroTrajectory, MatchPlayer (+8 more)

### Community 9 - "test_draft_capture.py"
Cohesion: 0.10
Nodes (32): capture_and_submit(), CaptureStatus, DraftCaptureCoordinator, Runs one full capture. Never raises: this is called directly from the global…, Thread-safe, shared across every hotkey-triggered capture for the daemon's…, No-ops if `generation` has since been superseded, so a stale run's phase update…, Like `finish`, but leaves the failure visible (ERROR, with `message`) instead…, _client() (+24 more)

### Community 10 - "test_screen_capture.py"
Cohesion: 0.11
Nodes (29): capture_foreground_window(), capture_game_window(), capture_window(), find_foreground_window(), find_game_window(), GameWindowNotFoundError, Exception, Image (+21 more)

### Community 11 - "internal.ts"
Cohesion: 0.26
Nodes (10): errorsQuerySchema, internalRoute, paramsSchema, querySchema, resolveErrorsSchema, DaemonErrorGroup, getDaemonErrorGroups(), markDaemonErrorsResolved() (+2 more)

### Community 12 - "watch_replays"
Cohesion: 0.13
Nodes (26): Event, Lock, Path, Watches the replays folder for newly-written `.StormReplay` files., Polls the file size until it stops changing. Returns False if the file…, Lists `.StormReplay` files in `replays_dir` not already in `seen`, marks them…, Blocks, calling `on_replay_ready(path)` for each new stable `.StormReplay`…, _ReplayHandler (+18 more)

### Community 13 - "api/package.json"
Cohesion: 0.07
Nodes (28): dependencies, arctic, drizzle-orm, hono, @hots-stats/db, @hots-stats/shared-types, zod, devDependencies (+20 more)

### Community 14 - "ApiClient"
Cohesion: 0.16
Nodes (32): ApiClient, fetch_summary(), fetch_version(), ping_health(), True iff `GET {base_url}/health` responds 200. Used to validate the API Base…, Best-effort `GET {base_url}/ingest/version` fetch: `{"apiVersion": ...,…, Best-effort `GET {base_url}/ingest/summary` fetch, used to validate the Access…, _config() (+24 more)

### Community 15 - "routes/friends.ts"
Cohesion: 0.16
Nodes (26): Env, friendsRoute, matchesQuerySchema, scopeQuerySchema, searchQuerySchema, sendRequestSchema, areFriends(), cancelFriendRequest() (+18 more)

### Community 16 - "TeamCropResult"
Cohesion: 0.17
Nodes (25): debug_dir(), install_file_log_handler(), Image, Path, Persists debug artifacts for the live-draft capture feature -- every crop the…, Saves the full screenshot, every team/rotation/player-name crop, and a `crop-…, `%APPDATA%/hots-analytics/live-draft/`., Mirrors WARNING+ records from the live-draft modules into `live-draft/live-… (+17 more)

### Community 17 - "test_hotkey.py"
Cohesion: 0.12
Nodes (20): HotkeyManager, InvalidHotkeyError, Global keyboard shortcut that triggers a live-draft capture. Backed by the…, Raised by `validate` for a combo that can't be registered., Normalizes and validates a hotkey string (e.g. "ctrl+shift+d"), raising…, Registers a single global hotkey and calls `on_trigger` (on `keyboard`'s own…, Validates and registers `hotkey`, replacing any previously registered one. Logs…, validate() (+12 more)

### Community 18 - "build_payload"
Cohesion: 0.13
Nodes (69): build_payload(), Pure transformation from decoded replay structures to the API payload. Split…, _attributes_events(), _base_attributes_events(), _base_tracker_events(), _battletags(), _details(), _end_of_game_event() (+61 more)

### Community 19 - "db/package.json"
Cohesion: 0.08
Nodes (25): drizzle-kit, dependencies, drizzle-orm, postgres, devDependencies, drizzle-kit, @types/bun, typescript (+17 more)

### Community 20 - "routes/auth.ts"
Cohesion: 0.16
Nodes (17): env, envSchema, google, createSessionToken(), SESSION_COOKIE_MAX_AGE, SESSION_COOKIE_NAME, verifySessionToken(), authSession (+9 more)

### Community 21 - "UpdateStatusTracker"
Cohesion: 0.13
Nodes (27): AvailableUpdate, perform_update(), Thread-safe last-known-state of the updater, polled by the settings window (see…, Downloads and applies `update`, reporting progress on `status` throughout.…, Runs for the app's lifetime on a background thread: checks for a newer release…, UpdateStatusTracker, watch_for_updates(), `apply_update_and_exit` returning False means it aborted instead of exiting… (+19 more)

### Community 22 - "app.py"
Cohesion: 0.09
Nodes (46): Top-level launcher used only for the compiled (Nuitka) build. Nuitka compiles…, _notify_already_running(), Wires together first-run setup, the tray icon, and the background sync daemon.…, A second launch (double-click, or autostart racing a manual start) must not…, run_app(), config_exists(), config_file_path(), ConfigError (+38 more)

### Community 23 - "daemon-python README"
Cohesion: 0.10
Nodes (23): Auto-Update Self-Replace/Relaunch Handoff, Daemon pytest CI Job Kept Separate From Windows Release Build, Account Data Reset Wipes Local Sync Cache, file_hash_cache Table (skip re-hashing unchanged replays), Generation-Number Cooperative Capture Cancellation, ThreadPoolExecutor for Initial Sync Backlog, Live Draft Capture Feature, Nuitka Compilation Cache Persistence (+15 more)

### Community 24 - "users"
Cohesion: 0.09
Nodes (25): generatePersonalAccessToken(), hashToken(), authToken, Env, createTokenSchema, tokensRoute, daemonErrorStatusEnum, daemonErrorTypeEnum (+17 more)

### Community 25 - "scripts"
Cohesion: 0.09
Nodes (22): devDependencies, typescript, typescript, name, private, scripts, build, check-build (+14 more)

### Community 26 - "db/src/index.ts"
Cohesion: 0.19
Nodes (11): app, healthRoute, Env, statsRoute, summaryQuerySchema, getStatsSummary(), StatsSummary, Database (+3 more)

### Community 27 - "test_parser.py"
Cohesion: 0.06
Nodes (51): _distribute_segment_across_cells(), _game_version(), _has_computer_player_attribute(), _hero_from_any_talent(), _hero_from_name_prefix(), _hero_from_talent_prefix(), _hero_from_unit_type_name(), _hero_unit_tags_by_toon() (+43 more)

### Community 28 - "_SettingsWindow"
Cohesion: 0.08
Nodes (10): Caps `text` at `max_chars`, replacing anything cut off with an ellipsis, so a…, Locks the window to a fixed size and centers it. Without an explicit "WxH", Tk…, Temporarily fills every dynamically-updated label with max-length placeholder…, `self._root.after(0, func, *args)`, but a no-op once the window has closed.…, Records a rebind by listening for the next real key combo instead of asking the…, Polled while the window is open (see `__init__`/`_on_close`) so a hotkey-…, _SettingsWindow, _truncate() (+2 more)

### Community 29 - "SpatialSlotGroup.vue"
Cohesion: 0.07
Nodes (29): allowMatchScope, colorA, colorB, comparisonEnabled, effectiveGridCols, effectiveGridRows, exportView(), heatmapRef (+21 more)

### Community 30 - "draft_capture.py"
Cohesion: 0.22
Nodes (10): CapturePhase, Enum, str, Orchestrates one live-draft capture: hotkey press -> find the game window ->…, Everything the settings window's "Tester la capture" button (see…, Runs the same screenshot -> crop -> OCR pipeline as a real hotkey press…, run_test_capture(), TestCaptureResult (+2 more)

### Community 31 - "find_update"
Cohesion: 0.19
Nodes (19): check_for_update(), find_update(), Pure decision logic, split out from `check_for_update` for testing: given a…, Best-effort check against GitHub's "latest release" API. Returns None on any…, _asset(), The asset itself is never versioned (see updater._ASSET_NAME) -- the release's…, Exact match, not a prefix/suffix check -- a differently-purposed asset that…, _release() (+11 more)

### Community 32 - "gui.py"
Cohesion: 0.09
Nodes (17): open_path(), Path, Opens `path` (a file or a folder) with whatever the OS considers its default…, _apply_dark_style(), _format_update_status(), _ProgressBarDriver, Settings window: shown on first run to collect the 3 required fields, and…, Renders the updater's current phase as one French status line -- including… (+9 more)

### Community 33 - "test_app.py"
Cohesion: 0.13
Nodes (19): _DaemonRunner, Starts/stops the background replay-watcher thread, one instance at a time., Wires up `TrayController.notify` (message, title) so this runner can…, Checks the just-updated status and, the first time consecutive failures cross…, `announce_initial_scan`, when True, has the tray post a one-time "found N…, _fail_once(), A run of failures crossing the threshold, then recovering, then failing again…, A `_DaemonRunner` that never had `set_tray_notify` called (every headless test… (+11 more)

### Community 34 - "[id].vue"
Cohesion: 0.07
Nodes (27): allPlayers, annotationsStore, coachInsights, coachModalOpen, { data: authData }, { data, error }, displayedInsights, matchSeoDescription (+19 more)

### Community 35 - "test_updater.py"
Cohesion: 0.14
Nodes (22): cleanup_stale_downloads(), downloads_dir(), parse_version(), _powershell_diagnostics(), Where a downloaded update build is staged before being handed off to the…, Clears `downloads_dir()` of anything left over from a previous run -- an update…, "v1.2.3" / "1.2.3" -> (1, 2, 3). None for anything that isn't a plain dotted-…, A best-effort environment fingerprint, logged right before every relaunch… (+14 more)

### Community 36 - "replay-payload.ts"
Cohesion: 0.10
Nodes (20): KillType, killTypeSchema, MatchHeroTrajectory, matchHeroTrajectorySchema, MatchStructureEvent, matchStructureEventSchema, MatchTimeline, MatchTimelineDeath (+12 more)

### Community 37 - "test_hasher.py"
Cohesion: 0.60
Nodes (4): Path, test_hash_differs_for_different_content(), test_hash_matches_manual_sha256(), test_hash_stable_across_calls()

### Community 38 - "shared-types/src/index.ts"
Cohesion: 0.28
Nodes (8): DefaultAdapter, ReplayValidationError, CUSTOM_ADAPTERS, getCustomAdapter(), resolveAdapter(), ParsedReplayData, ReplayAdapter, replayPayloadSchema

### Community 39 - "StatusTracker"
Cohesion: 0.11
Nodes (21): Event, Path, Uploads every replay already on disk -- via a small pool of worker threads, see…, _run_sync_loop(), DaemonStatus, Thread-safe snapshot of the background daemon's live state: how many replays it…, StatusTracker, Regression test for the bug this branch fixes: a folder that already had… (+13 more)

### Community 40 - "sync_state.py"
Cohesion: 0.12
Nodes (11): _now(), Local persistence of "this replay is already synced" state, backed by SQLite…, True if `replay_hash` was already synced at `parser_version` or newer., Records a failed parse/upload attempt so it shows up in the Debug report. A…, Drops the "synced" record for every replay synced at a parser version older…, Every replay currently in an error state, most recent first -- backs the Debug…, One failed replay, as shown in the Debug window (gui.py)., ReplayErrorRecord (+3 more)

### Community 41 - "players.service.ts"
Cohesion: 0.24
Nodes (12): Env, listQuerySchema, playersRoute, encounterBase(), getPlayerEncounter(), getPlayerHeroBreakdown(), listPlayerEncounters(), PlayerHeroBreakdown (+4 more)

### Community 42 - "TrayController"
Cohesion: 0.12
Nodes (11): Base64-encoded tray icon PNG, generated from apps/web/public/favicon.svg (the…, _build_icon_image(), Image, System tray icon (pystray): reopen the settings window, or quit cleanly.…, Loads the app's icon (the web app's favicon, composited onto a small dark…, Blocks for the app's whole lifetime, pumping the tray icon's message loop., Shows a balloon/toast notification from the tray icon. Best-effort: not every…, TrayController (+3 more)

### Community 43 - "compilerOptions"
Cohesion: 0.12
Nodes (16): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, lib, module, moduleResolution, noEmit (+8 more)

### Community 44 - "draft.service.ts"
Cohesion: 0.14
Nodes (24): battletagSearchQuerySchema, draftRoute, Env, teamThreatsQuerySchema, DraftEventSink, getCurrentSnapshotForViewer(), getPlayerDraftStats(), getTeamThreats() (+16 more)

### Community 45 - "shared-types/package.json"
Cohesion: 0.12
Nodes (15): dependencies, zod, devDependencies, typescript, exports, typescript, zod, main (+7 more)

### Community 46 - "CLAUDE.md"
Cohesion: 0.29
Nodes (5): Architecture: replay ingestion, adapters, and versioning, Auth, Commands, graphify, Project

### Community 47 - "_unit_born_event"
Cohesion: 0.16
Nodes (18): _collect_calibration_samples(), _iter_unit_positions(), Yields `(gameloop, unit_tag_index, x, y)` for every position sample in…, Evenly-strided subsample of every raw (unnormalized) *hero* position observed…, `positions` is `(unit_tag_index, x, y)` in *absolute* tag-index terms --…, test_collect_calibration_samples_excludes_non_hero_units(), test_collect_calibration_samples_returns_empty_without_position_events(), test_collect_calibration_samples_returns_every_point_below_target() (+10 more)

### Community 48 - "deathClustering.ts"
Cohesion: 0.16
Nodes (10): useMatchSpatialSlot(), buildSpatialEventPoints(), CLUSTER_DISTANCE_NORMALIZED, CLUSTER_TIME_WINDOW_SECONDS, clusterSpatialEvents(), find(), union(), distance() (+2 more)

### Community 49 - "src/draft.ts"
Cohesion: 0.12
Nodes (15): DRAFT_MIN_RANKED_GAMES_FOR_RANKING, DRAFT_RANKED_MODES, DraftHeroStat, DraftPlayerSlot, DraftPlayerStats, DraftPreferenceInput, draftPreferenceInputSchema, DraftSlotInput (+7 more)

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

### Community 55 - "calibrate.vue"
Cohesion: 0.06
Nodes (36): activeLayer, activeMapId, addLayer(), bounds, CalibratedMapEntry, calibrationField, config, { data: calibratedMaps, refresh: refreshCalibratedMaps } (+28 more)

### Community 56 - "TestChooseReading"
Cohesion: 0.23
Nodes (4): _choose_reading(), Reconciles the two engines' votes for one crop. The multilingual engine wins…, `_choose_reading` is the pure decision function reconciling the two engines'…, TestChooseReading

### Community 57 - "._build_ui"
Cohesion: 0.21
Nodes (6): BooleanVar, Checkbutton, A `Checkbutton` styled to match the dark ttk theme (plain `tk`, not `ttk`,…, Grids a label + entry + status indicator starting at `start_row`. Returns…, Frame, Notebook

### Community 58 - "ReplayParseError"
Cohesion: 0.11
Nodes (18): _build_protocol(), _protocol_module(), Reads a required stream from the replay's MPQ archive.…, Imports `heroprotocol.versions.protocolNNNNN` by name. Deliberately not…, Raised when a replay can't be turned into a valid ingestion payload., Raised for a replay that was read fine but is *intentionally* excluded from…, _read_archive_file(), ReplayParseError (+10 more)

### Community 59 - "index.vue"
Cohesion: 0.15
Nodes (11): annotationsStore, applyOverrides(), capturedAgoLabel, config, enemyBattletags, overrides, ownBattletag, selectedBattletag (+3 more)

### Community 61 - "spatial.ts"
Cohesion: 0.22
Nodes (8): props, MatchHeroTrajectory, MatchSlotHero, MatchSpatialData, MatchSpatialHero, SpatialAggregateResponse, SpatialOutcomeFilter, WireGrid

### Community 62 - "DraftPseudoCombobox.vue"
Cohesion: 0.17
Nodes (11): config, emit, items, model, props, searching, searchResults, searchTerm (+3 more)

### Community 64 - "guess_settings_url"
Cohesion: 0.29
Nodes (8): guess_settings_url(), Helpers for the two well-known URLs the settings window links to: the API's…, Best-effort guess at the web dashboard's Settings page (where access tokens are…, test_guess_settings_url_adds_default_scheme(), test_guess_settings_url_falls_back_for_empty_input(), test_guess_settings_url_falls_back_for_unrecognized_host(), test_guess_settings_url_replaces_api_dot_prefix_with_app(), test_guess_settings_url_strips_api_dash_prefix()

### Community 65 - "_unit_died_event"
Cohesion: 0.17
Nodes (16): _extract_deaths(), _extract_structure_events(), _position_at_or_before(), Every hero death (`SUnitDiedEvent`), as `{battletag, team, atSeconds}` -- the…, Every fort/keep/wall/core destruction (`SUnitDiedEvent` on a structure unit,…, Latest `(layer, x, y)` in `samples` (sorted by gameloop, see…, test_extract_deaths_attributes_killer_when_resolvable(), test_extract_deaths_derives_position_from_last_known_sample() (+8 more)

### Community 66 - "DraftTeamColumn.vue"
Cohesion: 0.25
Nodes (4): editingSlots, emit, onPick(), props

### Community 67 - "SpatialHeatmapView.vue"
Cohesion: 0.18
Nodes (10): emit, imgEl, mapContainerEl, naturalHeight, naturalWidth, props, SpatialPresenceLayer, sumGridValues() (+2 more)

### Community 70 - "_FakeStreamingResponse"
Cohesion: 0.22
Nodes (5): download_update(), Streams the release asset to `dest_dir / update.asset_name`, calling…, _FakeStreamingResponse, test_download_update_reports_none_progress_without_content_length(), test_download_update_reports_progress_fraction()

### Community 71 - "_sync_api_version"
Cohesion: 0.26
Nodes (12): Called once per daemon start: asks the API its version and, if it reports a…, _sync_api_version(), _config(), Regression test: an install that has synced replays before but has never yet…, A genuinely fresh install (empty sync-state table, nothing ever synced) seeing…, test_sync_api_version_does_not_rewipe_on_unchanged_data_reset_at(), test_sync_api_version_first_sighting_is_a_noop_on_a_fresh_install(), test_sync_api_version_invalidates_stale_replays() (+4 more)

### Community 72 - "routes/matches.ts"
Cohesion: 0.24
Nodes (8): gameModeListSchema, buildMatchConditions(), Env, filtersQuerySchema, listQuerySchema, matchesRoute, SORTABLE_COLUMNS, gameModeSchema

### Community 73 - "ingest.ts"
Cohesion: 0.22
Nodes (12): API_VERSION, MIN_PARSER_VERSION, Env, extractBaseBuild(), ingestRoute, recordDaemonError(), quarantineRawReplay(), displayNameFromSlug() (+4 more)

### Community 74 - "acquire"
Cohesion: 0.36
Nodes (7): acquire(), Prevents two copies of the daemon's tray app from running at once. Uses a named…, Returns True if this process now (exclusively) holds the daemon's single-…, _install_fake_win32_modules(), test_acquire_always_true_off_windows(), test_acquire_false_and_releases_handle_when_already_running(), test_acquire_true_when_no_other_instance_holds_it()

### Community 77 - "admin-spatial.ts"
Cohesion: 0.30
Nodes (12): adminSpatialRoute, Env, EXAMPLE_WORLD_BOUNDS, generateExampleSample(), getAllCalibrations(), getPendingSample(), listCalibratedMaps(), listPendingMapIds() (+4 more)

### Community 78 - "DEPLOYMENT.md — Raspberry Pi + Dokploy Guide"
Cohesion: 0.25
Nodes (5): Automatic DB Migrations on Container Startup, COOKIE_DOMAIN for Cross-Subdomain Session Sharing, Dokploy Separate Backend/Frontend Apps, DEPLOYMENT.md — Raspberry Pi + Dokploy Guide, README.md — HotS Analytics Overview

### Community 79 - "talents.service.ts"
Cohesion: 0.14
Nodes (18): requireUser, Env, heroesRoute, listQuerySchema, publicRoute, getHeroSummaries(), getHeroSummary(), getTalentTierStats() (+10 more)

### Community 80 - "spatial-calibration.ts"
Cohesion: 0.18
Nodes (10): MapBounds, mapBoundsSchema, PostSpatialCalibrateInput, postSpatialCalibrateInputSchema, PostSpatialSamplesInput, postSpatialSamplesInputSchema, RawMapPoint, rawMapPointSchema (+2 more)

### Community 81 - "build-verification.service.ts"
Cohesion: 0.42
Nodes (7): main(), QuarantineVerificationResult, verifyQuarantinedBuild(), getPendingQuarantinedReplays(), markBuildVerified(), markQuarantineFailed(), markQuarantineProcessed()

### Community 82 - "quarantine.ts"
Cohesion: 0.25
Nodes (7): KnownBuild, knownBuilds, NewKnownBuild, NewRawReplayQuarantine, quarantineStatusEnum, RawReplayQuarantine, rawReplaysQuarantine

### Community 83 - "HOTS Stats Favicon"
Cohesion: 0.40
Nodes (6): prefers-color-scheme Dark Mode Adaptation, HOTS Stats Favicon, Stylized H Glyph with Compass Ticks, Hexagon Frame Mark, hotsGradient (Blue-to-Purple Linear Gradient), HOTS Stats Brand Identity

### Community 85 - "sync_state_file_path"
Cohesion: 0.40
Nodes (4): Connection, Path, Path to the local sync-state database, next to `config.json`., sync_state_file_path()

### Community 86 - "daemon-error.ts"
Cohesion: 0.40
Nodes (4): DaemonErrorReportInput, daemonErrorReportInputSchema, DaemonErrorType, daemonErrorTypeSchema

### Community 87 - "db/tsconfig.json"
Cohesion: 0.33
Nodes (5): extends, include, ../config/tsconfig-base/base.json, src, drizzle.config.ts

### Community 88 - "api/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, src, ../../packages/config/tsconfig-base/base.json

### Community 89 - "spatial-layer.ts"
Cohesion: 0.70
Nodes (3): DEFAULT_LAYER_KEY, fromDbLayer(), toDbLayer()

### Community 90 - "apply_update_and_exit"
Cohesion: 0.24
Nodes (11): apply_update_and_exit(), Hands off to a detached PowerShell script that waits for this process (by pid)…, _fake_process(), The bug this guards against: `Popen` succeeding only means Windows accepted the…, Previously the quick-exit log line was pure guesswork ("likely blocked by…, The diagnostics line must be written on every attempt, success or failure, so a…, test_apply_update_and_exit_aborts_when_powershell_fails_to_launch(), test_apply_update_and_exit_aborts_when_relaunch_script_dies_immediately() (+3 more)

### Community 91 - "shared-types/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, ../config/tsconfig-base/base.json, src

### Community 92 - "_render_relaunch_script"
Cohesion: 0.18
Nodes (11): Pure string-formatting split out from `apply_update_and_exit` so the script's…, _render_relaunch_script(), The bug this guards against: if Copy-Item never succeeds (e.g. a lingering…, `Start-Process` with a bare -FilePath goes through the same ShellExecute path…, Paths are interpolated with single quotes, not double quotes: a `$` in a…, `Start-Process` doesn't wait, so on its own it can't tell "relaunched and…, test_render_relaunch_script_falls_back_to_previous_version_on_copy_failure(), test_render_relaunch_script_includes_paths_version_and_retry_logic() (+3 more)

### Community 93 - "run_settings_window"
Cohesion: 0.40
Nodes (5): Opens the settings window and blocks (on the calling thread) until it's closed.…, run_settings_window(), DraftCaptureCoordinator, StatusTracker, SyncState

### Community 94 - "CalibrationCanvas.vue"
Cohesion: 0.27
Nodes (9): canvasEl, drawCornerLabels(), drawGrid(), imageSlug, imgEl, props, redraw(), syncCanvasSize() (+1 more)

### Community 96 - "trigger_manual_update"
Cohesion: 0.38
Nodes (7): Runs one check-and-apply cycle right now, on a background thread -- what the…, trigger_manual_update(), `apply_update_and_exit`'s diagnostics line only ever gets written during a real…, test_trigger_manual_update_applies_when_available(), test_trigger_manual_update_logs_diagnostics_even_when_up_to_date(), test_trigger_manual_update_reports_up_to_date(), _wait_until()

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

### Community 110 - "constants.py"
Cohesion: 0.40
Nodes (4): Static lookup tables used to translate raw replay data into the API's payload…, # NOTE: Braxis Outpost, Industrial District, Lost Cavern, and Silver City, Tracker stat name (e.g. "HeroDamage") -> API payload field name (e.g.…, stat_field_name()

## Knowledge Gaps
- **446 isolated node(s):** `DaemonErrorGroup`, `Env`, `FriendRequest`, `FriendshipStatus`, `SendFriendRequestResult` (+441 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **23 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `SyncState` connect `SyncState` to `test_app.py`, `_sync_api_version`, `test_ingestion.py`, `StatusTracker`, `sync_state.py`, `_report_error`, `sync_state_file_path`, `app.py`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **Why does `_SettingsWindow` connect `_SettingsWindow` to `gui.py`, `guess_settings_url`, `updater.py`, `UpdateStatusTracker`, `._build_ui`, `run_settings_window`, `._crop_to_photo`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Why does `UpdateStatusTracker` connect `UpdateStatusTracker` to `gui.py`, `test_app.py`, `trigger_manual_update`, `test_updater.py`, `_FakeStreamingResponse`, `updater.py`, `app.py`, `_SettingsWindow`, `run_settings_window`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `SyncState` (e.g. with `_DaemonRunner` and `IngestOutcome`) actually correct?**
  _`SyncState` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `_SettingsWindow` (e.g. with `UpdatePhase` and `UpdateStatus`) actually correct?**
  _`_SettingsWindow` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `DaemonErrorGroup`, `Env`, `FriendRequest` to the rest of the system?**
  _446 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `parser.py` be split into smaller, more focused modules?**
  _Cohesion score 0.06871035940803383 - nodes in this community are weakly interconnected._