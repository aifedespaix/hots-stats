# Epic 9 — Matchups Héros sur la Page Détail Héros

## Contexte

Tu travailles sur **HotS Analytics** (monorepo Bun : `apps/api` Hono,
`apps/web` Nuxt, `packages/db` Drizzle, `packages/shared-types`).
**Prérequis : Epics 1 à 6 terminés** (voir `tasks/README.md`) — en
particulier l'Epic 6 qui pose `pages/heroes/[slug].vue`,
`apps/api/src/services/talents.service.ts` (`getHeroSummary`,
`heroStatsQuery`) et le principe de `scope` (`"personal"` = parties de
l'utilisateur connecté, `"global"` = **toutes** les parties en base, tous
utilisateurs confondus — déjà utilisé par `GET /heroes/:heroId` pour la
comparaison "Toi / Communauté" affichée en tooltip sur cette page).

**Ne pas confondre avec l'existant `apps/web/components/face-a-face/` /
`apps/api/src/services/face-a-face.service.ts`** : ce module compare deux
**joueurs** (`myHeroId` vs `friendHeroId`, filtré par `battletag`), sur la
page `/face-a-face/[battletag]`. Cet Epic ajoute une brique différente :
comparer deux **héros**, sur `/heroes/[slug]`, agrégée sur l'ensemble des
parties du `scope` choisi (pas limitée à un adversaire précis). Le pattern
SQL (self-join `matchPlayers` sur `matchId` avec `ne(b.team, a.team)`) et
le principe `smallSample` (`packages/shared-types/src/stats.ts`,
`FACE_A_FACE_MIN_GAMES_FOR_COMBO = 2`) sont réutilisables tels quels,
seule la clé de regroupement change (`heroId` côté A et B, plus plus de
filtre `battletag`).

Schéma pertinent (`packages/db/src/schema/match-players.ts`) : par ligne
`match_players` on a `heroId`, `team` (0/1), `winner`, `kills`, `deaths`,
`assists`, `heroDamage`, `siegeDamage`, `healing`, `selfHealing`,
`damageTaken`, `experienceContribution`. **Pas d'attribution des kills**
(pas de log "héros A a tué héros B") : impossible aujourd'hui de calculer
"X morts causées spécifiquement par ce héros" sans étendre le parser
(`daemon-python/src/parser.py`) pour extraire les events de kill du
replay. À noter comme limite connue plutôt que contournée en donnée
approximative trompeuse.

## Objectif

Sur `/heroes/[slug]`, une nouvelle section "Matchups" qui répond à trois
besoins : (1) contre qui ce héros est fort/faible en un coup d'œil, (2)
une formule d'avantage réel isolant l'effet du matchup du niveau général
du héros, (3) une recherche libre pour un face-à-face contre n'importe
quel héros adverse.

---

## Livrable 1 — Wireframe textuel

Emplacement : nouvelle section entre les 4 `UiStatTile` du haut et
"Talents par palier" (le matchup influence le choix de talents, donc
logiquement avant).

```
┌─ Matchups ──────────────────────────────────── [Perso ⟷ Communauté] ─┐
│                                                                        │
│  🔍 Chercher un adversaire...                                        │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ [icône] Muradin        Tank                                    │   │
│  │ [icône] Malfurion      Support           ← liste filtrée live  │   │
│  │ [icône] Mal'Ganis      Bruiser                                 │   │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                        │
│  ── Meilleurs contres ──────────┬── Pires matchups ──────────────    │
│  🟢 [ic] Anub'arak   +14,2 pp   │  🔴 [ic] Zeratul   −11,8 pp        │
│      58,3% (n=42) · KDA 4.2↑    │      36,1% (n=37) · KDA 2.1↓       │
│  🟢 [ic] Chen        +9,7 pp    │  🔴 [ic] Valeera   −9,4 pp         │
│      54,1% (n=28) · KDA 3.6↑    │      38,4% (n=31) · KDA 2.4↓       │
│  🟢 [ic] ETC         +7,1 pp    │  🔴 [ic] Genji     −6,2 pp         │
│      51,6% (n=19, ⚠ peu de      │      40,2% (n=8, ⚠ peu de parties) │
│      parties)                   │                                    │
└────────────────────────────────────────────────────────────────────┘
```

Détails de lisibilité :
- **Avatar** (`heroes.iconUrl`) + **badge de rôle** en petit texte
  (`heroRole`, réutilise `formatHeroRole` déjà utilisé plus haut sur la
  page) sur chaque ligne — reconnaissance visuelle immédiate sans lire le
  nom.
