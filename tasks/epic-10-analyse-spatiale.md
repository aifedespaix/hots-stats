# Epic 10 — Analyse Spatiale (Heatmap & Kills/Morts)

## Contexte

Tu travailles sur **HotS Analytics** (monorepo Bun : `apps/api` Hono,
`apps/web` Nuxt, `packages/db` Drizzle, `daemon-python` parseur `heroprotocol`,
`packages/shared-types`). **Prérequis : Epics 1 à 9 terminés** (voir
`tasks/README.md`).

Le point de départ concret de cet Epic : `apps/web/app/components/coach/HeatmapsPlaceholder.vue`
est déjà un onglet "Heatmaps & Placement" stubé sur `pages/matches/[id].vue`
("Bientôt disponible"), qui indique explicitement qu'il attend des positions
périodiques issues du tracker event **`SUnitPositionsEvent`**, **non extraites
à ce jour** par `daemon-python/src/parser.py`. Aujourd'hui, `timeline.deaths`
(`packages/shared-types/src/replay-payload.ts`) ne contient que
`{battletag, team, atSeconds}` — victime, équipe, horodatage, **aucune
coordonnée, aucune attribution de kill**.

Ce document est le brief de conception complet (pas de code) : modèle de
données, algorithme de normalisation, et wireframe/UX. Une session
d'implémentation future doit pouvoir démarrer directement dessus.

---

## Décisions de conception

### 1. Grid Aggregation — validation + améliorations

L'idée de base (grille de présence + compteurs kills/morts par case) est la
bonne approche, mais une grille dense (une matrice par héros) gaspille
l'espace : la majorité des cases d'une map HotS n'est jamais visitée (eau,
hors-limites, murs). Trois améliorations gardent le payload très en dessous
de 100 Ko :

1. **Grille sparse en "structure of arrays"**, pas un tableau d'objets
   `{x, y, seconds}`. Deux tableaux parallèles (`cellIndex[]`,
   `secondsInCell[]`) par héros suppriment la répétition des clés JSON — bien
   plus compact, et bien plus compressible (gzip/brotli adorent le
   numérique répétitif).
2. **Index de case unique** `cellIndex = row * cols + col` plutôt que
   `{x, y}` : une grille 64×64 (ou plus, voir calcul de résolution
   ci-dessous) tient sur un entier par case au lieu de deux.
