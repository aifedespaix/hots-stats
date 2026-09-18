# Roadmap — Suite "Progression joueur"

Ce dossier suit la convention de `tasks/README.md` : chaque chantier est un
**brief autonome**, pensé pour une **nouvelle session** qui n'a aucune mémoire
des précédentes. Le plan de conception complet est dans
`docs/superpowers/specs/2026-09-18-player-progression-design.md` — c'est la
**source de vérité technique**. Ce fichier n'est que la file d'attente, les
règles de sortie, et le prompt de session.

---

## Prompt de session (à copier-coller tel quel)

> Le bloc ci-dessous est le **prompt générique** à envoyer au début de chaque
> session. Il ne change pas d'un chantier à l'autre : pour cibler un chantier
> précis, remplace la ligne `CHANTIER: (auto)`.

```text
Contexte : repo hots-stats (monorepo Bun — apps/web Nuxt, apps/api Hono+Drizzle,
packages/db, packages/shared-types, daemon-python). Lis d'abord CLAUDE.md,
puis tasks/progression-roadmap.md, puis la section du chantier visé dans
docs/superpowers/specs/2026-09-18-player-progression-design.md.

CHANTIER: (auto)   <-- laisse "(auto)" pour prendre le premier chantier non
                       terminé, ou mets un id (A1, A2, B1, C4, F2, ...).

Objectif : implémenter CE chantier, et seulement celui-là. Pas de refactor
opportuniste, pas d'anticipation des chantiers suivants.

Méthode imposée :
1. Si docs/superpowers/plans/<date>-<chantier>.md existe, exécute-le.
   Sinon, écris-le d'abord avec la skill writing-plans à partir de la section
   du chantier dans la spec (tâches minuscules, TDD, pas de placeholder),
   sauvegarde-le, puis exécute-le.
2. TDD strict pour toute logique de calcul (règles, agrégats, normalisation,
   wilson, clustering) : test qui échoue -> code minimal -> test qui passe.
   Les tests vivent à côté du code (*.test.ts) et se lancent avec :
     - packages/shared-types : bun test packages/shared-types
     - apps/api              : bun test apps/api
     - apps/web              : bun run --filter './apps/web' test
     - daemon-python         : cd daemon-python && pytest -q
3. UI en français, identifiants et commentaires en anglais (règle du repo).
4. Respecte la portée multi-comptes : toute requête personnelle passe par
   accountScope / scopeConditions, jamais eq(matchPlayers.userId, ...).
5. N'invente aucune donnée : pas de MMR/rang, pas d'objectif de carte, pas de
   timer de résurrection simulé. Un chiffre sans source est un bug.

Vérification obligatoire avant de conclure :
  bun run typecheck                  (repo entier)
  bun test packages/shared-types     (si touché)
  bun test apps/api                  (si touché)
  bun run --filter './apps/web' test (si touché)
  cd daemon-python && pytest -q      (si touché)
La CI (ci.yml) fait typecheck + build + pytest daemon : tout ce que tu casses
là, tu le casses en prod.

Critère "exploitable en prod" (gate de commit ET de push) :
  - toutes les vérifications ci-dessus passent ;
  - aucune régression de comportement sur l'existant (les endpoints et pages
    actuels gardent leurs valeurs) ;
  - la migration éventuelle est ADDITIVE (pas de DROP/RENAME), donc compatible
    avec le build web actuellement déployé — apps/api applique les migrations
    automatiquement au démarrage du conteneur (docker-entrypoint.sh) ;
  - aucun secret, aucune URL en dur, aucune dépendance nouvelle non annoncée ;
  - les états vides et d'erreur sont gérés (UiStateCard / UiErrorState) ;
  - ce qui est livré est atteignable depuis la navigation s'il s'agit d'une page.

Sortie de session :
  - Commit(s) atomiques, message conventionnel style repo :
    feat(web): ... | feat(api): ... | fix(scope): ... | chore(db): ...
  - PUSH sur main UNIQUEMENT si le gate ci-dessus est entièrement vert.
    Si un point doute, NE POUSSE PAS : commit localement, explique ce qui
    bloque, et laisse la main.
  - Mets à jour tasks/progression-roadmap.md : coche le chantier, note les
    écarts éventuels avec la spec.
  - Mets à jour la section "Déjà fait" de tasks/README.md en une ligne.
  - Termine par un rapport court : chantier, fichiers, tests lancés + résultat,
    commit/push (oui/non et pourquoi), écarts avec la spec.
```