- **Code couleur binaire** aligné sur les tokens déjà en place ailleurs
  sur la page (`text-success`/`bg-success/15` pour "meilleurs contres",
  `text-danger`/`bg-danger/15` pour "pires matchups") — pas de nouvelle
  palette à inventer, cohérence avec les `UiStatTile` du haut de page qui
  utilisent déjà `tone="success"/"danger"`.
- **Delta Winrate affiché en points de pourcentage (pp)**, pas en
  winrate brut, avec le winrate brut en sous-texte plus petit — c'est le
  delta qui doit sauter aux yeux, le winrate est le détail qui justifie.
- **Icône `⚠` + style atténué (`text-muted`, fond sans teinte)** sur les
  lignes sous le seuil d'échantillon minimum (cf. Livrable 2) : elles
  restent visibles (mieux que rien) mais ne doivent pas se confondre
  visuellement avec un vrai signal fiable — jamais de vert/rouge saturé
  sur une ligne `smallSample`.
- Colonnes best/worst en `sm:grid-cols-2` (empilées en mobile, comme le
  reste de la page qui est déjà responsive sur ce pattern), 3 lignes par
  colonne (identique à la limite "top 3" déjà en place côté
  `MatchupPanel.vue` pour la cohérence produit) + lien "Voir tous les
  matchups" si on veut un tableau complet plus tard (hors périmètre ici).
- Toggle `Perso ⟷ Communauté` en haut à droite de la section : même
  pattern que le `scope` déjà géré par la page (actuellement implicite via
  `user.heroStatsScope`) — au clic, refetch de la section uniquement, pas
  de la page entière.

### Intégration du champ de recherche (Head-to-Head)

Placé **au-dessus** des deux colonnes Best/Worst, en pleine largeur — la
recherche est l'action volontaire de l'utilisateur, elle doit être la
première chose visible en entrant dans la section, avant les listes qui
sont elles de la découverte passive.

- Input avec icône loupe, placeholder `Chercher un adversaire...`.
- En dessous, dropdown d'autocomplétion (cf. Livrable 3) listant les
  héros dont le nom matche, chacun avec son icône — jamais de résultat
  texte seul, toujours l'avatar en premier repère visuel comme dans les
  listes Best/Worst.
- Sélection d'un héros → la dropdown se ferme, une carte "Face à Face"
  apparaît **juste sous le champ de recherche** (au-dessus des colonnes
  Best/Worst, qui restent affichées en dessous pour ne pas perdre le
  contexte général).

### Carte "Face à Face" (résultat de la recherche)

Réutilise le pattern visuel de `VersusHeader.vue` (déjà utilisé dans
`/face-a-face/[battletag]`) mais avec deux héros au lieu de deux joueurs :

```
┌────────────────────────────────────────────────────────────────┐
│   [Avatar Héros A]        VS         [Avatar Héros B]           │
│   Illidan (toi)                       Uther (adverse)           │
│                                                                  │
│              ┌─────────────────────────┐                        │
│              │   53,2% de victoire     │  ← arc/gauge, pas juste │
│              │   ▲ +6,7 pp vs ta       │    un chiffre nu        │
│              │   moyenne (46,5%)        │                        │
│              └─────────────────────────┘                        │
│                                                                  │
│   Winrate matchup     53,2%  (24 parties, 13V/11D)              │
│   KDA dans ce duel    4.1    vs   3.2 (moyenne globale) ▲       │
│   Participation kills 61%    vs   54%                    ▲      │
│   Dégâts infligés     Δ +8%  ·  Dégâts subis  Δ −3%             │
│   Contribution XP     Δ +2 pts                                  │
│                                                                  │
│   → Voir nos 24 parties l'un contre l'autre                     │
└────────────────────────────────────────────────────────────────┘
```

- Le lien bas de carte réutilise le pattern déjà présent dans
  `MatchupPanel.vue` (`/matches?opponentBattletag=...`), mais doit filtrer
  par **héros** adverse et non par joueur : nécessite d'ajouter
  `opponentHeroId` comme query param de `GET /matches` (même logique que
  `opponentBattletag` existant, cf. Livrable Périmètre technique
  ci-dessous) → `/matches?heroId=<A>&opponentHeroId=<B>`.
