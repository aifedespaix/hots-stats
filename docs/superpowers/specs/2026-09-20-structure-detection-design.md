# Structure Detection (Chronologie) — Design

**Statut :** validé (catégories + forme des marqueurs), prêt à implémenter.

## Contexte et cause racine

La bande « structures » de l'onglet Chronologie n'a jamais rien affiché : `timeline.structureEvents` est vide pour **toutes** les parties. Enquête menée sur les 969 replays locaux (2 instrumentés étape par étape, 32 validés pour la règle d'équipe) — deux défauts daemon cumulés.

1. **Le camp n'est jamais résolu.** `_structure_unit_teams_by_tag` (`daemon-python/src/parser.py`) fait `tracker_id_to_toon.get(event["m_controlPlayerId"])`. Or les unités de structure portent `m_controlPlayerId = 11` ou `12`, alors que `tracker_id_to_toon` (construit sur les `PlayerInit`) ne contient que les ids joueurs **1..10**. Résultat : `structure_tags = {}` → `_extract_structure_events` retourne `[]`, systématiquement.
2. **La table des types est fausse.** `_STRUCTURE_UNIT_TYPE_NAME_PREFIXES` a été devinée (son propre commentaire dit `UNCONFIRMED ... not verified against a real replay`). Les seuls noms réels qu'elle attrape sont `TownWall*` / `TownGate*` ; les vrais bâtiments ne matchent rien : aucun fort, donjon, cœur ni tour.

Le test unitaire existant ne pouvait pas le détecter : il fabrique `_unit_born_event(1, "TownFort")` — un id de joueur et un nom d'unité qui n'existent dans aucun replay. Le test encode l'hypothèse fausse.

## Décisions validées

- **4 catégories** : `core` (Cœur), `bastion` (Fort + Donjon), `tower` (Tour), `gate` (Porte).
  Les segments de mur (`TownWall*`) sont **ignorés** (~9,2 détruits/partie, essentiellement par effet de bord).
- **Camp** : `m_controlPlayerId` **11 → équipe 0**, **12 → équipe 1**. Établi sur 32 replays : seuls 11 et 12 apparaissent (1094 / 1095 occurrences) et 56/56 cœurs sont du côté attendu.
- **Marqueurs (style B)** : un **carré** reste la famille « structure » (jamais confondu avec une pastille de mort ronde) ; le type est porté par un **glyphe interne** — bastion = plein, tour = créneaux, porte = arche, cœur = grand carré à anneau. Couleur = camp.
- **Versionnage** : `PARSER_VERSION` 1.15 → **1.16** ; `MIN_PARSER_VERSION` 1.10 → **1.16**.

## Architecture

`_extract_structure_events` (daemon) → `POST /ingest` → schéma zod partagé → `match_structure_events` → `GET /matches/:id` → `buildMatchTimelineSeries` → `MatchTimelineChart.vue`.

## Changements par couche

### Contrat partagé
- `packages/shared-types/src/replay-payload.ts` : `structureType` → `z.enum(["core","bastion","tower","gate"])` ; docstring mise à jour (elle annonçait « best-effort/unconfirmed », ce n'est plus le cas).
- `packages/db/src/schema/match-structure-events.ts` : `pgEnum("structure_type", ["core","bastion","tower","gate"])`.
- `apps/web/app/types/coach.ts` : les deux unions `structureType` dupliquées côté web.

### Migration
`match_structure_events` n'a jamais contenu de ligne (la détection n'a jamais rien produit). La migration recrée néanmoins le type avec un `CASE` de sécurité (`fort|keep → bastion`, `wall → tower`, `core → core`) : Postgres ne sait pas retirer une valeur d'un enum, il faut renommer puis recréer le type.

### Daemon (`daemon-python/src/parser.py`)
- Nouvelle table réelle : `TownTownHall` → bastion, `KingsCore`/`TownTownCore` → core, `TownCannonTower` → tower, `TownGate` → gate. `TownWall*` non listé.
- Nouvelle constante `_STRUCTURE_TEAM_BY_CONTROL_ID = {11: 0, 12: 1}`, documentée par la mesure.
- `_structure_unit_teams_by_tag` : résout par cette constante, **puis** par `tracker_id_to_toon` (au cas où un jour un id joueur apparaisse) ; si rien ne résout, la structure est sautée (aucune devinette).

### Web
- `useMatchTimelineSeries.ts` : `STRUCTURE_LABELS` → Cœur / Bastion / Tour / Porte.
- `MatchTimelineChart.vue` : glyphes par type + légende avec les mêmes marqueurs ; l'infobulle existante nomme déjà type et camp.

## Tests

- **Daemon** : réécriture des tests de structures avec des données **réelles** (ids 11/12, `TownTownHallL2/L3`, `KingsCore`, `TownCannonTower`, `TownGate`), plus un test de non-régression montrant que l'ancienne forme `TownFort` ne matche plus.
- **Web** : `structureTypeLabel` pour les 4 valeurs ; les helpers de marqueurs (`timelineStructureMarkers`, `timelineStructureLanes`, `timelineComparison`) sont déjà testés et ne dépendent pas des libellés.
- **Validation d'intégration** : rejouer `_extract_structure_events` sur un échantillon des 969 replays locaux et vérifier les compteurs par catégorie (script de diagnostic jetable, non commité).

## Conséquences opérationnelles

- `MIN_PARSER_VERSION` 1.16 force chaque daemon à reparser et re-uploader **tout** son historique : c'est le seul moyen de remplir les parties déjà en base. Volontaire et validé.
- Le reparse local des 969 replays se fait au prochain run du daemon, ou via `python -m src.main --resync`.

## Hors périmètre

- Murs et segments de porte (`TownWall*`).
- Filtre UI « objectifs seulement » (possible plus tard, la donnée étant désormais complète).
- Pro Comparison View / heatmaps : inchangés.
