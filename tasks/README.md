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

- **Epic 9 — Matchups Héros sur la Page Détail Héros** : section "Matchups"
  ajoutée à `pages/heroes/[slug].vue` (entre les stat tiles et les talents),
  d'après le brief `tasks/epic-9-hero-matchups.md`. Côté API,
  `apps/api/src/services/hero-matchups.service.ts` (nouveau) calcule, pour
  un héros et un `scope` (`personal`/`global`, même bascule que le reste de
  `heroes.ts`), le Delta Winrate de chaque héros adverse affronté (winrate
  du matchup moins la baseline globale du héros) plus les deltas
  KDA/participation aux kills/dégâts infligés-subis/contribution XP -- ces
  trois derniers en delta *relatif* (ratio de la baseline) puisque ce sont
  des valeurs brutes dont l'échelle varie énormément d'un héros à l'autre,
  contrairement au winrate/à la participation aux kills qui sont déjà des
  ratios 0-1. Réutilise le pattern self-join de `face-a-face.service.ts`
  (`ne(b.team, a.team)`) mais keyé par `heroId` des deux côtés plutôt que
  par `userId`/`battletag`. Le classement meilleurs/pires contres utilise
  une borne de Wilson (`apps/api/src/lib/wilson.ts`, nouvelle
  `wilsonUpperBound` ajoutée à côté de `wilsonLowerBound` existante) plutôt
  que le delta brut, pour qu'un matchup à 2 parties ne batte pas un
  matchup à 40 parties dans le classement -- avec exclusion croisée entre
  les deux listes (un héros classé dans les meilleurs contres ne peut plus
  apparaître dans les pires, bug repéré en testant avec peu d'adversaires
  distincts). Nouvelles routes `GET /heroes/:heroId/matchups` et
  `GET /heroes/:heroId/matchups/:opponentHeroId` (recherche Head-to-Head,
  retourne une entrée à zéro -- jamais une erreur -- quand les deux héros
  ne se sont jamais affrontés). `GET /matches` accepte désormais aussi
  `opponentHeroId` pour le lien "Voir nos parties l'un contre l'autre" de
  la carte Face à Face. Côté web : `components/heroes/HeroMatchupList.vue`
  (colonnes meilleurs/pires contres) et `HeroMatchupSearch.vue` (recherche
  `USelectMenu` + carte Face à Face animée, réutilise `GET /heroes?scope=global`
  comme source pour la liste des héros cherchables). Testé de bout en bout
  en local (Postgres réel + données fixture, API vérifiée via curl, page
  vérifiée dans un vrai navigateur via Playwright) : ce test a permis de
  corriger deux bugs avant merge (chevauchement meilleurs/pires contres
  décrit plus haut, et le delta de contribution XP calculé en absolu mais
  affiché comme un pourcentage -- corrigé en delta relatif comme les
  dégâts). Écart avec le brief initial : pas d'avatars héros dans les
  listes (le reste de l'app n'affiche encore aucune icône héros nulle
  part, `heroes.iconUrl` n'est pas peuplé -- gardé cohérent avec l'existant
  plutôt que d'introduire un nouveau pattern visuel isolé) ; le toggle de
  portée réutilise le composable `useHeroStatsScope()` partagé par le
  reste de l'app (persisté sur le compte) plutôt qu'un état local à la
  section.
- **Suite Progression — A1 (patterns de combat récurrents)** : règles de
  combat extraites dans `packages/shared-types/src/coach-rules.ts`
  (source unique partagée web/API), agrégat pur sans DB
  `apps/api/src/lib/pattern-aggregate.ts` et route `GET /stats/patterns`
  (scopée compte, filtres mode/héros/carte/période) ; le coach web délègue
  désormais à ces règles, verrouillé par un test de non-régression des 6
  piliers. Écart : `scope=global` refusé en 400 (pas de sujet cohérent pour
  un agrégat communautaire).
- **Suite Progression — A2 (normalisation par durée)** : contrat partagé
  `NormalizedMetrics` (`packages/shared-types/src/stats.ts`) + règle pure
  `normalizeMetrics` (`apps/api/src/services/metrics.service.ts`) branchée
  sur `/stats/summary`, `/heroes`, `/heroes/:heroId`, `/matches/dashboard`
  et le `ownStats.summary` du profil joueur ; taux pondérés par la durée
  cumulée (jamais une moyenne de ratios), garde durée nulle -> `0`.
- **Suite Progression — A3 (tendance glissante)** : contrat partagé
  `TrendPoint`/`PeriodStats`/`TrendResponse`
  (`packages/shared-types/src/stats.ts`), série pure sans DB
  `apps/api/src/lib/trend-series.ts` (fenêtre 20, taux pondérés par la durée
  via `normalizeMetrics`, KDA `null` sans mort) et route `GET /stats/trend`
  (scopée compte ; filtres mode/héros/carte/période/version ; marqueurs de
  patch ; comparaison A/B via `compareTo`). Écarts : `scope=global` refusé en
  400, et `TrendChart.vue`/`useProgressionTrend.ts` reportés à B1 (aucun
  consommateur avant `/progress`).

- **Suite Progression — A4 (facteurs de victoire)** : contrat partagé
  `DriverMetric`/`DriversResponse` (`packages/shared-types/src/stats.ts`),
  analyse pure sans DB `apps/api/src/lib/driver-analysis.ts` (métriques
  earlyDeaths/deathsPer10Min/firstDeath/outnumberedDeaths/xpPerMinute/
  heroDamagePerMinute/killParticipation/timeDeadShare/avgHeroLevelAt10Min,
  d de Cohen, tri fiables d'abord) et route `GET /stats/drivers` (scopée
  compte ; filtres mode/héros/carte/période). Écarts : `scope=global` refusé
  en 400, `teamCompHasHealer` non implémenté (C4 pas encore livré), et
  `DriverList.vue` reporté à B1.
- **Suite Progression — C4 (contexte de victoire)** : contrat partagé
  `ContextBucket`/`ContextBreakdown`/`ContextResponse` + constante
  `CONTEXT_SESSION_GAP_MINUTES = 90`, agrégat pur sans DB
  `apps/api/src/lib/context-aggregate.ts` (6 dimensions : heure, jour, rang et
  taille de session, patch, composition d'équipe ; buckets sous
  `PROGRESSION_MIN_MATCHES` flaggés, session = écart de début <= 90 min), service
  `apps/api/src/services/context.service.ts` et route `GET /stats/context`
  (scopée compte ; `tzOffsetMinutes` est-de-l'UTC explicite requis ;
  `scope=global` refusé en 400).
- **Suite Progression — B1 (hub `/progress`)** : page
  `apps/web/app/pages/progress.vue` + composants `progress/` (TrendChart,
  WorkAxesCard, PatternTable, ContextBreakdown) + composable
  `useProgression.ts`, entrée nav après Diagnostic et carte Dashboard. Écarts :
  page personnelle uniquement (les 4 endpoints refusent global) ; liens
  `/carte-morts` et `/objectifs` omis tant que C1/E2 n'existent pas ;
  `DriverList.vue` remplacé par `WorkAxesCard.vue`.
- **Suite Progression — B2 (nettoyage du Dashboard)** : tuile « Durée moyenne »
  et teasers point fort/faible retirés, grille de navigation masquée dès `lg`,
  ajout de la sparkline `ProgressSparklineTile`, de la carte « Ton chantier n°1 »
  et du résumé « Dernière session » (`SessionSummaryCard`) ; clustering de
  session partagé via `packages/shared-types/src/sessions.ts`. Écarts :
  « Dernière session » dérivée de `/stats/trend` (E1 pas encore livré) ;
  `StatsAccountSummaryStats` rend 3 tuiles + slot côté autres appelants.
- **Suite Progression — B3 (extension du Diagnostic)** : `/analysis` intègre
  désormais le tableau des patterns récurrents (A1) et la liste des facteurs de
  victoire (A4) au-dessus des points faibles/forts ; carte-stub « Winrate par
  carte » supprimée (`/maps` restait accessible depuis la grille du Dashboard et
  la sidebar). Règles d'affichage des drivers partagées avec `WorkAxesCard` via
  `apps/web/app/utils/driverDisplay.ts`, override classé unique via
  `rankedModeQuery()`. Aucun changement d'API ni de migration.
- **Suite Progression — C1 (carte des morts agrégée)** : contrat partagé
  DeathMapResponse + conversion cells->Grid (packages/shared-types/src/spatial-grid.ts),
  agrégat pur sans DB apps/api/src/lib/death-map-aggregate.ts (filtre de couche,
  buckets de position, hotspots 4-connexes, split hero/other, carte non calibrée
  -> cells vides) et route GET /spatial/death-map (scopée compte via
  accountScope ; scope=global autorisé pour la heatmap communautaire). Corrige au
  passage le masquage préexistant de /spatial/aggregate (deux routeurs /spatial en
  use("*")) : middleware web par route et routeur web monté avant le daemon. UI :
  section « Où meurs-tu sur cette carte ? » sur /maps/[mapId]
  (SpatialDeathAggregateView.vue), filtre héros, états vide/erreur, couche par
  défaut seulement.
- **Suite Progression — C2 (onglet Chronologie)** : onglet « Chronologie » sur
  /matches/[id] (composant `MatchTimelineChart.vue` + composable pur
  `useMatchTimelineSeries.ts`) — courbe d'avance/retard de niveau des deux
  équipes depuis `timeline.levelSnapshots`, marqueurs de morts par équipe
  (taille = morts groupées), marqueurs de structures best-effort, curseur
  partagé avec l'onglet Heatmaps (`highlightAtSeconds`) et état explicite
  « Données de niveau absentes ». Aucun changement d'API/DB ; SVG maison.
- **Suite Progression — D0 (capture draft enrichie, prérequis de D1)** : le
  daemon lit désormais la carte et les noms de héros par OCR des plaques
  (grande ligne au-dessus du pseudo — pas de reconnaissance de portraits),
  les POSTe en `mapName`/`heroName` additifs, et l'API les résout en
  `mapId`/`heroId` (normalisation accents/ponctuation). Écart : les noms de
  héros localisés (client FR) sans alias restent `null` — D1 reste bloqué sur
  une table d'alias localisés (voie recommandée : apprentissage depuis les
  replays).