---

## File d'attente

Légende : `[ ]` à faire · `[~]` en cours · `[x]` terminé · `[!]` bloqué

### Lot A — Socle d'agrégation (prérequis de B1)

- [x] **A1 — Patterns de combat récurrents** · `GET /stats/patterns`
  Extrait les règles pures de `coachAnalysis.ts` vers
  `packages/shared-types/src/coach-rules.ts` (source unique partagée web/API),
  puis agrège sur N parties : première mort, morts < 5 min, sous-nombre,
  staggering, retard de palier, temps mort, morts/10 min.
  *Bloque B1 et B3.* Spec § A1.
  **Fait** (2026-09-18). Écarts / précisions vs spec :
  - `GET /stats/patterns` refuse `scope=global` en 400 : un agrégat de
    patterns n'a pas de sujet cohérent à l'échelle communautaire (aucune ligne
    "joueur observé"), donc on ne fabrique pas de série. Le scope omis retombe
    toujours sur les comptes de l'appelant.
  - L'agrégat pur vit dans `apps/api/src/lib/pattern-aggregate.ts` (sans
    import DB, donc testable sans `DATABASE_URL`) ; `patterns.service.ts` ne
    fait que scoper/filtrer/assembler les lignes. `bun test apps/api` couvre
    l'agrégat et `resolveSubject` (isolation multi-comptes).
  - `earlyDeathsCount` n'évalue que les parties ayant un journal de morts ET
    durant >= 300 s (la fenêtre n'a sinon pas eu lieu) : une partie sans
    timeline ne compte jamais comme "pas de première mort".
  - Constantes nommées dans `coach-rules.ts` :
    `EARLY_DEATH_BEFORE_SECONDS = 300`, `RESPAWN_ESTIMATE_SECONDS = 25`
    (= `RESPAWN_PRESENCE_WINDOW_SECONDS`).
  - `PROGRESSION_MIN_PER_SIDE` est déclarée dans `shared-types` (règle
    transverse) mais pas encore consommée : A1 n'utilise que
    `PROGRESSION_MIN_MATCHES`.
  - Le chantier ne livre aucune page (le hub `/progress` est B1) : l'endpoint
    est vérifié au niveau de l'agrégat, pas via une UI.
- [x] **A2 — Normalisation par durée**
  XP/min, dégâts/min, soins/min, morts/10 min, pondérés par durée (jamais une
  moyenne de ratios). Branché sur `/stats/summary`, `/heroes`,
  `/heroes/:heroId`, `/matches/dashboard`. Spec § A2.
  **Fait** (2026-09-18). Écarts / précisions vs spec :
  - La règle pure `normalizeMetrics` vit dans
    `apps/api/src/services/metrics.service.ts` (sans import DB, donc testable
    sans `DATABASE_URL`) et calcule `sum(stat) / (sum(durationSeconds) / unité)` :
    un taux pondéré, jamais une moyenne de ratios par partie. Elle est
    verrouillée par `metrics.service.test.ts`.
  - Toute durée cumulée non positive (scope vide, partie à durée 0) retombe
    sur des taux à `0` : pas de `NaN`/`Infinity`.
  - Le contrat partagé `NormalizedMetrics` vit dans
    `packages/shared-types/src/stats.ts`. Les sommes brutes ajoutées aux
    requêtes Drizzle alimentent le calcul mais ne sont pas exposées : seuls
    les taux dérivés sortent dans la réponse.
  - `apps/api/src/routes/heroes.ts` n'a **pas** eu besoin d'être modifié
    (contrairement à la liste de fichiers de la spec) : le champ `normalized`
    est attaché par `talents.service.ts` et propagé tel quel par les
    `c.json({ heroes })` / `c.json({ hero, other, scope })` existants.
  - Aucune migration, aucun changement d'UI : l'affichage des nouveaux taux
    relève de B1/B2. Les champs et expressions existants gardent exactement
    leurs valeurs précédentes (changement purement additif).
- [x] **A3 — Tendance glissante + comparaison de périodes** · `GET /stats/trend`
  Winrate glissant (fenêtre 20), KDA glissant, morts/10 min glissant,
  marqueurs de patch, comparaison période A vs B. Spec § A3.
  **Fait** (2026-09-18). Écarts / précisions vs spec :
  - Le calcul (fenêtre glissante, marqueurs de version, comparaison A/B) vit
    dans un module pur sans DB `apps/api/src/lib/trend-series.ts` ; son test
    est donc `trend-series.test.ts` et non `services/trend.service.test.ts`
    comme listé dans la spec (même scission que A1). `trend.service.ts` ne
    fait que scoper/filtrer/ordonner les lignes et résoudre le sujet via
    `resolveSubject`.
  - `scope=global` refusé en 400 : une tendance communautaire n'a pas de ligne
    "joueur observé" à agréger (même règle que `/patterns`). Le scope omis
    retombe sur les comptes de l'appelant.
  - Les taux par minute sont des taux pondérés par la durée cumulée,
    réutilisant `normalizeMetrics` (A2) — jamais une moyenne de ratios. Toute
    durée cumulée non positive retombe sur des taux à `0`.
  - `rollingKda` et `PeriodStats.kda` valent `null` quand la fenêtre/la
    période ne contient aucune mort (jamais `Infinity`).
  - `versionChanges` ne marque que les versions connues (non nulles) : un trou
    "version inconnue" ne crée pas de marqueur et ne duplique pas celui de la
    version suivante.
  - Les deux fichiers web listés dans la spec (`useProgressionTrend.ts`,
    `TrendChart.vue`) sont reportés à B1 : aucune page ne les consomme tant que
    `/progress` n'existe pas, et aucun critère d'acceptation A3 ne porte sur
    l'UI (même arbitrage que A2, qui avait laissé l'affichage à B1/B2).
  - `GET /matches/trend` n'est pas modifié : `GET /stats/trend` est une
    nouvelle route, pas un remplacement.
