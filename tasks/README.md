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
- **Epic 6 — Analytics Héros/Talents, Radar des Joueurs, Profil public** :
  côté API, `apps/api/src/services/talents.service.ts` (stats héros +
  talents par palier, participation aux kills calculée via une CTE
  `team_kills` qui agrège les kills par match/équipe) et
  `apps/api/src/services/players.service.ts` (stats de rencontre par
  battletag via self-join sur `match_players`, tri serveur), en plus de
  `apps/api/src/services/stats.service.ts` qui isole désormais le calcul
  du résumé du Dashboard (déplacé depuis `routes/stats.ts` sans changement
  de comportement). Nouvelles routes : `GET /heroes`, `GET /heroes/:heroId`,
  `GET /heroes/:heroId/talents`, `GET /players` (`sortBy`/`sortDir` en
  query), `GET /players/:battletag`, et `GET /public/u/:handle`
  (`apps/api/src/routes/public.ts`, seule route non authentifiée du repo
  avec `/health`, pour le profil partageable). `GET /matches` accepte
  désormais aussi `allyBattletag` (en plus de `opponentBattletag`) pour que
  la page profil réutilise la liste de parties sans dupliquer la logique.
  `PATCH /me` accepte `publicHandle` (le champ existait déjà en base depuis
  l'Epic 2, il manquait juste l'UI). Choix documenté : les stats
  héros/talents restent scopées à l'utilisateur connecté (pas de vue
  communautaire globale, cf. "Hors périmètre" du brief). Côté web :
  `pages/heroes/index.vue` + `[slug].vue`, `pages/players/index.vue`
  (Radar, tri serveur via `UiDataTable` étendu avec des colonnes
  `sortable` cliquables) + `[battletag].vue`, `pages/u/[handle].vue` en
  SSR avec `layouts/public-profile.vue` dédié et meta SEO/OpenGraph via
  `useSeoMeta` (404 propre via `createError({ fatal: true })` si le handle
  n'existe pas). Section "Profil public" ajoutée à `pages/settings/index.vue`
  pour définir son `publicHandle`. Nav sidebar : Héros/Joueurs passés en
  `enabled: true`. Non vérifié en conditions réelles dans cette session
  (pas d'accès Docker/Postgres local ici, contrairement aux epics
  précédents) — seul `bun run typecheck` (répo entier) a pu être exécuté ;
  à valider manuellement avec de vraies données avant de considérer le
  jalon testable du brief comme acquis.

## À faire

Tous les epics du roadmap initial (1 à 6) sont marqués comme faits
ci-dessus. Prochaines pistes possibles, à transformer en brief si besoin :
stats communautaires globales, timeline temporelle de partie (nécessite
d'étendre le parser de l'Epic 3), vérification end-to-end du CI/CD daemon
sur un vrai runner Windows (cf. note Epic 4).

Une fois un Epic terminé dans sa session, mettre à jour ce README (cocher
dans "Déjà fait") avant de lancer le suivant.