- Si `gamesPlayed < seuil minimum` (cf. Livrable 2) : la carte s'affiche
  quand même (jamais un résultat de recherche qui ne montre rien), mais
  remplace le gauge par un bandeau neutre "Pas encore assez de parties
  pour un verdict fiable (n=X)" — même philosophie que les messages vides
  déjà écrits dans `MatchupPanel.vue` ("Pas encore assez de face-à-face
  pour dégager un contre fiable").

---

## Livrable 2 — Logique Data (algorithme de matchup)

### Delta Winrate — la formule

Le winrate brut d'un matchup mélange deux effets qu'il faut séparer : le
niveau intrinsèque du héros A (son winrate général, tous adversaires
confondus) et l'effet spécifique de rencontrer le héros B. Un héros A à
60% de winrate global qui affiche 55% contre B n'est pas "mauvais contre
B" dans l'absolu — il est *moins bon que d'habitude*, ce qui est
l'information utile pour un joueur qui drafte.

**Delta Winrate (brut)**

```
ΔWR(A, B) = WR(A vs B) − WR(A)
```

où :
- `WR(A vs B) = wins(A vs B) / n(A vs B)` — winrate de A dans les parties
  où B était dans l'équipe adverse, sur le `scope` choisi.
- `WR(A)` = winrate global de A tous adversaires confondus, **même
  scope** — c'est la baseline déjà exposée par `getHeroSummary(userId,
  heroId, scope)` dans `talents.service.ts`, pas de nouveau calcul.

Résultat exprimé en points de pourcentage (`ΔWR × 100`, cf. wireframe).
`ΔWR > 0` = matchup favorable, `ΔWR < 0` = défavorable.

**Problème du petit échantillon** : avec `n` petit, `WR(A vs B)` est
bruité (un 3-0 donne 100% de winrate et un delta énorme sur 3 parties,
non représentatif). Le repo a déjà ce problème résolu pour les combos
joueurs (`FACE_A_FACE_MIN_GAMES_FOR_COMBO = 2` +
flag `smallSample`, `packages/shared-types/src/stats.ts`) — même
principe ici, avec un seuil probablement plus élevé en scope `global`
(beaucoup plus de données disponibles qu'en `personal`) :
`HERO_MATCHUP_MIN_GAMES = 10` par exemple, à ajuster selon le volume réel
en base. En dessous du seuil : la ligne existe (backfill, jamais de liste
vide artificiellement), flaguée `smallSample: true`, jamais utilisée pour
le tri "meilleur/pire".

**Delta ajusté (recommandé pour le tri Best/Worst)** : plutôt que
d'exclure purement les petits échantillons, les ramener (shrinkage)
vers la baseline du héros avec un poids proportionnel à la confiance —
évite qu'un matchup à 2 parties (100%) batte un matchup à 40 parties
(58%) dans le classement :

```
WR_ajusté(A, B) = (wins(A vs B) + k · WR(A)) / (n(A vs B) + k)
ΔWR_ajusté(A, B) = WR_ajusté(A, B) − WR(A)
```

`k` = poids du prior en "parties équivalentes" (ex. `k = 10`) : plus `n`
est petit, plus `WR_ajusté` est tiré vers `WR(A)` (delta proche de 0,
classement neutre) ; plus `n` est grand, plus `WR_ajusté` converge vers
`WR(A vs B)` brut. C'est ce `ΔWR_ajusté` qui doit servir à trier/choisir
le top 3 Best/Worst ; le `ΔWR` brut reste affiché tel quel dans l'UI (les
joueurs veulent voir le vrai chiffre, pas une version lissée sans
l'expliquer).

### Statistiques complémentaires (au-delà de la victoire)

Le winrate dit *si* le matchup est bon, pas *pourquoi*. Trois deltas
supplémentaires, calculables directement depuis les colonnes existantes
de `match_players`, avec la même mécanique `valeur dans le matchup −
valeur baseline du héros` :

1. **Delta KDA** — `KDA(A vs B) − KDA(A)`, avec
   `KDA = (avgKills + avgAssists) / max(avgDeaths, 1)` (même formule que
   `computeKdaRatio` déjà utilisé sur la page héros). Révèle une pression
   en duel/skirmish indépendante du résultat final de la partie (ex. A
   gagne quand même moins souvent contre B, mais meurt beaucoup plus —
   matchup gagnable mais risqué).
2. **Delta participation aux kills** — même métrique que
   `avgKillParticipation` déjà calculée dans `talents.service.ts`
   (`(kills + assists) / kills_équipe_sur_la_partie`), recalculée sur le
   sous-ensemble "vs B". Un delta négatif signale que A se retrouve
   spectateur des teamfights face à ce héros (souvent le signe d'un
   matchup qui force à jouer passif/split).
3. **Delta dégâts infligés / subis** (`avgHeroDamage`, `avgDamageTaken`)
   — proxy économique du duel : qui domine l'échange de ressources même
   quand le winrate global de la partie ne le reflète pas encore (utile
   tôt dans une saison où l'échantillon winrate est encore bruité mais où
   la tendance dégâts est déjà nette).

Optionnel, repris de la demande initiale ("différentiel d'XP") : **Delta
contribution XP** (`experienceContribution`, déjà en base) — attention,
ce n'est pas de l'XP brute mais un **% de contribution à l'XP totale de
l'équipe** ; un delta négatif signifie que A "pèse" moins dans la montée
en niveau de son équipe face à B, pas qu'il prend littéralement moins
d'XP en lane (donnée d'XP brute par minute non disponible dans le schéma
actuel — nécessiterait une extraction supplémentaire côté parser si on
veut un vrai indicateur de dominance de lane).

> Limite assumée : sans attribution des kills par héros tueur (absente du
> schéma, cf. Contexte), aucune de ces stats ne peut isoler "A tue B
> spécifiquement" — tout est à l'échelle du match complet (A vs l'équipe
> qui contient B), pas du duel isolé. À documenter dans l'UI si besoin
> (tooltip "calculé sur l'ensemble de la partie, pas seulement vos
> accrochages directs") plutôt que de laisser croire à une précision
> qu'on n'a pas.

### Requête — approche

Réutilise exactement le pattern self-join de
`getPairedComboStats` dans `face-a-face.service.ts` (alias `a`/`b` sur
`matchPlayers`, jointure `and(eq(b.matchId, a.matchId), ne(b.team,
a.team), ne(b.id, a.id))`), mais :
- Filtre `a.heroId = targetHeroId` (au lieu de `a.userId`).
- Filtre `scope === "personal" ? eq(a.userId, userId) : undefined` (même
  bascule que `heroStatsQuery` dans `talents.service.ts`).
- `GROUP BY b.heroId` (au lieu de battletag) pour obtenir un agrégat par
  héros adverse, sur toutes les parties du scope — pas juste un
  adversaire précis.
- La baseline `WR(A)` / KDA(A) / etc. vient d'un seul appel à
  `getHeroSummary(userId, heroId, scope)` (déjà existant), calculé une
  fois et réutilisé pour tous les deltas de la liste.

---

## Livrable 3 — Micro-interactions UX

**Champ de recherche (autocomplétion)**
- Debounce ~150 ms sur la saisie (recherche côté client sur la liste des
  héros déjà chargée en `scope="global"`, cf. Périmètre technique — pas
  besoin d'aller-retour serveur, la liste des héros est petite et
  statique).
- Filtrage tolérant aux accents/casse (`Mal` doit matcher `Mal'Ganis` et
  `Malfurion`), résultats triés par pertinence puis alphabétique.