- [x] **A4 — Facteurs de victoire** · `GET /stats/drivers`
  Moyennes conditionnelles victoires/défaites + taille d'effet (Cohen's d) +
  n. Pas de modèle ajusté. Spec § A4.
  **Fait** (2026-09-18). Écarts / précisions vs spec :
  - Le calcul (définitions des métriques, d de Cohen, tri) vit dans un module
    pur sans DB `apps/api/src/lib/driver-analysis.ts` ; son test est
    `driver-analysis.test.ts` et non `services/drivers.service.test.ts` comme
    listé dans la spec (même scission pure/DB que A1 et A3).
    `drivers.service.ts` ne fait que scoper/filtrer/assembler les lignes.
  - `scope=global` refusé en 400 : "quels de mes chiffres corrèlent avec mes
    victoires ?" n'a pas de sujet communautaire cohérent (même règle que
    `/patterns` et `/trend`). Le scope omis retombe sur les comptes de
    l'appelant.
  - `teamCompHasHealer` (données C4) n'est pas implémenté : C4 n'existe pas
    encore, et un chiffre sans source est un bug.
  - `avgHeroLevelAt10Min` n'est lu que pour les parties d'au moins 10 minutes
    (sinon le "niveau à 10 min" d'une partie écourtée serait une donnée
    inventée) ; toute métrique dont la source est absente du scope est omise
    (critère d'acceptation 5), jamais renvoyée à zéro.
  - `DriverList.vue` reporté à B1 : aucune page ne le consomme tant que
    `/progress` n'existe pas (même arbitrage que A2/A3).
  - d de Cohen : écart des moyennes / écart-type regroupé. Quand la variance
    regroupée est nulle mais que les moyennes diffèrent (séparation parfaite),
    le signe de la différence est renvoyé (±1) pour ne pas perdre la direction
    sans inventer de magnitude ; distributions identiques -> `0`, jamais
    `NaN`/`Infinity`.

### Lot B — Hub de progression

- [x] **B1 — Page `/progress`** · dépend de A1, A3, A4, C4
  Tendance, 3 axes de travail, patterns, contexte, liens. Spec § B1.
  **Fait** (2026-09-18), dans la même session que C4 (prérequis direct de sa
  section « Ton contexte »). Écarts / précisions vs spec :
  - **C4 livré dans la même session** (décision explicite de l'utilisateur) :
    la section 5 de B1 consomme `GET /stats/context`, qui n'existait pas.
  - La page est **personnelle uniquement** : `/stats/patterns`, `/trend`,
    `/drivers` et `/context` refusent tous `scope=global` en 400 (décisions
    A1/A3/A4/C4). Le sélecteur de portée réutilise `UiStatsScopeToggle` et sert
    de garde honnête : en mode global, la page affiche un état vide expliquant
    que l'analyse est personnelle, au lieu de déclencher quatre erreurs 400.
  - Section 6 (liens) : seuls `/analysis` et `/matches` sont liés. Les liens
    `/carte-morts` (C1) et `/objectifs` (E2) sont **omis** tant que ces pages
    n'existent pas — pas de lien vers un 404.
  - `DriverList.vue` (report de A4) n'a pas été créé : la section 3 de B1 est
    un `WorkAxesCard.vue` (3 axes fiables), comme listé dans la spec B1. Les
    `TrendChart.vue`/`useProgressionTrend.ts` reportés par A3 sont livrés et
    fusionnés dans `TrendChart.vue` + `useProgression.ts`.
  - La comparaison de périodes (A3) est exposée via un champ date optionnel
    « Comparer deux périodes », à l'intérieur de la période choisie.
  - `tzOffsetMinutes` est initialisé à 0 côté SSR puis corrigé au montage
    client (`-new Date().getTimezoneOffset()`) : le rendu serveur n'utilise
    jamais le fuseau du serveur.
- [x] **B2 — Nettoyage du Dashboard**
  Retirer durée moyenne, teasers redondants, grille de navigation desktop ;
  ajouter sparkline, "chantier n°1", résumé de dernière session. Spec § B2.
  **Fait** (2026-09-18). Écarts / précisions vs spec :
  - Le clustering de session (règle des 90 min) a été déplacé de
    `apps/api/src/lib/context-aggregate.ts` vers
    `packages/shared-types/src/sessions.ts` (`clusterSessions` /
    `sessionizeMatches`) : la carte « Dernière session » du Dashboard et le
    breakdown C4 partagent désormais une seule implémentation, comme l'exige la
    règle « une règle = un seul endroit ». `context-aggregate.test.ts` ne teste
    plus le clustering (désormais couvert par `sessions.test.ts`).
  - « Dernière session » est dérivée des points de `GET /stats/trend`, déjà
    appelé pour la sparkline : E1 (`/stats/session`) n'existe pas encore. La
    session affichée est le dernier cluster de parties à <= 90 min d'écart, et
    la série A3 couvre tout l'historique scopé (pas de troncature liée à
    `pageSize`). Quand E1 arrivera, la carte pourra être branchée dessus.
  - `StatsAccountSummaryStats` perd sa tuile « Durée moyenne » et expose un
    slot pour la 4e tuile : le Dashboard y place `ProgressSparklineTile`
    (grille toujours à 4 tuiles, pas de décalage de colonnes). Les autres
    appelants (profil public, amis, joueurs) affichent 3 tuiles — conséquence
    assumée de la suppression demandée ; aucune donnée n'est perdue.
  - Le Dashboard garde un seul `GET /stats/summary` + un seul
    `GET /matches?pageSize=8` ; s'y ajoutent `GET /stats/trend` (sparkline +
    dernière session, un seul appel partagé) et `GET /stats/drivers` (chantier
    n°1). La sparkline ne refait pas l'appel, et aucun des deux nouveaux appels
    n'est attendu en SSR : la charge de base reste identique.
  - La grille de navigation est masquée à partir de `lg` (`lg:hidden`) : la
    sidebar couvre déjà toutes les destinations ; sous `lg` la barre mobile est
    limitée à 4 liens, les cartes restent donc la navigation principale.
  - Sparkline en SVG maison (pas de nouvelle dépendance) : géométrie pure
    testée dans `app/utils/sparkline.ts`, domaine y fixe 0-100 % pour ne pas
    exagérer visuellement une petite variation.
  - Le teaser « Tes parties uploadées » est conservé (non redondant avec les
    axes de travail) ; seuls les deux teasers point fort/faible sont retirés.
