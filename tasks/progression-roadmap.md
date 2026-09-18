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
- [ ] **A2 — Normalisation par durée**
  XP/min, dégâts/min, soins/min, morts/10 min, pondérés par durée (jamais une
  moyenne de ratios). Branché sur `/stats/summary`, `/heroes`,
  `/heroes/:heroId`, `/matches/dashboard`. Spec § A2.
- [ ] **A3 — Tendance glissante + comparaison de périodes** · `GET /stats/trend`
  Winrate glissant (fenêtre 20), KDA glissant, morts/10 min glissant,
  marqueurs de patch, comparaison période A vs B. Spec § A3.
- [ ] **A4 — Facteurs de victoire** · `GET /stats/drivers`
  Moyennes conditionnelles victoires/défaites + taille d'effet (Cohen's d) +
  n. Pas de modèle ajusté. Spec § A4.

### Lot B — Hub de progression

- [ ] **B1 — Page `/progress`** · dépend de A1, A3, A4, C4
  Tendance, 3 axes de travail, patterns, contexte, liens. Spec § B1.
- [ ] **B2 — Nettoyage du Dashboard**
  Retirer durée moyenne, teasers redondants, grille de navigation desktop ;
  ajouter sparkline, "chantier n°1", résumé de dernière session. Spec § B2.
- [ ] **B3 — Extension de `/analysis`** · dépend de A1, A4
  Intégrer patterns + drivers au Diagnostic, supprimer le stub "winrate par
  carte". Spec § B3.

### Lot C — Analyses avancées

- [ ] **C1 — Carte des morts agrégée** · `GET /spatial/death-map`
  Où meurs-tu, par héros/carte, à partir de `match_deaths.x/y`. Spec § C1.
- [ ] **C2 — Onglet Chronologie sur `/matches/[id]`**
  Courbe d'avance/retard d'XP d'équipe (`match_level_snapshots`) + marqueurs
  de morts et de structures. Spec § C2.
- [ ] **C3 — "Ton bourreau"** · `GET /stats/killers`
  Qui te tue, à partir de `match_deaths.killers` et `killType`. Spec § C3.
- [ ] **C4 — Contexte de victoire** · `GET /stats/context`
  Winrate par heure, jour, rang/taille de session, patch, composition d'équipe.
  *Débloque E1.* Spec § C4.

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
