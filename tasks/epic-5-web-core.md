# Epic 5 — Cœur applicatif Web : Dashboard, Historique, Détail de partie

## Contexte

Tu travailles sur **HotS Analytics** (monorepo Bun). **Prérequis : Epics 1,
2 et 3 doivent être terminés** — authentification Google + PAT (Epic 2) et
pipeline d'ingestion des replays (Epic 3), pour avoir de la vraie donnée en
base à afficher. Si la table `matches` est vide en dev, insère quelques
lignes de seed manuellement (ou via l'API `/ingest` avec un payload
factice conforme à `packages/shared-types/src/replay-payload.ts`) plutôt
que de bloquer sur l'absence de vrais replays.

État actuel de `apps/web` (Epic 1) :

- Nuxt 3 + `@nuxt/ui` (v2, donc Tailwind v3 sous le capot).
- `assets/css/globals.css` : tokens OKLCH (`--color-background`,
  `--color-surface`, `--color-border`, `--color-foreground`,
  `--color-muted`, `--color-primary`, `--color-accent`, `--color-success`,
  `--color-danger`) déclinés en trois thèmes via `[data-theme="dark|light|contrasted"]`
  sur `<html>` (dark = défaut). Variables typographiques
  (`--font-heading`, `--font-body`, `--font-mono`) déclarées mais **aucune
  police n'est chargée** — à faire dans cet Epic (`@nuxt/fonts` ou
  `@nuxt/google-fonts`, polices cibles : Space Grotesk ou Bricolage
  Grotesque pour les titres, Outfit ou Geist pour le corps, JetBrains Mono
  pour les nombres/tableaux).
- `tailwind.config.ts` : mappe les couleurs Tailwind (`background`,
  `surface`, `border`, `foreground`, `muted`, `primary`, `accent`,
  `success`, `danger`) sur ces variables OKLCH.
- `nuxt.config.ts` : `colorMode` configuré avec `dataValue: "theme"` (donc
  le composable `useColorMode()` de `@nuxtjs/color-mode`, inclus par Nuxt
  UI, pilote directement l'attribut `data-theme`).
- Une seule page existe : `pages/index.vue`, placeholder qui vérifie juste
  la connectivité API. **Tu vas la remplacer par le vrai Dashboard.**
- Layout unique `layouts/default.vue`, minimal.

Directives UI/UX à respecter (rappel du brief produit) : rendu "Data
Analytics Dashboard" pro façon op.gg/tracker.gg, design flat/minimal
(bordures fines, coins subtilement arrondis, zéro glassmorphism/ombres
excessives), hiérarchie par contraste typographique et couleur plutôt que
par des effets visuels.

## Objectif

Construire les 3 premières pages fonctionnelles de l'app, connectées à
l'API sur de vraies données, avec le système de design complet (thèmes +
typographie) posé une fois pour toutes ici (les Epics suivants le
réutilisent, ils ne le redéfinissent pas).

## Périmètre

### 1. Finaliser le design system

- Charger les 3 polices, vérifier le rendu dans les 3 thèmes.
- Construire un petit set de composants réutilisables dans
  `components/ui/` (par-dessus Nuxt UI, pas en remplacement) : au minimum
  une carte de stat ("stat tile"), un composant de tableau de données
  aligné en `font-mono` pour les colonnes numériques, un sélecteur de
  thème (dark/light/contrasted) visible quelque part dans le layout
  (header ou sidebar).
- Layout applicatif : sidebar ou topbar de navigation entre les pages
  (Dashboard / Historique / Héros / Joueurs / Settings — même si seules
  Dashboard/Historique/Détail existent après cet Epic, prévoir les liens
  vers les pages de l'Epic 6 dans la nav, elles pourront pointer vers des
  pages pas encore créées pour l'instant si besoin, ou être commentées).

### 2. API — routes nécessaires côté `apps/api`

- `apps/api/src/routes/matches.ts` :
  - `GET /matches` — liste paginée avec filtres en query params : `mode`
    (game mode), `heroId`, `mapId`, `dateFrom`/`dateTo`, `opponentBattletag`
    (joueur croisé, allié ou adverse). Retourne les infos essentielles
    pour une liste (date, map, mode, durée, résultat V/D, héros joué).
  - `GET /matches/:id` — détail complet d'une partie : les 10
    `match_players` avec leur `talent_picks`, regroupés par équipe.
  - Protégées par la session cookie Google (utilisateur connecté) —
    scope les résultats aux parties où l'utilisateur connecté a un
    `match_players.userId` correspondant (pas toutes les parties de la
    base).
- `apps/api/src/routes/stats.ts` (a minima ce qui sert le Dashboard) :
  - Un endpoint de résumé global pour l'utilisateur connecté : winrate
    global, nombre de parties récentes, durée moyenne — de quoi remplir
    les stat tiles du Dashboard.

### 3. Pages Nuxt

- **`pages/index.vue` (Dashboard)** : vue d'ensemble — stat tiles
  (winrate, parties jouées, durée moyenne...), liste des dernières parties
  (mini version de l'historique, 5-10 lignes avec lien vers le détail), et
  une section "Télécharger le daemon" qui pointe vers la dernière release
  GitHub du `.exe` (l'URL peut être en dur vers la page Releases GitHub du
  repo pour l'instant si l'Epic 4 n'a pas encore de mécanisme
  d'auto-découverte de la dernière version — ne pas bloquer dessus).
- **`pages/matches/index.vue` (Historique)** : tableau des parties avec
  les filtres avancés décrits ci-dessus (mode, période, héros, map, joueur
  croisé), pagination.
- **`pages/matches/[id].vue` (Détail d'une partie)** : les deux
  compositions d'équipe côte à côte, scoreboard complet (K/D/A, dégâts,
  soin...), talents pris par palier pour chaque joueur. Une timeline
  basique de la partie n'est **pas obligatoire** dans cet Epic si les
  données d'events temporels ne sont pas encore extraites par le daemon
  (Epic 3) — si l'info n'existe pas en base, ne pas afficher une section
  vide, simplement l'omettre pour l'instant.

## Hors périmètre

- Analytics héros/talents agrégés, Radar des joueurs, profil détaillé
  joueur, page publique SSR — Epic 6.
- Page Settings (BattleTag, gestion du token) — normalement déjà livrée en
  Epic 2 ; si elle manque encore, ce n'est pas le périmètre de cet Epic,
  le signaler plutôt que de l'ajouter ici.

## Jalon testable

- Un utilisateur connecté voit ses vraies statistiques sur le Dashboard
  (pas de données mockées en dur dans le composant).
- L'Historique filtre correctement par mode/héros/map/période/joueur
  croisé (vérifiable en changeant les filtres et en confirmant que les
  résultats changent en conséquence côté réseau, pas juste côté UI).
- Cliquer sur une partie de l'historique ouvre son détail complet avec
  compositions, scores et talents.
- Basculer entre les thèmes dark/light/contrasted change effectivement
  l'apparence sans reload de page, sans flash de contenu non stylé au
  chargement initial.