- **Suite Progression — D1 (aide au draft)** : alerte de composition de ton
  équipe (le rôle résolu est porté par le snapshot ; absence de soigneur/tank
  annoncée seulement si les 5 héros sont lus, ≥3 assassins sur toute lecture),
  suggestions de pick classées par borne inférieure de Wilson moins une
  pénalité de rôle déjà pris, bans issus des pires matchups des 3 meilleurs
  picks. Aucune nouvelle route, aucune migration, aucune dépendance ; les
  héros non résolus (client FR) affichent un état d'attente.
- **Suite Progression — C3 (ton bourreau)** : contrat partagé
  `KillerEntry`/`KillersResponse`, agrégat pur sans DB
  `apps/api/src/lib/killer-aggregate.ts` (attribution des morts, top tueurs par
  battletag et par héros, part des morts, winrate quand tué par ce tueur) et route
  `GET /stats/killers` (scopée compte ; filtres mode/héros/carte/période ;
  `scope=global` refusé en 400). Écart : aucune UI (la spec C3 n'en liste pas).
- **Suite Progression — E1 (récap de session)** : contrat partagé
  `SessionRecapResponse`, module pur `apps/api/src/lib/session-recap.ts`
  (sélection de la session via le clustering 90 min partagé, stats pondérées par
  la durée, baseline antérieure, deltas) et route `GET /stats/session`
  (`scope=global` refusé en 400 ; deltas seulement si session et baseline
  atteignent `PROGRESSION_MIN_MATCHES`). Page `/session` (états vide/erreur,
  entrée sidebar + carte mobile) et carte « Dernière session » du Dashboard
  branchée sur l'endpoint (l'ancien util client `sessionSummary.ts` est
  supprimé). Aucune migration, aucune dépendance.