- [x] **B3 — Extension de `/analysis`** · dépend de A1, A4
  Intégrer patterns + drivers au Diagnostic, supprimer le stub "winrate par
  carte". Spec § B3. **Fait** (2026-09-18). Écarts / précisions vs spec :
  - `DriverList.vue` (composant A4 resté non créé jusqu'ici) est livré en
    `apps/web/app/components/progress/DriverList.vue` : tous les drivers, `n`
    par côté, `d` de Cohen, lignes non fiables estompées (mais affichées avec
    leurs comptes). B1 n'affichait que les 3 axes fiables (`WorkAxesCard`) ;
    le Diagnostic montre la liste complète, conformément au critère A4 n°2.
  - Les règles d'affichage des drivers (`formatDriverMetric`, `driverTone`,
    `buildDriverRows`) vivent dans `apps/web/app/utils/driverDisplay.ts` et
    sont partagées par `WorkAxesCard.vue` et `DriverList.vue` : l'ancien
    `formatMetric` local de `WorkAxesCard` a été supprimé (règle « une règle =
    un seul endroit »). Verrouillé par `driverDisplay.test.ts`.
  - `rankedModeQuery()` (`apps/web/app/composables/useProgression.ts`)
    centralise l'override classé (`DRAFT_RANKED_MODES`), désormais utilisé par
    `/stats/patterns`, `/stats/drivers` et `/matches/trend` de la page. Le
    Diagnostic reste classé de bout en bout, quel que soit le filtre de mode
    global. Verrouillé par `useProgression.test.ts`.
  - Le stub « Winrate par carte » est supprimé ; la copie SEO de la page ne
    l'annonce plus. `/maps` était déjà une carte de la grille de navigation du
    Dashboard (`statsCards` de `pages/index.vue`) et une entrée de la sidebar :
    le critère 1 (accessibilité) était donc déjà satisfait, aucune navigation
    n'a été modifiée.
  - Aucun changement d'API, de base ou de migration ; aucune logique de calcul
    nouvelle (elle reste dans A1/A4), donc pas de nouveau test d'agrégat côté
    API.

