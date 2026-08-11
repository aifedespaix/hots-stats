# Epic 6 — Analytics avancés : Héros, Talents, Joueurs

## Contexte

Tu travailles sur **HotS Analytics** (monorepo Bun). **Prérequis : Epics 1
à 5 doivent être terminés** — en particulier l'Epic 5 qui pose le design
system (thèmes OKLCH, polices, composants `components/ui/`, layout de
navigation) et les pages Dashboard/Historique/Détail de partie déjà
connectées à de vraies données. Réutilise ces composants et ce layout, ne
recrée pas un système de design parallèle.

Contrats déjà définis dans `packages/shared-types/src/stats.ts` (à
respecter/étendre plutôt que dupliquer) :

```ts
HeroSummaryStats { heroId, gamesPlayed, wins, winrate, avgKills, avgDeaths, avgAssists, avgKillParticipation }
TalentTierStats { tier, talentId, talentName, pickRate, winrate }
PlayerEncounterStats { battletag, gamesTogether, gamesAsAlly, gamesAsOpponent, winsAsAlly, winsAsOpponent }
```

Champ pertinent déjà en base : `packages/db/src/schema/users.ts` a un
champ `publicHandle` (unique, nullable) — c'est la clé de la page profil
publique SSR de cet Epic (`/u/[handle]`). S'il n'est pas encore renseigné
par l'utilisateur (pas d'UI pour le définir), ajouter ce champ à la page
Settings existante (créée en Epic 2) plutôt que de créer une nouvelle page
pour ça.

## Objectif

Les pages d'analyse avancée : statistiques par héros et par talent,
tableau de tous les joueurs rencontrés, profil détaillé d'un joueur, et la
version publique/partageable de ce profil en SSR pour le SEO.

## Périmètre

### 1. API — agrégations

Nouveau fichier `apps/api/src/services/talents.service.ts` (calculs
liés aux talents) en complément de `apps/api/src/services/stats.service.ts`
(déjà entamé en Epic 5 pour le résumé du Dashboard, à étendre ici).

- `GET /heroes` : liste des héros avec, pour l'utilisateur connecté,
  `HeroSummaryStats` par héros (parties jouées, winrate, KDA moyen,
  participation aux kills). Le calcul de la participation aux kills
  nécessite l'agrégat des kills totaux de l'équipe sur la partie — vérifie
  comment c'est le plus simple de le calculer depuis `match_players`
  (somme des kills de l'équipe du joueur sur le match, kills+assists du
  joueur divisé par ce total).
- `GET /heroes/:heroId/talents` : `TalentTierStats[]` — taux de sélection
  et winrate par talent, groupés par palier (1/4/7/10/13/16/20), calculés
  uniquement sur les parties où ce héros a été joué (par l'utilisateur
  connecté, ou plus large si on veut des stats communautaires — décide et
  documente le choix ; recommandation : rester scope à l'utilisateur
  connecté pour cet Epic, une vue "stats communautaires" globales serait
  une extension future hors périmètre).
- `GET /players` : tous les `battletag` distincts croisés par
  l'utilisateur connecté (alliés + adversaires confondus), avec
  `PlayerEncounterStats`, triable par pseudo/nombre de rencontres/victoires/
  défaites (tri côté serveur via query params, pas juste côté client — la
  liste peut être longue).
- `GET /players/:battletag` : détail des rencontres avec ce joueur
  précis : stats globales lors des rencontres mutuelles, et historique des
  parties partagées (peut réutiliser le format de liste de
  `GET /matches` de l'Epic 5 avec un filtre `opponentBattletag`/`allyBattletag`
  déjà prévu à ce niveau-là plutôt que de dupliquer la logique ici).

### 2. Pages Nuxt

- **`pages/heroes/index.vue`** : tableau/grille des héros avec leurs
  `HeroSummaryStats`, triable, avec un lien vers le détail de chaque héros.
- **`pages/heroes/[slug].vue`** : détail d'un héros — ses stats globales
  et le détail des talents par palier (`TalentTierStats`), présenté de
  façon lisible (le tri par palier doit être visuellement clair, ex.
  colonnes ou sections par palier 1/4/7/10/13/16/20).
- **`pages/players/index.vue` (Radar des Joueurs)** : tableau trié par
  pseudo / nombre de rencontres / victoires / défaites (tri interactif,
  cohérent avec le tri serveur de `GET /players`).
- **`pages/players/[battletag].vue`** : profil détaillé — stats globales
  des rencontres mutuelles + historique des parties partagées.
- **`pages/u/[handle].vue`** : version **publique** et **SSR** du profil
  d'un joueur, accessible sans authentification, adressée par
  `users.publicHandle` (pas par `battletag` ni id interne — ne pas exposer
  l'UUID interne dans l'URL). Doit avoir des balises meta SEO correctes
  (titre, description, éventuellement Open Graph pour un bon rendu au
  partage sur Discord/réseaux sociaux, cohérent avec l'usage réel : les
  joueurs vont partager ce lien). Cette page utilise un layout différent
  du dashboard authentifié (`layouts/public-profile.vue` à créer) — plus
  léger, sans la nav applicative complète, pensé pour un visiteur externe.
  Si `publicHandle` n'est pas défini pour l'utilisateur demandé, retourner
  une 404 propre (pas une page cassée).

## Hors périmètre

- Stats communautaires globales (tous joueurs confondus, pas juste
  l'utilisateur connecté) — extension future, pas cet Epic.
- Un vrai système de recommandation de build — cet Epic affiche le
  winrate/pick rate observé, il ne recommande pas un build optimal.

## Jalon testable

- La page Héros affiche des stats qui correspondent aux vraies parties en
  base (vérifiable en comparant manuellement avec 2-3 parties connues).
- Le détail d'un héros montre bien les talents groupés par palier avec
  taux de sélection et winrate cohérents.
- Le Radar des Joueurs se trie correctement sur les 4 critères demandés
  (pseudo, rencontres, victoires, défaites).
- `/u/<handle-existant>` charge en SSR (view-source contient le contenu,
  pas juste un `<div id="app">` vide) sans être connecté ; `/u/<handle-inexistant>`
  retourne une 404.