## À faire

Tous les epics du roadmap initial (1 à 6), plus les Epics 7 à 9, sont
marqués comme faits ci-dessus. Prochaines pistes possibles, à transformer
en brief si besoin : stats communautaires globales, timeline temporelle de
partie (nécessite d'étendre le parser de l'Epic 3), vérification
end-to-end du CI/CD daemon sur un vrai runner Windows (cf. note Epic 4).
Aussi identifié pendant l'Epic 8 : pas de bouton/CLI équivalent pour la
quarantaine côté admin (actuellement `bun run check-build` seulement, en
ligne de commande) -- utile si un nouveau build HotS pose problème avant
qu'on ait le temps d'écrire un adaptateur sur-mesure. Identifié pendant
l'Epic 9 : pas d'avatars héros nulle part dans l'app (`heroes.iconUrl`
n'est jamais peuplé, aucune source Blizzard-hosted branchée) -- un vrai
gain de lisibilité pour les listes de héros (matchups, top heroes, radar
des joueurs...) si quelqu'un branche une source d'icônes un jour.

Une fois un Epic terminé dans sa session, mettre à jour ce README (cocher
dans "Déjà fait") avant de lancer le suivant.

Voir aussi `tasks/daemon-audit-2026-08-12.md` : état des lieux critique du
daemon (perf/logique/UX), 3 corrections déjà appliquées, et 5 chantiers plus
gros identifiés (notifications proactives du tray, sync initiale
parallélisée, etc.) qui restent à valider avant implémentation.

Voir aussi `tasks/epic-10-analyse-spatiale.md` : brief de conception (pas
encore implémenté) pour une fonctionnalité "Analyse Spatiale" (heatmap de
présence + kills/morts superposés sur l'image de map) sur `/matches/:id`
(remplace le placeholder `HeatmapsPlaceholder.vue`) et `/maps/:mapId`.
Couvre le modèle de payload Daemon→API (grille sparse + résolution
mathématiquement justifiée), l'algorithme de normalisation
coordonnées→pixels responsive, et le wireframe/UX (concept de "Slot" de
comparaison réutilisable). Prérequis non satisfait aujourd'hui : le daemon
n'extrait pas encore `SUnitPositionsEvent` (aucune coordonnée nulle part
dans le pipeline actuel) — c'est le premier chantier avant tout le reste.

Voir aussi `tasks/progression-roadmap.md` : suite "Progression joueur" —
transformer l'analyse Coach (aujourd'hui limitée à une partie) en couche de
progression agrégée sur N parties (patterns récurrents, tendance glissante,
facteurs de victoire, contexte de session, carte des morts), plus un lot
ergonomie/accessibilité. Le dossier contient la file d'attente des chantiers
(numérotés A1…G1, avec leurs dépendances), les règles de sortie, et un
**prompt de session générique** à copier-coller pour traiter un chantier par
session. Conception détaillée :
`docs/superpowers/specs/2026-09-18-player-progression-design.md`.