### Lot C — Analyses avancées

- [x] **C1 — Carte des morts agrégée** · `GET /spatial/death-map`
  Où meurs-tu, par héros/carte, à partir de `match_deaths.x/y`. Spec § C1.
  **Fait** (2026-09-18). Écarts / précisions vs spec :
  - Le calcul (filtre de couche, position -> cellule, hotspots, split du type
    de kill, court-circuit carte non calibrée) vit dans un module pur sans DB
    apps/api/src/lib/death-map-aggregate.ts ; son test est
    death-map-aggregate.test.ts et non services/death-map.service.test.ts
    comme listé dans la spec (même scission pure/DB que A1/A3/A4/C4).
  - La route vit dans routes/spatial-aggregate.ts (pas routes/spatial.ts, qui
    porte .use("*", authToken) pour le daemon) : /spatial/death-map est une
    route web session. **Bug préexistant corrigé au passage** : les deux
    routeurs montés au même préfixe /spatial utilisaient chacun use("*"), donc
    le authToken du routeur daemon (monté en premier) interceptait aussi
    /spatial/aggregate et le renvoyait en 401. Les routes web portent
    désormais leur middleware par route (authSession, requireUser,
    accountScope) et index.ts monte le routeur web avant le daemon ; les
    routes daemon (/calibrations, /calibrations/by-layer, /samples) restent
    gardées par le wildcard Bearer. Vérifié par un probe Hono isolé couvrant
    les 9 combinaisons web/daemon x auth, puis supprimé.
  - positionedDeaths ne compte que les morts à x/y finis ; sans calibration
    pour la couche demandée : calibrated:false, cells:[], clusters:[] et
    positionedDeaths:0 (critères 1 et 2), mais totalDeaths/matches/
    killTypeSplit restent honnêtes.
  - Le filtre de couche est pur : la sentinelle DB "", null et l'absence de
    couche sont équivalentes (normalizeLayer).
  - clusters = composantes 4-connexes de cellules occupées, centroïde = la
    cellule la plus dense, share = morts / positionedDeaths, plafonné à
    DEATH_MAP_CLUSTER_LIMIT = 8. La grille 128x128 vient de
    SPATIAL_GRID_COLS/ROWS déclarées dans shared-types (accordées à la
    constante du daemon).
  - killTypeSplit ne compte que les killType connus ; une mort de type null
    n'entre dans aucun bucket et l'UI affiche le reste comme « cause
    inconnue » (pas de donnée inventée).
  - Isolation multi-comptes : SQL via scopeConditions (matchPlayers.battletag)
    + re-vérification pure rowInScope (défense en profondeur), verrouillée par
    test.
  - La page /maps/[mapId] gagne une section « Où meurs-tu sur cette carte ? »
    (SpatialDeathAggregateView.vue) : filtre héros, états vide/erreur
    (UiStateCard), heatmap des morts. scope=global reste autorisé côté API
    (heatmap communautaire, comme /spatial/aggregate).
  - Limite assumée : l'UI ne lit que la couche par défaut (layer omis). Aucun
    endpoint n'expose la liste des couches calibrées d'une carte ; un
    sélecteur de couche demanderait une modif d'API hors C1.