- Chaque ligne de résultat : icône héros + nom + badge rôle discret,
  identique visuellement aux lignes Best/Worst — un utilisateur qui a vu
  la section doit reconnaître le même langage visuel dans la recherche.
- Navigation clavier complète (`↑`/`↓` pour parcourir, `Entrée` pour
  sélectionner, `Échap` pour fermer) — cohérent avec les autres
  composants de recherche déjà dans l'app (typeahead battletag mentionné
  dans `match-players.ts`).
- État vide ("Aucun héros ne correspond à *xyz*") plutôt qu'une liste qui
  disparaît silencieusement.
- Le héros actuellement affiché sur la page (A lui-même) est exclu des
  résultats — un matchup d'un héros contre lui-même n'a pas de sens.

**Apparition de la carte Face à Face**
- Transition douce (translate + fade, ~200 ms, `ease-out`) plutôt qu'un
  pop instantané — la carte "descend" depuis le champ de recherche pour
  suggérer visuellement qu'elle est le résultat de cette action, pas un
  élément indépendant de la page.
- Le pourcentage de victoire au centre de la carte s'anime en comptant
  jusqu'à sa valeur finale (~400 ms) plutôt que de s'afficher figé — un
  détail qui rend le chiffre "vivant" et attire l'œil sur la métrique
  principale avant les lignes de détail en dessous.
- Skeleton (placeholders gris pulsants sur les zones avatar/chiffres)
  pendant le fetch du duel, jamais un simple spinner plein écran — la
  structure de la carte doit être visible immédiatement pour que
  l'utilisateur sache ce qui arrive.
