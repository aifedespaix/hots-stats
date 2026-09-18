# Daemon Platform Roadmap & Execution Protocol — Design

## Context

A UI/UX and platform review of the Windows daemon (`daemon-python/`) surfaced four
independent workstreams. This document is the umbrella for all four: it fixes the ordering,
the definition of done, the branch/commit/push discipline, and the clean-session execution
prompt. Each workstream has its own design document:

| # | Workstream | Design doc | Primary surfaces |
|---|---|---|---|
| C1 | Browser-based authorization | `2026-09-18-daemon-browser-auth-design.md` | API, web, daemon `config`/`gui` |
| C2 | Settings-window UX redesign | `2026-09-18-daemon-ux-redesign-design.md` | daemon `gui.py`, `tray.py`, `app.py` |
| C3 | Sync tracking | `2026-09-18-daemon-sync-tracking-design.md` | daemon `sync_state`/`status`/`gui`, API, web |
| C4 | Server-side logs + triage agent | `2026-09-18-daemon-server-logs-and-triage-agent-design.md` | API, DB, daemon logging, `docs/agents/` |

## Why these four, and why this order

- **C1 is isolated.** It is a vertical slice (API + web + daemon) that touches no other
  chantier. It removes today's copy/paste-token friction and can ship first with no
  dependency.
- **C2 sets the surface.** It rebuilds the settings window that C1's connect button and C3's
  controls live on. Doing C2 first would mean designing those controls twice; doing C1 first
  is safe because its daemon-side surface is a single button that C2 then restyles.
- **C3's daemon-side data model can land without C2** (`sync_runs`, query helpers, actions),
  but its control panel is a C2 screen. Hence C2 before C3.
- **C4 is backend-first and independently useful.** It feeds C3's "server-side visibility"
  phase, but nothing in C3 blocks it. It can be pulled forward if desired.

Recommended order: **C1 -> C2 -> C3 -> C4**.

## Release mechanics (read before pushing anything)

`.github/workflows/build-daemon.yml` treats **every push to `main` that touches
`daemon-python/**` (excluding `README.md` and `tests/**`) as a release**: it bumps the patch
version in `pyproject.toml` + `constants.py`, commits, tags `vX.Y.Z`, builds the Nuitka
`.exe`, packs it with `vpk` and publishes a GitHub Release. Pull requests touching
`daemon-python/**` run `pack-check` (build + `vpk pack`, no publish).

Consequences that shape the whole protocol:

- **Merging to `main` is shipping.** A daemon change merged to main is picked up by every
  installed daemon on its next update check. There is no staging environment.
- **Pushing a branch is free.** No workflow, no release.
- API/web/DB changes do **not** auto-release the daemon (the path filter is
  `daemon-python/**`), but they deploy through their own pipeline.

### Branch & commit protocol

1. One branch per chantier: `feat/daemon-<slug>` (see the table below), branched from an
   up-to-date `main`.
2. Commit in small, reviewable, conventional-commit steps.
3. **Push the branch after every green step** — that is the checkpoint, not a release.
4. Open (or update) a PR as soon as the first coherent slice is reviewable; `pack-check`
   runs on every push to a daemon-touching PR.
5. **Merge to `main` only when the increment is complete, tested and prod-exploitable.**
   That merge releases.
6. Never push daemon code straight to `main`.

Branch names: C1 `feat/daemon-browser-auth`, C2 `feat/daemon-ux-redesign`,
C3 `feat/daemon-sync-tracking`, C4 `feat/daemon-remote-logs`.

### "Prod-exploitable" — the bar for a merge

A step may be merged (and therefore released) only when all of:

- [ ] `pytest` green in `daemon-python/`, with new behavior covered.
- [ ] `bun run typecheck` and `bun run build` green at the root.
- [ ] Any UI change has actually been exercised by hand (the repo has no `gui.py` tests —
      see `CLAUDE.md`).
- [ ] No new runtime dependency without an explicit decision recorded in the chantier's spec.
- [ ] Docs updated (`daemon-python/README.md`, spec status line).
- [ ] If parsing/version behavior changed: a `PARSER_VERSION` changelog line added, and
      `MIN_PARSER_VERSION` / `MIN_RELIABLE_STATS_PARSER_VERSION` bumped **only** if actually
      required (see `CLAUDE.md`).
- [ ] The PR states, in one sentence, what makes this increment safe to ship.

### Prod-exploitable checkpoints per chantier

