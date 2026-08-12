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
- **Epic 7 — Data Adapters & versionnage des builds** : gestion des
  changements de structure JSON entre versions du jeu (`m_baseBuild`).
  Nouvelles tables `raw_replays_quarantine` (payload brut + `base_build` +
  statut `pending`/`processed`/`failed`) et `known_builds` (builds
  confirmés compatibles avec l'adaptateur par défaut) dans
  `packages/db/src/schema/quarantine.ts`. Architecture d'adaptateurs dans
  `apps/api/src/adapters/` : interface `ReplayAdapter` (`parse(rawData):
  ParsedReplayData`), `DefaultAdapter` (valide via `replayPayloadSchema`,
  structure actuelle), registre statique `m_baseBuild -> adaptateur
  sur-mesure` + `resolveAdapter()` qui retombe sur `known_builds` en base.
  `POST /ingest` (`routes/ingest.ts`) lit `m_baseBuild` à la racine du
  payload : absent (daemons antérieurs à cette feature) -> `DefaultAdapter`
  direct, comme avant ; connu (adaptateur sur-mesure ou build vérifié) ->
  traitement normal ; inconnu -> mise en quarantaine (202), aucune écriture
  dans `matches`/`match_players`. Nouvelle route interne
  `GET /_internal/quarantine/:buildId` (3 à 5 échantillons bruts, param
  `limit`), protégée par un nouveau secret partagé
  `CLAUDE_INTERNAL_SECRET` (`middleware/internal-secret.ts`, comparaison
  `timingSafeEqual`). Script `bun run check-build <buildId>`
  (`apps/api/scripts/check-build.ts`) : rejoue les replays en quarantaine
  pour ce build via `DefaultAdapter` ; si tout valide, marque le build
  compatible dans `known_builds` et insère les parties en attente
  (`upsertReplay`) ; sinon affiche les erreurs Zod par replay et laisse le
  build en quarantaine. Testé de bout en bout en local (Postgres +
  migration générée `drizzle/0003_giant_lifeguard.sql`, serveur API
  démarré, scénarios curl + CLI) : legacy sans `m_baseBuild`, build
  inconnu -> quarantaine, build vérifié -> ingestion directe, build
  toujours incompatible -> `check-build` échoue proprement avec le détail
  des erreurs de schéma. Non couvert : le daemon Python
  (`daemon-python/`) n'envoie pas encore `m_baseBuild` -- à faire quand un
  vrai changement de structure surviendra, cf. `daemon-python/src/parser.py`
  qui a déjà `header["m_version"]["m_baseBuild"]` sous la main.

- **Epic 8 — Réparation des données corrompues & resync piloté par
  compte** : suite de l'Epic 7, deux angles complémentaires pour des
  parties mal enregistrées (mauvais héros, mode incorrect...).
  1. Le daemon (`parser.py`) envoie désormais `m_baseBuild` à la racine du
     payload (`header["m_version"]["m_baseBuild"]`, silencieusement ignoré
     par `replayPayloadSchema` qui n'a pas de `.strict()`) -- jusqu'ici
     c'était le seul chaînon manquant de l'Epic 7 : le système de
     quarantaine/adaptateurs existait côté API mais ne s'activait jamais
     puisque le daemon ne transmettait pas le build. Un futur changement de
     structure de replay sera donc mis en quarantaine (202) au lieu d'être
     silencieusement mal-parsé et inséré tel quel.
  2. Nouveau bouton "Réinitialiser mes données" dans `pages/settings/index.vue`
     (section "Zone dangereuse", confirmation par saisie du mot
     "SUPPRIMER") : `POST /auth/me/reset-data`
     (`services/data-reset.service.ts`) supprime toutes les `matches` dont
     `uploadedByUserId` est le compte connecté (cascade vers
     `match_players`/`talent_picks`) et stamp `users.dataResetAt`
     (migration `0005_nifty_the_spike.sql`). `GET /ingest/version` expose
     ce timestamp ; `app.py`'s `_sync_api_version` compare avec la dernière
     valeur vue (`sync_state.meta`) et appelle le nouveau
     `SyncState.wipe_all()` (par opposition à `invalidate_stale`, qui ne
     filtre que par version) si elle a changé -- toute la file locale
     "déjà synchronisé" est vidée en une fois, donc chaque `.StormReplay`
     encore sur le disque est reparsé et ré-uploadé au prochain démarrage
     du démon. Seules les parties dont le fichier replay a été supprimé du
     disque sont perdues (annoncé dans l'UI).
  3. `ci.yml` fait maintenant tourner la suite pytest du daemon
     (`daemon-tests`, ubuntu-latest) à chaque push/PR -- jusqu'ici les 173
     tests existants ne tournaient nulle part en CI, seul
     `build-daemon.yml` (Windows/Nuitka, un `--help` en guise de smoke
     test) gérait le daemon, et uniquement sur push vers `main`.
  Note pour la suite : `PARSER_VERSION` n'a volontairement pas été bumpé
  (l'ajout de `m_baseBuild` ne change rien pour les parties déjà correctes
  en base) ; `daemon-python`'s `pyproject.toml`/`APP_VERSION` non plus --
  `build-daemon.yml` bump et tag automatiquement au prochain push sur
  `main` touchant `daemon-python/**`, donc rien à faire à la main pour
  publier une nouvelle release une fois mergé.

## À faire

Tous les epics du roadmap initial (1 à 6) sont marqués comme faits
ci-dessus. Prochaines pistes possibles, à transformer en brief si besoin :
stats communautaires globales, timeline temporelle de partie (nécessite
d'étendre le parser de l'Epic 3), vérification end-to-end du CI/CD daemon
sur un vrai runner Windows (cf. note Epic 4). Aussi identifié pendant
l'Epic 8 : pas de bouton/CLI équivalent pour la quarantaine côté admin
(actuellement `bun run check-build` seulement, en ligne de commande) --
utile si un nouveau build HotS pose problème avant qu'on ait le temps
d'écrire un adaptateur sur-mesure.

Une fois un Epic terminé dans sa session, mettre à jour ce README (cocher
dans "Déjà fait") avant de lancer le suivant.