- [x] **C2 — Onglet Chronologie sur `/matches/[id]`**
  Courbe d'avance/retard d'XP d'équipe (`match_level_snapshots`) + marqueurs
  de morts et de structures. Spec § C2.
  **Fait** (2026-09-18). Écarts / précisions vs spec :
  - Le calcul (courbe d'avance, regroupement des morts par équipe, texte
    alternatif, géométrie SVG) vit dans un module pur sans Nuxt
    `apps/web/app/composables/useMatchTimelineSeries.ts`, testé par
    `useMatchTimelineSeries.test.ts` ; le composant
    `MatchTimelineChart.vue` ne fait que rendre.
  - Aucun changement d'API, de base ni de migration : `GET /matches/:id`
    renvoyait déjà `timeline.levelSnapshots` / `deaths` /
    `structureEvents`.
  - Le curseur de chronologie partage sa position avec l'onglet Heatmaps via
    une prop additive `highlightAtSeconds` (SpatialSlotGroup →
    SpatialHeatmapView → SpatialMarkerLayer) et la règle pure
    `isClusterHighlighted` (`deathClustering.ts`) : sans la prop, le rendu
    existant est inchangé.
  - Courbe = moyenne des niveaux de chaque équipe aux timestamps réels des
    snapshots, report du dernier niveau connu entre deux montées — jamais de
    point interpolé/inventé. Sans snapshot des deux côtés : état explicite
    « Données de niveau absentes », pas de graphique vide.
  - Graphique en SVG maison (pas de nouvelle dépendance), comme
    `sparkline.ts` ; alternative textuelle = niveau final + écart.
- [ ] **C3 — "Ton bourreau"** · `GET /stats/killers`
  Qui te tue, à partir de `match_deaths.killers` et `killType`. Spec § C3.