| Chantier | Checkpoint | Shippable because |
|---|---|---|
| C1 | A1 — API table + authorize/token endpoints + tests | endpoint exists but nothing calls it; zero behavior change |
| C1 | A2 — web consent page + token list showing device names | page reachable, no daemon uses it yet |
| C1 | A3 — daemon "Connecter ce PC" button + manual fallback | feature complete |
| C2 | B1 — design tokens + DPI + resizable/scrollable shell | layout change only, same functionality |
| C2 | B2 — widget kit + global health banner + states | visual/UX only |
| C2 | B3 — sync control panel + in-app log viewer | full value needs C3's data model |
| C2 | B4 — first-run wizard + tray/menu polish | feature complete |
| C3 | C3.1 — `sync_runs` + query helpers + tests (daemon) | no UI change |
| C3 | C3.2 — actions (sync now / retry failed / full resync) | new controls over the existing engine |
| C3 | C3.3 — server-side `GET /ingest/status` + web card | API/web only |
| C4 | D1 — `daemon_logs` table + `POST /ingest/logs` + tests | nothing sends logs yet |
| C4 | D2 — daemon remote log handler | ingestion side complete |
| C4 | D3 — `/_internal/logs*` read endpoints + retention job | triage tooling live |
| C4 | D4 — triage agent prompt + docs | docs only |

Merging a checkpoint before starting the next is the default. Two checkpoints may share one PR
only if the intermediate state would be visibly broken to users.

## Clean-session execution prompt

Each chantier is executed in a **fresh session** with no prior conversation. Paste the prompt
below, replacing the placeholders. It is deliberately self-contained: it points at the
documents to read, restates the release danger, and encodes the commit/push discipline.

```text
Tu exécutes UN SEUL chantier du roadmap daemon de hots-stats, dans une session propre,
sans historique de conversation.

## À lire avant toute action (dans cet ordre)
1. CLAUDE.md
2. docs/superpowers/specs/2026-09-18-daemon-platform-roadmap-design.md
3. docs/superpowers/specs/<SPEC_DU_CHANTIER>
4. docs/superpowers/plans/<PLAN_DU_CHANTIER>

## Chantier
- ID / nom : <ID> — <NOM>
- Branche à créer : <BRANCHE> depuis main à jour
  (git fetch && git checkout main && git pull && git checkout -b <BRANCHE>).
- Périmètre : strictement celui du spec. Toute découverte hors périmètre se note dans
  le corps du PR ; elle ne se code pas dans cette session.

## Boucle de travail
Pour chaque étape du plan, dans l'ordre :
1. Écris d'abord le test (TDD) quand l'étape touche de la logique testable.
2. Implémente le minimum qui fait passer le test.
3. Vérifie : `pytest -q` dans daemon-python/, puis `bun run typecheck` et `bun run build`
   à la racine.
4. Si l'étape touche l'UI : exerce-la à la main avant de continuer.
5. Commit conventionnel atomique.
6. `git push -u origin <BRANCHE>` après chaque étape verte.

## Règle de production (impérative)
- Chaque push de branche est sûr : aucune release n'est déclenchée.
- **Ne fusionne sur `main` que lorsque l'étape est complète, testée et exploitable
  en production.** Toute fusion sur main touchant `daemon-python/**` déclenche
  automatiquement bump de version + tag + build + release GitHub : elle est
  immédiatement distribuée aux daemons installés.
- Ne pousse jamais directement sur main : ouvre une PR, laisse tourner `pack-check`,
  puis fusionne.

## À la fin
- Rapport : étapes livrées, commits, PR ouverte, état des vérifications, ce qui reste.
- Si un point du spec s'avère faux, impossible ou contredit le code réel : arrête-toi,
  signale-le et propose une correction de spec avant de continuer.
```

## Rollback

Because every merge releases, a bad release is rolled back by reverting the merge commit on
`main` (or a follow-up fix commit). Reverting triggers a fresh patch release, which the
daemon's updater installs on its next check; the Velopack package for the previous version
remains the one formerly installed, so the blast radius is one update cycle. Never
`git reset --hard` a released `main`.

## Out of scope

- No change to the OCR/crop pipeline, the update mechanism, or the parser's stat extraction.
- No i18n: the daemon's UI copy stays French.
- No telemetry beyond the explicitly-designed daemon logs of C4.

## Testing

This document is process-only; it has no tests. Each chantier's spec carries its own testing
section.