3. **Ne pas grid-agréger les kills/morts.** Ce sont des événements rares
   (30-50/partie), contrairement à la présence (milliers d'échantillons). Les
   garder en **points discrets** avec coordonnées exactes normalisées donne
   un marqueur de mort précis, au lieu d'une case floue de 1/64e de map.

**Budget** (ordre de grandeur, 10 héros, ~20 min de partie) : ~150-300 cases
occupées/héros × 10 héros ≈ 2 000 paires (index, secondes) ≈ 15-20 Ko en JSON
compact pour la présence, + 3-5 Ko pour les morts enrichies (30-50 événements
× ~100 octets). **Total ≈ 20-25 Ko brut**, avant compression HTTP
(gzip/brotli côté API, à activer si absent) qui réduit encore ce volume de
70-85 % vu la nature répétitive des données. Large marge sous les 100 Ko même
sur une partie à rallonge (double engagement, 40+ min).

**Résolution optimale de la grille — calculable mathématiquement ?** Oui, et
le budget payload n'est **pas** le facteur limitant (contre-intuitif) :

- **Le coût grandit linéairement avec la résolution, pas quadratiquement.**
  Un héros trace un *chemin* (quasi 1D), il ne remplit pas toute la surface
  de la map. Nombre de cases visitées ≈ `longueur_parcourue_totale /
  taille_case` — donc doubler la résolution par axe (64→128) double le
  nombre d'entrées, pas le quadruple comme le laisserait penser
  64×64=4096 → 128×128=16384 cases *disponibles*. Passer à 128×128 ferait
  ≈ 40-50 Ko ; même 256×256 resterait ≈ 80-100 Ko brut (donc largement sous
  la barre une fois compressé).
- **La vraie limite est le taux d'échantillonnage de `SUnitPositionsEvent`,
  pas l'octet.** Affiner la grille en dessous de la distance qu'un héros
  parcourt *entre deux échantillons de position* n'ajoute aucune information
  réelle — ça encode le bruit d'échantillonnage comme si c'était de la
  précision. Formule : `taille_case_min ≈ vitesse_héros_moyenne ×
  Δt_échantillonnage`. Avec une vitesse de base HotS ≈ 4,4 unités/s, si
  `SUnitPositionsEvent` échantillonne par ex. toutes les 0,5 s (**à mesurer
  empiriquement une fois l'extraction prototypée — valeur non confirmée
  aujourd'hui**), la case ne devrait pas descendre sous ≈ 2,2 unités-monde de
  côté, sous peine de "fausse précision".
- **Plafond secondaire, perceptif** : la heatmap est presque toujours lissée
  au rendu (flou gaussien/interpolation) — au-delà de
  `taille_affichage_px / rayon_flou_px` cases, le gain est invisible.

**Recommandation** : démarrer à **128×128** (gain de précision réel, coût
toujours négligeable), mais figer la valeur finale seulement après avoir
mesuré le taux d'échantillonnage réel. Une résolution non uniforme (cases
plus fines près des objectifs) est possible mais probablement une
complexité inutile vu la marge déjà disponible avec une grille uniforme.

**Interpolation spatiale — éviter l'effet "pointillés".** La formule
ci-dessus suppose implicitement un chemin *continu*. Ce n'est pas ce que
donnent les échantillons bruts : entre deux ticks de `SUnitPositionsEvent`
espacés de 0,5-1 s, un héros rapide (monture, bottes, buffs de vitesse —
Falstad, Dehaka, Zeratul...) peut franchir plusieurs cases sans qu'aucun
échantillon ne tombe dedans. Sans traitement, la heatmap serait une suite de
points isolés au lieu d'un tracé continu, sous-représentant les zones
réellement traversées.

- **Solution** : côté Daemon, avant de construire `spatial.presence`,
  appliquer un algorithme de tracé de segment (type Bresenham/DDA, adapté à
  des coordonnées flottantes normalisées plutôt qu'à une grille de pixels
  entiers) entre chaque paire d'échantillons consécutifs `(t_i, x_i, y_i)` →
  `(t_i+1, x_i+1, y_i+1)`, pour identifier toutes les cases traversées par le
  segment. Le `Δt` entre les deux échantillons est ensuite réparti au
  prorata de la portion du segment (en distance) tombant dans chaque case
  traversée — pas juste "marquer visité", pour que la somme des
  `secondsInCell` reste cohérente avec `durationSeconds` (garde-fou QA déjà
  mentionné au Livrable 1).
- **Ne pas interpoler à travers un vrai téléport.** Certaines capacités
  déplacent un héros instantanément sur une grande distance (Blink, Warp,
  Dash traversant un mur...). Interpoler bêtement entre deux échantillons
  séparés par un tel déplacement tracerait un faux chemin à travers un
  terrain jamais réellement parcouru (ex. à travers un mur ou toute la map).
  **Seuil de détection** : ne remplir les cases intermédiaires que si la
  vitesse implicite entre les deux échantillons (`distance / Δt`) reste sous
  un plafond généreux (ex. ~2-3× la vitesse de déplacement maximale connue,
  pour couvrir montures + bottes + buffs cumulés) — au-delà, traiter comme
  une discontinuité et enregistrer seulement les deux points d'extrémité,
  sans remplissage. C'est la même grandeur `vitesse_max × Δt_échantillonnage`
  que le plancher de résolution ci-dessus, réutilisée ici comme seuil de
  téléportation.
- C'est cette interpolation qui rend valide, en pratique, l'hypothèse "la
  présence suit un chemin continu" utilisée dans le calcul de budget
  ci-dessus — sans elle, des échantillons bruts épars sous-compteraient
  systématiquement la couverture réelle du terrain.

### 2. Compatibilité multi-builds (Daemon)

- **Stabilité du tracker event** : vérifier que `SUnitPositionsEvent` est
  présent et de structure stable sur la plage de builds couverte par
  `daemon-python/src/_protocol_versions.py`. Les très anciens replays
  peuvent ne pas l'émettre → traiter l'absence comme un cas normal (bloc
  `spatial` simplement omis), jamais comme une erreur qui fait échouer tout
  le parse — même logique défensive que le fallback build inconnu existant
  (`raw_replays_quarantine`, Epic 7).
- **Étalonnage des bornes-monde par map, pas stable dans le temps** : une map
  peut être reworkée (bornes de terrain modifiées) sans changer de slug. La
  table de calibration ne peut pas être `map_id → bounds` seul, il faut une
  fenêtre de validité (plage de builds ou de dates de patch).
- **Nouvelles maps non calibrées** : `constants.py` a déjà des maps ARAM sans
  code interne confirmé. La calibration manuelle des bornes ne passe pas à
  l'échelle indéfiniment — prévoir un **bootstrap semi-automatique** : sur
  les N premières parties d'une nouvelle map, calculer les min/max (ou
  percentile pour ignorer les outliers) des positions observées, puis
  affiner à la main.
- **Système de coordonnées non documenté officiellement** : orientation des
  axes, origine — à rétro-ingénierer map par map, comme `parser.py` le fait
  déjà pour les noms d'événements en croisant `hots-parser` et
  `Heroes.ReplayParser` (cf. docstring du module). Vérifier d'abord si ces
  projets communautaires ont déjà ce travail fait.