- [x] **C4 — Contexte de victoire** · `GET /stats/context`
  Winrate par heure, jour, rang/taille de session, patch, composition d'équipe.
  *Débloque E1.* Spec § C4. **Fait** (2026-09-18). Écarts / précisions vs spec :
  - Le calcul (clustering de session, 6 dimensions) vit dans un module pur sans
    DB `apps/api/src/lib/context-aggregate.ts` ; son test est
    `context-aggregate.test.ts` et non `services/context.service.test.ts`
    (même scission pure/DB que A1/A3/A4). `context.service.ts` ne fait que
    scoper/filtrer/assembler les lignes.
  - `scope=global` refusé en 400 (même règle que A1/A3/A4 : la composition
    d'équipe exige un sujet). Le scope omis retombe sur les comptes de
    l'appelant.
  - Le seuil de session est une constante partagée
    `CONTEXT_SESSION_GAP_MINUTES = 90` ; le gap est mesuré entre les heures de
    début (seul repère dérivable sans inventer une heure de fin). 89 min = une
    session, 91 min = deux.
  - `tzOffsetMinutes` (offset **est de l'UTC**, ex. UTC+2 = 120) est requis par
    la route : aucune hypothèse sur le fuseau du serveur. Les buckets utilisent
    les accesseurs `getUTC*` après décalage.
  - Les 24 heures et les 7 jours sont toujours présents (buckets vides inclus),
    chaque bucket non vide portant `gamesPlayed` + `insufficientSample` ; les
    autres dimensions (`sessionPosition`, `sessionSize`, `patch`,
    `teamComposition`) ne listent que les buckets observés. Le patch null tombe
    dans un bucket « Version inconnue ».
  - `ContextBreakdown.vue` n'affiche que les 3 graphiques nommés par B1 §5
    (heure, jour, taille de session) + des tableaux compacts pour le rang de
    session, le patch et la composition — les 6 dimensions restent exposées par
    l'API pour E1.

### Lot D — Draft

- [ ] **D1 — Aide au draft**
  Alerte de composition, suggestion de pick par carte + pool perso, suggestion
  de ban via les pires matchups. Spec § D1.

### Lot E — Sessions et objectifs

- [ ] **E1 — Récap de session** · `GET /stats/session` · dépend de C4
  Bilan de la dernière session + delta vs baseline. Spec § E1.
- [ ] **E2 — Objectifs** · `/objectifs` + table `player_goals` (migration)
  Objectif mesurable, échéance, suivi. Spec § E2.

### Lot F — Ergonomie et accessibilité

- [ ] **F1 — Palette de commandes Ctrl+K**
  Navigation clavier vers page/héros/carte/ami. Client uniquement. Spec § F1.
- [ ] **F2 — Filtres dans l'URL**
  L'URL reproduit la vue ; le store Pinia reste la source de vérité. Spec § F2.
- [ ] **F3 — Passe accessibilité**
  Daltonisme (glyphes), `aria-live` sur le live draft, focus visible,
  `prefers-reduced-motion`. Spec § F3.
- [ ] **F4 — Export CSV + partage** · dépend de F2
  `GET /matches/export.csv` + "copier le lien". Spec § F4.

### Lot G — Backlog (spec séparée requise)

- [ ] **G1 — Événements d'objectifs (captures, camps)**
  Nécessite une extraction `heroprotocol` côté daemon, un bump
  `PARSER_VERSION`, une décision `MIN_PARSER_VERSION`, une table et un
  chemin d'upsert. **Ne pas démarrer sans sa propre spec.** Spec § G1.

---

## Règles transverses (valables pour tous les chantiers)

- **Source de vérité :** `docs/superpowers/specs/2026-09-18-player-progression-design.md`.
  Si un chantier doit s'en écarter, l'écart est documenté dans ce fichier au
  moment du commit — pas décidé en silence.
- **Constantes partagées :** `PROGRESSION_MIN_MATCHES = 20` et
  `PROGRESSION_MIN_PER_SIDE = 10` vivent dans `packages/shared-types` pour que
  l'API et le web ne puissent pas diverger.
- **Honnêteté statistique :** tout agrégat affiche son `n`. En dessous du
  seuil, on affiche le compte, jamais une conclusion.
- **Une règle = un seul endroit.** Aucune règle de calcul dupliquée entre
  `apps/api` et `apps/web`.
- **Migrations additives uniquement** (l'entrypoint API les applique au
  déploiement, donc elles partent en prod avec le push).
- **Une session = un chantier.**

## Commandes de vérification

```bash
bun run typecheck                      # repo entier (CI)
bun run build                          # repo entier (CI) — lourd, optionnel en local
bun test packages/shared-types         # si packages/shared-types touché
bun test apps/api                      # tests bun:test de l'API
bun run --filter './apps/web' test   # vitest du web
cd daemon-python && pytest -q          # si le daemon est touché
```

## Définition de "terminé" pour un chantier

1. Les critères d'acceptation de sa section dans la spec sont couverts par des
   tests (ou explicitement vérifiés à la main, et alors notés comme tels).
2. Toutes les commandes de vérification pertinentes passent.
3. Le chantier est coché ici et résumé en une ligne dans `tasks/README.md`.
4. Commit poussé sur `main` **si et seulement si** le gate prod est vert ;
   sinon commit local + rapport expliquant le blocage.
