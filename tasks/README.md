# Roadmap — Epics restants

Ce dossier contient un brief autonome par Epic, pensé pour être collé tel
quel comme prompt de départ dans une **nouvelle session** Claude Code sur ce
repo (chaque session démarre sans mémoire des précédentes). Chaque fichier
rappelle donc le contexte nécessaire plutôt que de supposer une continuité.

## Déjà fait

- **Epic 1 — Fondations Monorepo & Infra** : Bun workspaces, `packages/db`
  (schéma Drizzle), `packages/shared-types`, squelette Hono (`apps/api`),
  squelette Nuxt (`apps/web`), docker-compose dev + Dokploy (backend/frontend
  séparés), `DEPLOYMENT.md`. Voir le commit initial sur
  `claude/hots-analytics-app-6qkjor`.
- **Epic 2 — Authentification & Comptes** : Google Auth, Personal Access
  Tokens, page Settings, middleware Bearer pour l'ingestion.
- **Epic 3 — Daemon Python & pipeline d'ingestion** : route `POST /ingest`
  (Hono, protégée par PAT, upsert par `replayHash`/`parserVersion` dans
  `apps/api/src/services/replay-upsert.service.ts`), et daemon
  `daemon-python/` (watcher, parser `heroprotocol`, hasher SHA-256, client
  API avec retries, config via env/`config.json`). Voir
  `daemon-python/README.md` pour l'usage. Notes pour la suite : le mapping
  `m_ammId` -> `ARAM` n'est pas confirmé (fallback `"Custom"`), et
  `talentId`/`talentName` réutilisent le même identifiant interne brut faute
  d'une table de traduction des talents — à affiner si besoin en Epic 6.
- **Epic 4 — CI/CD du Daemon** : `.github/workflows/build-daemon.yml`,
  compile `daemon-python` en `.exe` Windows standalone avec Nuitka
  (`--standalone --onefile`, cf. commentaires du workflow pour la
  justification du choix vs `--standalone` + zip et vs PyInstaller),
  déclenché sur tag `v*`, `workflow_dispatch`, et push sur
  `daemon-python/**`. Upload systématique en artifact ; sur tag `v*`,
  publie aussi une GitHub Release avec l'exe attaché
  (`softprops/action-gh-release`). Version du binaire (tag Git) et
  `PARSER_VERSION` (`daemon-python/src/constants.py`) sont volontairement
  indépendantes. Au passage, `mpyq` (utilisé par `parser.py` mais absent de
  `pyproject.toml`) a été ajouté aux dépendances — c'était un bug latent
  qui aurait fait échouer `pip install -e .` en CI. **Non vérifié
  end-to-end sur un vrai runner Windows** (pas d'accès à `windows-latest`
  depuis cette session) : à valider via un `workflow_dispatch` manuel avant
  de s'y fier pour une vraie release — c'est le jalon testable défini dans
  le brief de l'Epic.

- **Epic 5 — Cœur applicatif Web** : design system finalisé (polices Space
  Grotesk/Outfit/JetBrains Mono via `@nuxt/fonts`, composants
  `components/ui/` — `StatTile`, `DataTable`, `ThemeSwitcher` —, layout
  applicatif avec sidebar de navigation dans `layouts/default.vue`, layout
  `blank.vue` dédié à `/login`). Côté API : `apps/api/src/routes/matches.ts`
  (`GET /matches` paginé + filtres mode/héros/carte/période/joueur croisé,
  `GET /matches/:id` détail complet par équipe, `GET /matches/filters` pour
  peupler les dropdowns avec les héros/cartes réellement joués par
  l'utilisateur) et `apps/api/src/routes/stats.ts` (`GET /stats/summary`).
  Toutes ces routes sont scopées à l'utilisateur connecté (session cookie).
  Côté web : `pages/index.vue` (Dashboard), `pages/matches/index.vue`
  (Historique filtrable + paginé), `pages/matches/[id].vue` (détail :
  compositions d'équipe, scoreboard, talents par palier). Testé
  manuellement en local (Postgres + données de seed) via captures d'écran
  Playwright dans les 3 thèmes. Note pour la suite : pas de timeline
  temporelle de partie (Epic 3 n'extrait pas encore ces events) — à
  ajouter en Epic 6 si les données deviennent disponibles.

## À faire, dans cet ordre

1. [`epic-6-web-analytics.md`](./epic-6-web-analytics.md) — Analytics Héros
   & Talents, Radar des Joueurs, Profil joueur + page publique SSR (dépend
   de l'Epic 5).

Une fois un Epic terminé dans sa session, mettre à jour ce README (cocher
dans "Déjà fait") avant de lancer le suivant.