- **Versionner le sous-schéma indépendamment** : ajouter `spatial.schemaVersion`
  distinct de `parserVersion`, pour faire évoluer la résolution de grille
  sans forcer un bump du payload complet.

### 3. Télémétrie des replays non-parsables

Idée pertinente, à affiner sur 4 points avant implémentation :

1. **Réutiliser l'infra existante** (Epic 7) : `raw_replays_quarantine`
   (JSONB `rawPayload`/`errorDetails`) sert déjà ce rôle pour les builds
   inconnus. Ajouter un `reason` (`unsupported_build` | `parse_exception` |
   `corrupted_file`…) au lieu d'un système parallèle.
2. **Minimiser ce qui remonte** : ne pas uploader le replay complet par
   défaut (contient les battletags de tous les joueurs de la partie, y
   compris des tiers n'ayant pas consenti). Envoyer un diagnostic structuré
   (type/message d'exception, `m_baseBuild`, map, `parserVersion`, hash du
   replay pour dédup) lié au compte via le `authToken` déjà utilisé pour
   `/ingest`.
3. **Dédupliquer côté agrégation**, pas au niveau de chaque événement :
   grouper par `(parserVersion, m_baseBuild, empreinte d'exception)`. Un
   patch cassant touche potentiellement des centaines d'utilisateurs
   simultanément — l'équipe doit voir "1 build à corriger", pas 300 lignes
   identiques.
4. **Cycle de vie = "résolu", pas "supprimé"** : au lieu d'effacer les logs
   une fois le parser réparé, les marquer `resolved` et déclencher un
   **rejob de re-parsing** sur les payloads bruts en quarantaine (c'est
   justement pour ça que `rawPayload` est conservé). Rétention courte
   (ex. 30 jours) pour la donnée brute.
5. **Best-effort, jamais bloquant** : l'envoi télémétrique ne doit jamais
   faire échouer ou ralentir le flux local du Daemon (log local toujours
   écrit, un seul essai d'upload, pas de file de retry qui grossit
   indéfiniment).
6. **Circuit breaker — protection contre l'auto-DDoS.** Le daemon tourne en
   local chez chaque utilisateur : si un patch HotS majeur casse
   `heroprotocol`, **tous les clients échouent en même temps**, sur
   potentiellement des dizaines de replays en attente chacun. Sans garde-fou,
   ça se traduit par un pic massif et synchronisé sur l'API — un déni de
   service accidentel auto-infligé, précisément au moment où l'infra encaisse
   déjà un afflux de ré-ingestions légitimes. Deux mécanismes distincts,
   complémentaires à la dédup d'agrégation (point 3, côté serveur) :
   - **Dédup côté client, par empreinte** : n'envoyer **qu'un seul** rapport
     par `(parserVersion, m_baseBuild, type d'exception)` par installation du
     daemon — pas un par fichier replay en échec. Sans ça, un utilisateur
     avec 50 replays en attente au moment du patch cassant génère 50 rapports
     identiques au lieu d'un seul.
   - **Coupe-circuit sur le canal télémétrique lui-même** : après N échecs
     consécutifs (ex. 3) de l'envoi *lui-même* (timeout, 5xx, 429), arrêter
     complètement les tentatives pour cette version tant qu'elle n'a pas
     changé — protège une API déjà sous tension d'être en plus harcelée par
     des clients qui insistent.
   - État des deux mécanismes stocké localement (même mécanisme que
     `SyncState`, Epic 8), **clé sur `parserVersion`** : dès qu'une nouvelle
     version du parser corrige le problème, la clé change et le coupe-circuit
     se réarme tout seul — aucune action manuelle requise côté utilisateur.
   - **Défense en profondeur côté API** : ajouter un rate-limit (middleware
     Hono, token-bucket par compte/IP) sur l'endpoint de télémétrie
     lui-même. Nécessaire même avec un daemon bien élevé, car toutes les
     installations en circulation n'auront pas immédiatement la version du
     daemon qui contient ce coupe-circuit.
   - Ce canal est distinct de la mise en quarantaine existante (Epic 7) :
     la quarantaine gère le cas "le parse a réussi, mais référence un build
     inconnu" (payload valide produit) ; la télémétrie couvre le cas plus en
     amont où le daemon **plante avant même de produire un payload**. Un
     patch cassant peut déclencher les deux simultanément — chacun a besoin
     de sa propre protection contre l'afflux.

### 4. Cas particulier — maps multi-niveaux (ex. Mines Hantées)

Vérifié dans le code actuel : `packages/db/src/seed.ts` et
`daemon-python/src/constants.py` (`"HauntedMines": "Haunted Mines"`) ne
modélisent **"Haunted Mines" que comme une seule map**. Or en jeu, cette map
a deux zones jouables distinctes (surface + sous-sol des mines). Un modèle
"une image de fond + une grille 2D plate par map" ne suffit pas ici :

- **Risque concret** : si les deux niveaux occupent des plages de
  coordonnées X/Y qui se chevauchent (le sous-sol dessiné littéralement
  "sous" la surface dans le même repère), une seule grille `(map,
  cellIndex)` **confondrait** les positions des deux niveaux.
- **Deux mécanismes possibles**, à trancher empiriquement une fois
  `SUnitPositionsEvent` extrait (inconnu avec certitude aujourd'hui) :
  1. Les deux zones occupent des plages X/Y **disjointes** → une seule
     grille plate suffit, il faut juste calibrer les bornes-monde pour
     couvrir les deux zones (+ image de fond qui les montre toutes les
     deux, ou une bascule d'image).
  2. Les deux zones **se chevauchent en X/Y** (vraie superposition,
     différenciée par une coordonnée Z ou un flag de région) → il faut une
     clé composite `(layer, cellIndex)` et une calibration + image de fond
     **distincte par niveau**.
- **Modélisation recommandée dans les deux cas** : traiter chaque niveau
  comme sa propre unité de calibration (bornes-monde + image), regroupées
  dans l'UI comme des sous-vues d'une même map logique ("Mines Hantées —
  Surface" / "— Sous-sol", bascule par onglet), plutôt que deux entrées de
  map indépendantes sans lien. Priorité basse (map ancienne, peu de parties
  récentes), mais le champ `layer` (cf. Livrable 1) doit être prévu dès le
  schéma pour ne pas tout casser si une map future a la même
  caractéristique.

### 5. Agrégation multi-parties — éviter le goulot d'étranglement Postgres

Sommer des JSONB à la volée pour chaque requête de `GET /spatial/aggregate`
ne passe pas à l'échelle : un joueur avec 200 parties Healer sur Dragon
Shire ferait sommer 200 blobs JSON par requête, potentiellement à chaque
changement de filtre dans l'UI (Slot). Ce n'est **pas** un détail à reporter
"si le besoin se présente" — la nature même de la fonctionnalité
(comparaison Historique/Slot, cf. Livrable 3) en fait un chemin d'accès
fréquent dès la v1. Design retenu, dérivé de la remarque sur le
"goulot d'étranglement" :

- **Table de rollup incrémental**, ex. `hero_map_spatial_rollup`, clé
  `(mapId, heroId, layer, playerId, outcome)` avec `outcome ∈ {win, loss}`
  (2 lignes, jamais une 3e "toutes issues" stockée à part) →
  `presenceGrid`/`killsGrid`/`deathsGrid` (JSONB, même forme sparse que le
  stockage par partie) + `matchCount`.
- **Mise à jour à l'ingestion**, dans la même transaction que
  `replay-upsert.service.ts` : pour chaque héros de la partie qui vient
  d'être ingérée, **merge-add** (pas overwrite) sa grille dérivée dans la
  ligne de rollup correspondante. Le merge de deux grilles sparse
  `{cellIndex[], value[]}` est une simple fusion de map clé→valeur — fait en
  TypeScript côté service, pas en fonction Postgres/PL-pgSQL (plus simple à
  maintenir, cohérent avec le reste du service).
- **Deux lignes maintenues par héros et par partie** : une ligne
  `playerId = <uploader>` et une ligne `playerId = NULL` ("tous les
  joueurs"), toutes deux incrémentées à l'ingestion. Résultat : la "moyenne
  globale" (Hub des Cartes) est déjà en O(1) au moment de la lecture, jamais
  un scan de toutes les parties de tous les utilisateurs.
- **Lectures composées, jamais sur les parties brutes** :
  - `Issue = toutes` → somme des 2 lignes win/loss pré-agrégées (coût
    négligeable, pas 200 lignes brutes).
  - `Héros/Rôle = un rôle` (ex. "tous les Tanks") → somme des lignes de
    rollup **déjà agrégées** des ~10-15 héros de ce rôle pour le
    map/joueur/issue demandés — toujours O(quelques lignes), jamais O(parties).
- **`match_spatial_grids` (par partie) reste la source de vérité**, le
  rollup n'est qu'un cache dérivé — nécessaire pour pouvoir le reconstruire
  après un changement de résolution de grille (`spatial.schemaVersion`, cf.
  point 1) : stocker ce `schemaVersion` sur les lignes de rollup et prévoir
  un job de backfill qui les régénère depuis les grilles par partie plutôt
  que de supposer une migration en place instantanée.
- **Cache HTTP court** (quelques minutes) en complément devant
  `GET /spatial/aggregate`, utile même une fois le rollup en place pour
  absorber les changements de filtre rapides dans l'UI — mais ce n'est pas
  un substitut au rollup : sans lui, même un cache MISS reste coûteux.

---

## Livrable 1 — Modèle de données (payload Daemon → API)

Extension **additive** de `replayPayloadSchema` (`packages/shared-types/src/replay-payload.ts`,
déjà non-strict, donc rétro-compatible) :

```jsonc
{
  // --- Champs existants, inchangés ---
  "replayHash": "…",
  "parserVersion": "1.7",              // bump : ajout de l'extraction spatiale
  "map": "dragon-shire",
  "gameMode": "storm_league",
  "region": "eu",
  "gameVersion": "2.56.x.xxxxx",
  "playedAt": "2026-08-16T18:32:00Z",
  "durationSeconds": 1187,
  "players": [ /* inchangé */ ],

  "timeline": {
    "deaths": [
      {
        // --- Champs existants ---
        "battletag": "Player#5678",     // victime
        "team": 1,
        "atSeconds": 305,
        // --- NOUVEAUX champs, optionnels ---
        "x": 0.482,                     // position normalisée [0,1] au moment de la mort
        "y": 0.117,
        "killers": ["Player#1234"],     // battletags crédités ; [] = tour/sbire/environnement
        "killType": "hero"              // "hero" | "minion" | "structure" | "environment"
      }
    ],
    "levelSnapshots": [ /* inchangé */ ]
  },

  // --- NOUVEAU bloc, absent si l'extraction spatiale n'a pas pu être faite ---
  "spatial": {
    "schemaVersion": 1,                  // versionné indépendamment de parserVersion
    "grid": { "cols": 128, "rows": 128 }, // résolution à confirmer une fois le taux d'échantillonnage mesuré
    "presence": [
      {
        "battletag": "Player#1234",
        "heroId": "muradin",
        "layer": null,                  // null sur une map à un seul niveau ; "surface"/"underground" sinon (Mines Hantées)
        // Structure-of-arrays : cellIndex[i] ↔ secondsInCell[i]
        // cellIndex = row * cols + col (row-major)
        "cellIndex":     [1042, 1043, 1108, 2210],
        "secondsInCell": [4.5,  12.0,  3.5,  8.0]
        // Somme(secondsInCell) sert de garde-fou QA : doit rester
        // proche de durationSeconds - tempsMortAvantRespawn
      }
      // … un objet par héros (10 en partie standard), par niveau si map multi-niveaux
    ]
  }
}
```

**Pourquoi enrichir `timeline.deaths` plutôt que dupliquer un tableau
`kills` séparé** : une mort et le(s) kill(s) qui la causent sont le même
événement vu de deux côtés. Les fusionner évite une double source de vérité
— même logique que l'ajout initial de `timeline` en v1.4.

**Un seul format de grille pour 3 métriques.** Pour que les comparaisons
multi-parties (Livrable 3) restent simples à calculer, l'API dérive **à
l'ingestion**, à partir de `spatial.presence` et de `timeline.deaths`
enrichi, **trois grilles sparse de même forme** `{cellIndex[], value[]}` par
(match, héros, niveau) : `presenceGrid` (secondes), `killsGrid` (nombre de
kills), `deathsGrid` (nombre de morts). Additionner N grilles de même forme
pour agréger sur plusieurs parties devient alors une simple fusion de maps
clé→valeur. La vue "cette partie" continue d'utiliser les points discrets de
`timeline.deaths` (plus précis) ; les grilles dérivées ne servent qu'aux vues
agrégées multi-parties.

**Prérequis annexe — étalonnage des maps** : ajouter à `packages/db/src/schema/maps.ts`
(ou une table dédiée `map_calibration` si une fenêtre de validité par patch
ou par niveau est nécessaire) des bornes monde `{minX, maxX, minY, maxY}`
par map, utilisées côté Daemon pour normaliser les coordonnées brutes en
`[0,1]` avant émission. Normaliser côté Daemon (pas côté frontend) rend le
payload indépendant de la résolution de l'image de map utilisée à
l'affichage.

---

## Livrable 2 — Algorithme de normalisation (Frontend)

Le Daemon envoie des coordonnées déjà normalisées `(xn, yn) ∈ [0,1]×[0,1]`.
Le frontend doit les projeter sur l'image de map affichée en
`object-fit: contain` (aspect-ratio préservé, letterboxing possible), dans un
conteneur qui se redimensionne.

**Étape 1 — inversion d'axe (piège classique)** : les moteurs de jeu ont
généralement un axe Y croissant vers le haut, alors que l'écran/l'image a Y
croissant vers le bas :
```
y_écran = 1 − y_monde
```
(à valider empiriquement map par map lors de l'étalonnage — c'est le genre
d'erreur qui passe inaperçue tant qu'on n'a pas vérifié visuellement qu'un
kill près du Temple du Ciel s'affiche bien près du Temple du Ciel.)

**Étape 2 — mise à l'échelle "contain" responsive.** Soit `(Wi, Hi)` la
taille intrinsèque de l'image de map, `(Wc, Hc)` la taille courante du
conteneur :

```
scale   = min(Wc / Wi, Hc / Hi)
renduW  = Wi × scale
renduH  = Hi × scale
offsetX = (Wc − renduW) / 2      // letterboxing horizontal
offsetY = (Hc − renduH) / 2      // letterboxing vertical

pxX = offsetX + xn × renduW
pxY = offsetY + (1 − yn) × renduH
```

**Étape 3 — recalcul réactif.** `ResizeObserver` sur le conteneur (pas
seulement l'événement `resize` de la fenêtre, qui ne capture pas un
changement de mise en page flex/grid sans redimensionnement de fenêtre).

**Étape 4 — choix du support de rendu**, pour éviter de recalculer
`pxX/pxY` en JS sur chaque marqueur à chaque frame :
- **Marqueurs kills/morts** (peu nombreux, besoin de netteté) → **SVG** avec
  `viewBox="0 0 1 1"` et `preserveAspectRatio="xMidYMid meet"`. Le navigateur
  applique nativement le même calcul contain/letterbox — aucune
  re-projection JS au resize, seule l'inversion Y (étape 1) reste à faire à
  la source des données.
- **Couche heatmap de présence** (dense, dégradé continu) → **Canvas**, plus
  performant pour un rendu densité/dégradé que des centaines de nœuds DOM.
  Le canvas n'a pas de `viewBox` natif : appliquer manuellement la formule
  des étapes 1-2 à chaque redraw (déclenché par le `ResizeObserver`, pas à
  chaque frame).

---

## Livrable 3 — Wireframe textuel & UX

### Points d'entrée

- **A. Hub des Cartes → `/maps/:mapId`** (page existante, `apps/web/app/pages/maps/[mapId].vue`).
  Nouvel onglet "Analyse Spatiale" = un Slot (voir ci-dessous) préconfiguré
  sur `{Historique, Joueur = tous, Carte = courante}` — l'agrégat global,
  filtrable par héros/rôle.
- **B. Page Détail de partie → `/matches/:id`** (onglet "Heatmaps & Placement"
  déjà stubé par `HeatmapsPlaceholder.vue` — à remplacer par le composant
  réel). Vue par défaut = un Slot préconfiguré sur `{Cette partie, tous les
  héros}`.

### Wireframe — onglet "Analyse Spatiale" (page Détail de partie)

```
┌─ Heatmaps & Placement ──────────────────── [ Cette partie ⟷ Historique ] ─┐
│                                                                             │
│  Héros : [x]Muradin [x]Malfurion [x]ETC [ ]Genji [x]Valeera  …  [Tout/Rien]│
│  Vue   : (•) Par héros   ( ) Par équipe                                   │
│                                                                             │
│  Couches : [x] Présence ▓▓▓▓░░░ 60%    [x] Kills    [x] Morts             │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────┐   │
│  │                                                                     │   │
│  │              [ image de map + heatmap dégradée (Canvas)             │   │
│  │                + marqueurs kills/morts (SVG) superposés ]           │   │
│  │                                                                     │   │
│  │        ▲ kill (succès)      ✕ mort (danger)     "+3" = cluster      │   │
│  │                                                                     │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  [ + Comparer avec un 2e Slot ▾ ]                                         │
│    └ Portée : (•) Historique  ( ) Cette partie                           │
│      Joueur : [Moi ▾]        Héros/Rôle : [Muradin ▾]                    │
│      Issue  : (•) Toutes  ( ) Victoires  ( ) Défaites                    │
│      Raccourcis : [Moyenne globale] [Un autre joueur…] [Mes victoires    │
│                    vs mes défaites]                                      │
│                                                                             │
│  Rendu comparaison : (•) Superposition (bleu/orange)  ( ) Côte à côte    │
└─────────────────────────────────────────────────────────────────────────┘
```

### Le bloc de base : le "Slot"

Plutôt que coder une fonctionnalité par cas d'usage, une seule brique
réutilisable (`SpatialSlot.vue`) couvre tous les scénarios : superposition
multi-héros d'une partie, comparaison entre deux joueurs sur un même
héros/rôle, comparaison victoires vs défaites d'un même joueur. Un **Slot**
= une couche de heatmap + kills/morts, définie par :

| Paramètre | Valeurs |
|---|---|
| **Portée** | `Cette partie` (match précis) *ou* `Historique` (agrégat sur plusieurs parties) |
| **Joueur** *(si Historique)* | moi \| un battletag précis \| tous les joueurs (= moyenne globale) |
| **Héros / Rôle** | un héros précis *ou* un rôle (Tank, Bruiser, Healer, Assassin, Support — agrège tous les héros du rôle) |
| **Carte** | fixée par le contexte (page courante) |
| **Issue** *(si Historique)* | toutes \| victoires seulement \| défaites seulement |
| **Sélection héros** *(si Cette partie)* | chips à cocher/décocher par héros, tous cochés par défaut (réutilise `PlayerSwitcher.vue`) |

L'écran affiche **1 ou 2 Slots**. Avec 2 Slots actifs, un sélecteur
*Superposition* (couleurs distinctes, zones de recouvrement fondues —
lisible pour de petites différences) vs *Côte à côte* (deux mini-maps
synchronisées en pan/zoom — plus lisible quand les styles divergent
fortement) contrôle le rendu.

Cette brique unique couvre nativement toutes les demandes :

- **Superposer tous les héros d'une partie, ou décocher un par un** → 1 Slot,
  `Portée = Cette partie`, chips héros (tout coché par défaut).
- **Comparer mon Muradin sur une map avec un autre joueur (même héros, ou
  même rôle Tank)** → Slot 1 = `{Historique, Joueur=moi, Héros=Muradin}`,
  Slot 2 = `{Historique, Joueur=<autre battletag ou "tous">, Héros=Muradin
  ou Rôle=Tank}`.
- **Mes positionnements avec un héros sur une map, victoires cumulées vs
  défaites cumulées** → Slot 1 = `{Historique, Joueur=moi, Héros=X,
  Issue=Victoires}`, Slot 2 = même config avec `Issue=Défaites`.
- **Comparaison vs moyenne globale** → Slot 2 = `{Historique, Joueur=tous}`.

Un seul mécanisme à concevoir et tester, au lieu de 4 fonctionnalités
séparées à maintenir — et il reste ouvert à des combinaisons non anticipées
aujourd'hui (ex. "mes défaites vs la moyenne globale des défaites") sans
code supplémentaire.

### Filtres & interactions communs

- **Mode Équipe vs Joueur** *(portée "Cette partie" uniquement)* : bascule
  "par équipe" (agrège les 5 joueurs d'un camp en une couche — utile pour
  visualiser le contrôle de zone / les rotations) vs "par joueur".
- **Couches indépendantes** : Présence / Kills / Morts, chacune
  activable/désactivable par Slot, avec un slider d'opacité sur la couche
  présence pour ne pas masquer les marqueurs en dessous.
- **Rendu Kills/Morts selon la portée du Slot** : en `Cette partie`,
  marqueurs discrets. En `Historique`, kills/morts de plusieurs parties
  s'agrègent en densité (même mécanisme de grille que la présence —
  `killsGrid`/`deathsGrid`), sans quoi 20 parties × 5 morts donneraient un
  nuage de points illisible.
- **Cas multi-niveaux (Mines Hantées)** : si la carte a plusieurs niveaux, un
  sélecteur d'onglet "Surface / Sous-sol" au-dessus des Slots ; chaque Slot
  reste indépendant par niveau (pas de mélange automatique).

### Charte de couleurs

Le principe de couleur dépend du **nombre de Slots actifs** :

- **1 Slot, portée "Cette partie", multi-héros superposés** : couleur par
  héros (palette catégorielle — pas allié/ennemi, l'utilisateur pouvant
  vouloir comparer deux héros de la même équipe). En mode "par rôle",
  réutiliser les tokens existants `role-tank`, `role-healer`, etc.
  (`app/assets/css/globals.css`).
- **2 Slots actifs (mode comparaison)** : couleur fixe **par Slot** — Slot A
  en bleu, Slot B en orange (diverging), pas par équipe : un Slot peut
  représenter "moi", "un autre joueur", "la moyenne globale" ou "mes
  défaites", où la notion allié/ennemi ne s'applique plus. Un Slot
  "moyenne globale" se rend en gris neutre + contour pointillé plutôt qu'en
  aplat, pour se lire comme une référence.
- **Kills** : `--color-success` (déjà theme-aware clair/sombre) — cohérent
  avec l'association positive utilisée ailleurs dans l'app.
- **Morts** : `--color-danger` — même logique. En mode 2 Slots, ces teintes
  restent identifiables par couleur ; c'est la **forme du marqueur** qui
  indique le Slot d'origine.
- **Accessibilité** : ne pas coder l'info uniquement par la couleur —
  différencier aussi kills/morts par la forme (triangle vs croix/losange),
  et Slot A/B par un second attribut (plein vs contour). À la construction
  effective des composants, s'appuyer sur la skill `dataviz` du projet pour
  valider formellement la palette (contraste, distinguabilité).
- **Regroupement de marqueurs** : morts groupées à quelques secondes
  d'écart dans une zone proche (teamfight) → cluster visuel (badge "+3")
  plutôt que superposition illisible. Ne s'applique pas en portée
  `Historique` (déjà rendu en densité).

---

## Fichiers concernés

- `daemon-python/src/parser.py`, `daemon-python/src/constants.py` —
  extraction `SUnitPositionsEvent`, grille sparse, normalisation par
  bornes-map (+ détection de niveau pour les maps multi-niveaux), bump
  `PARSER_VERSION`.
- `packages/shared-types/src/replay-payload.ts` — extension Zod additive
  (`timeline.deaths[].x/y/killers/killType`, bloc `spatial` avec champ
  `layer`).
- `packages/db/src/schema/maps.ts` (+ table de calibration si fenêtre de
  validité par patch ou par niveau nécessaire), `packages/db/src/schema/match-deaths.ts`,
  nouvelle table `match_spatial_grids` (source de vérité, par match/héros/niveau)
  et nouvelle table `hero_map_spatial_rollup` (cache incrémental
  `mapId/heroId/layer/playerId/outcome`, cf. section 5) — JSONB, précédent
  déjà posé par `raw_replays_quarantine` (Epic 7).
- `apps/api/src/services/replay-upsert.service.ts` (calcul des 3 grilles
  dérivées + merge-add dans le rollup, dans la même transaction
  d'ingestion), `apps/api/src/routes/matches.ts`, **nouvel** endpoint
  `GET /spatial/aggregate?mapId=&heroId=|role=&playerId=&outcome=` qui lit
  et combine un petit nombre de lignes de rollup pré-agrégées (jamais les
  grilles brutes par partie), `apps/api/src/routes/ingest.ts`, **nouveau**
  script de backfill (sur le modèle de `bun run check-build`, Epic 7) pour
  régénérer le rollup après un changement de `spatial.schemaVersion`.
- `apps/web/app/components/coach/HeatmapsPlaceholder.vue` (à remplacer),
  `apps/web/app/pages/maps/[mapId].vue`, `apps/web/app/pages/matches/[id].vue`,
  nouveau composant `SpatialSlot.vue` (le "Slot" ci-dessus) instancié 1 ou 2
  fois selon le mode, nouveaux composants de rendu SVG/Canvas.
- `raw_replays_quarantine` (Epic 7, déjà existant) — extension pour la
  télémétrie d'erreurs de parsing ; nouvel état local du daemon (sur le
  modèle de `SyncState`, Epic 8) pour la dédup par empreinte et le
  coupe-circuit décrits en section 3.6 ; nouveau middleware Hono de
  rate-limit sur l'endpoint de télémétrie.

## Points à valider empiriquement avant/pendant l'implémentation

- **Mesurer le taux d'échantillonnage réel de `SUnitPositionsEvent`** sur un
  vrai replay dès que l'extraction est prototypée — c'est cette valeur, pas
  une hypothèse, qui doit fixer la résolution finale de la grille.
- **Vérifier la topologie des Mines Hantées** : les deux niveaux
  occupent-ils des plages X/Y disjointes ou superposées (Z / flag de
  région) ? Détermine si le champ `layer` composite est nécessaire dès la
  v1.
- Recalculer le budget payload sur un vrai replay long (40+ min, double
  engagement) une fois l'extraction implémentée, pour confirmer la marge
  sous 100 Ko à la résolution finalement choisie.
- Valider l'inversion d'axe Y et les bornes-monde visuellement sur 2-3 maps
  avant de généraliser aux 19 maps — un kill affiché au mauvais endroit est
  le bug le plus probable à ce stade.
- Vérifier que la couche Canvas (heatmap) et la couche SVG (marqueurs)
  restent alignées au pixel près après resize, y compris en cas de
  changement de layout sans resize fenêtre (test avec `ResizeObserver`).
- **Calibrer le seuil de détection de téléportation** (section 1,
  interpolation) sur des replays contenant des capacités de déplacement
  instantané connues (Blink, Warp, Dash traversant un obstacle...) — vérifier
  visuellement que ces trajets ne sont pas interpolés à travers un mur/l'eau,
  et à l'inverse qu'un déplacement monté rapide légitime n'est pas coupé à
  tort.
- Vérifier, une fois `hero_map_spatial_rollup` en place, que le temps de
  réponse de `GET /spatial/aggregate` reste indépendant du nombre de parties
  historiques d'un joueur (test avec un compte à 200+ parties sur une même
  map/héros) — sinon la lecture retombe sur un scan des grilles brutes
  quelque part dans le code, à corriger avant mise en prod.
- Tester le coupe-circuit de télémétrie en simulant un build cassé sur
  plusieurs replays d'affilée dans une même session daemon : confirmer qu'un
  seul rapport part par empreinte, et que les tentatives s'arrêtent après le
  nombre d'échecs consécutifs configuré.