- Un second héros cherché **remplace** la carte existante (pas
  d'empilement) : nouvelle transition de sortie (~150 ms fade) puis
  entrée de la nouvelle carte, jamais les deux visibles en même temps.
- Bouton "×" discret sur la carte pour la refermer sans relancer une
  recherche, qui ramène le focus sur le champ de recherche.

**États réutilisés du reste de l'app** (cohérence, pas de nouveau
pattern) : `smallSample` → bandeau `text-muted` identique aux messages
vides déjà écrits dans `MatchupPanel.vue` ; erreur réseau → même style de
bloc que `v-if="error"` déjà en haut de `pages/heroes/[slug].vue`.

---

## Périmètre technique (pour l'implémentation)

### 1. API
- `packages/shared-types/src/stats.ts` : nouveaux types
  `HeroMatchupEntry` (heroId/name/role/iconUrl adverse, gamesPlayed,
  wins, winrate, deltaWinrate, adjustedDeltaWinrate, avgKills/Deaths/
  Assists, kda, deltaKda, avgKillParticipation, deltaKillParticipation,
  avgHeroDamage, deltaHeroDamage, avgDamageTaken, deltaDamageTaken,
  avgExperienceContribution, deltaExperienceContribution, smallSample) et
  `HeroMatchupsResponse` (heroId, scope, baselineWinrate,
  baselineGamesPlayed, bestMatchups: HeroMatchupEntry[], worstMatchups:
  HeroMatchupEntry[]). Nouvelle constante `HERO_MATCHUP_MIN_GAMES` (à
  côté de `FACE_A_FACE_MIN_GAMES_FOR_COMBO`, valeur à calibrer sur les
  volumes réels en scope `global`).
- `apps/api/src/services/hero-matchups.service.ts` (nouveau) :
  `getHeroMatchups(userId, heroId, scope)` → top 3 best/worst par
  `adjustedDeltaWinrate`, backfill `smallSample` comme `pickTopCombos`
  dans `face-a-face.service.ts`. `getHeroMatchup(userId, heroId,
  opponentHeroId, scope)` → un seul `HeroMatchupEntry` pour la recherche
  Head-to-Head (même requête, `WHERE b.heroId = opponentHeroId` au lieu
  d'un `GROUP BY`).
- `apps/api/src/routes/heroes.ts` : `GET /heroes/:heroId/matchups?scope=`
  et `GET /heroes/:heroId/matchups/:opponentHeroId?scope=`.
- `apps/api/src/routes/matches.ts` : ajouter `opponentHeroId` à
  `filtersQuerySchema`/la requête `GET /matches` (même endroit que
  `opponentBattletag`/`allyBattletag` existants), pour le lien "Voir nos
  parties l'un contre l'autre" de la carte Face à Face.

### 2. Web
- `apps/web/components/heroes/HeroMatchupList.vue` (colonnes Best/Worst)
  et `apps/web/components/heroes/HeroMatchupSearch.vue` (autocomplétion +
  carte résultat, peut réutiliser `VersusHeader.vue` en le généralisant
  pour accepter des héros en plus des joueurs, ou en créer une variante
  dédiée si la divergence de props est trop grande).
- Source de données de l'autocomplétion : `GET /heroes?scope=global`
  (déjà existant) filtré côté client — pas de nouvel endpoint de
  catalogue.
- `pages/heroes/[slug].vue` : insertion de la section entre les
  `UiStatTile` et "Talents par palier".

## Hors périmètre

- Tableau complet de tous les matchups (au-delà du top 3 best/worst) —
  extension future si demandée.
- Attribution des kills par héros tueur (nécessite un parser étendu,
  cf. Contexte) — les deltas restent à l'échelle du match, pas du duel
  isolé.
- Prise en compte du rang/MMR dans le calcul (pas de donnée de rang en
  base actuellement) — un matchup pourrait être faussé par une
  différence de niveau moyen des joueurs sur chaque héros plutôt que par
  le matchup lui-même ; à garder en tête si des stats communautaires
  globales prennent de l'importance.

## Jalon testable

- `GET /heroes/:heroId/matchups?scope=global` renvoie des deltas cohérents
  avec un calcul manuel sur 2-3 matchups connus en base.
- La section Matchups affiche bien les top 3 meilleurs/pires contres avec
  code couleur et flag petit échantillon visible quand `n < HERO_MATCHUP_MIN_GAMES`.
- La recherche Head-to-Head retourne une carte Face à Face cohérente pour
  n'importe quelle paire de héros ayant au moins une partie en commun, et
  un message clair (pas une carte cassée) quand il n'y en a aucune.
- Le lien "Voir nos parties l'un contre l'autre" filtre correctement
  `/matches` par héros + héros adverse.
