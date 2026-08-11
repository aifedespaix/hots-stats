# Epic 3 — Daemon Python & Pipeline d'ingestion

## Contexte

Tu travailles sur **HotS Analytics**, une app d'analyse de stats Heroes of
the Storm. Le repo est un monorepo Bun :

```
apps/web            Nuxt (SSR) — dashboard, historique, etc.
apps/api            Hono sur Bun — API REST
packages/db          Schéma Drizzle + client Postgres
packages/shared-types Types/contrats partagés (Zod)
daemon-python         Client Windows (à créer dans cet Epic)
```

Déjà en place (Epics 1 et 2, à checkout sur la branche de travail avant de
commencer — vérifier avec `git log` que ces epics sont bien mergés) :

- `packages/shared-types/src/replay-payload.ts` définit
  `replayPayloadSchema` (Zod) : c'est le contrat exact du JSON que le
  daemon doit poster. Relis ce fichier avant de coder le parser Python —
  les champs (`replayHash`, `parserVersion`, `map`, `gameMode`, `region`,
  `playedAt`, `durationSeconds`, `players[]` avec `battletag`, `heroId`,
  `team`, `winner`, `kills/deaths/assists`, `heroDamage`, `siegeDamage`,
  `healing`, `selfHealing`, `damageTaken`, `experienceContribution`,
  `talents[]` avec `tier/talentId/talentName`) doivent correspondre
  exactement (mêmes noms en camelCase).
- `packages/db/src/schema/matches.ts` : `matches.replayHash` est unique,
  `matches.parserVersion` stocke la version ayant produit les données.
- `packages/db/src/schema/match-players.ts` et
  `packages/db/src/schema/talent-picks.ts` : tables liées par
  `matchId` / `matchPlayerId`.
- L'authentification par token se fait via un middleware Bearer côté API
  (introduit en Epic 2, cherche `apps/api/src/middleware/auth-token.ts` ou
  équivalent) : le daemon doit envoyer `Authorization: Bearer <token>` avec
  le Personal Access Token généré depuis le dashboard web.

## Objectif de cet Epic

1. **Côté API (Hono)** : une route d'ingestion qui reçoit le JSON du
   daemon, le valide avec `replayPayloadSchema`, et applique la logique
   d'upsert.
2. **Côté daemon (Python, Windows)** : un client qui surveille un dossier
   de replays, parse les nouveaux fichiers `.StormReplay`, construit le
   JSON conforme au contrat, et le POST vers l'API.

## Partie API — route d'ingestion

- Fichier : `apps/api/src/routes/ingest.ts`, monté sur `POST /ingest` (ou
  `/matches/ingest` — reste cohérent avec le reste des routes existantes).
- Protégée par le middleware Bearer (PAT) — pas par la session cookie
  Google (c'est le daemon qui appelle, pas un navigateur).
- Valide le body avec `replayPayloadSchema.parse(...)` (retourne 400 avec
  le détail Zod si invalide).
- **Logique d'upsert** (à mettre dans
  `apps/api/src/services/replay-upsert.service.ts`) :
  1. Chercher un match existant par `replayHash`.
  2. Si absent → `INSERT` du match + de tous les `match_players` +
     `talent_picks` associés, dans une transaction Drizzle.
  3. Si présent **et** `parserVersion` entrant > `parserVersion` stocké
     (comparaison semver simple, ex. via `compare-versions` ou un split
     `.` + comparaison numérique — pas besoin d'une lib lourde) → `UPDATE`
     du match et **remplacement complet** des `match_players`/`talent_picks`
     liés (delete + re-insert dans la transaction est le plus simple et
     évite les diffs partiels).
  4. Si présent et version entrante <= version stockée → ne rien faire,
     répondre 200 avec un flag `{ upserted: false, reason: "stale_version" }`.
  5. Pour chaque joueur du payload, tenter de lier `match_players.userId`
     à un `users.id` existant si `users.battletag` correspond au
     `battletag` du joueur (sinon `userId` reste `null`).
  6. Les FK vers `heroes.id` et `maps.id` doivent exister au préalable —
     si un hero/map slug inconnu arrive, soit on rejette avec un message
     clair (recommandé pour l'instant, évite les données orphelines), soit
     on les crée à la volée avec un nom placeholder. Documente ton choix.
- Retourne le match créé/mis à jour (id, upserted: true/false).

## Partie daemon — `daemon-python/`

Structure cible (déjà décrite dans le plan initial du projet) :

```
daemon-python/
  src/
    main.py         # entrypoint CLI, argument --resync
    watcher.py       # watchdog sur le dossier de replays
    parser.py        # heroprotocol -> dict conforme à replayPayloadSchema
    hasher.py         # hash unique et stable du fichier replay
    api_client.py      # POST vers l'API avec le Bearer token
    config.py           # lecture du token + endpoint + chemin des replays
    constants.py          # PARSER_VERSION courant (string, ex. "1.0")
  tests/
  pyproject.toml (ou requirements.txt)
```

- **Config** (`config.py`) : le daemon a besoin au minimum de
  `API_BASE_URL`, `ACCESS_TOKEN` (le PAT), et du dossier replays HotS par
  défaut (`%USERPROFILE%\Documents\Heroes of the Storm\Accounts\...\Replays\Multiplayer`
  sur Windows — prévoir un override par variable d'env ou fichier config
  local `%APPDATA%/hots-analytics/config.json`, pas de valeur en dur).
- **Hash** (`hasher.py`) : hash stable calculé sur le contenu du fichier
  replay (ex. SHA-256 du fichier binaire, ou d'un sous-ensemble
  déterministe des métadonnées si le fichier peut varier octet à octet
  sans changer la partie — à vérifier avec `heroprotocol`). Doit produire
  la même valeur si on relance un `--resync` sur le même fichier.
- **Parser** (`parser.py`) : utilise `heroprotocol` pour extraire les
  events/tracker events du replay et construit un dict Python qui,
  sérialisé en JSON, respecte exactement `replayPayloadSchema`. Attention
  aux types : `playedAt` en ISO 8601 (`datetime.isoformat()`), tous les
  compteurs en `int`, `team` en `0`/`1` uniquement.
- **Watcher** (`watcher.py`) : utilise `watchdog` pour détecter les
  nouveaux `.StormReplay` créés dans le dossier surveillé (event
  `on_created`, avec un petit délai/retry car le fichier peut encore être
  en cours d'écriture par le jeu à l'event de création — vérifier la
  stabilité de la taille du fichier avant de parser).
- **Mode `--resync`** (`main.py`) : au lieu d'attendre des events watcher,
  parcourt tout le dossier replays existant et POST chaque fichier trouvé
  (le serveur gère la dédup/upsert, donc `--resync` peut re-poster tout
  sans risque de doublon).
- **`api_client.py`** : POST JSON avec header
  `Authorization: Bearer {ACCESS_TOKEN}`, gère les retries réseau simples
  (le PC du joueur peut être hors ligne), et logue clairement les échecs
  (401 = token invalide/révoqué, 400 = payload rejeté avec le détail Zod
  renvoyé par l'API).

## Hors périmètre de cet Epic

- La compilation en `.exe` (Nuitka/GitHub Action) — c'est l'Epic 4, qui
  dépend de celui-ci.
- L'UI de téléchargement du daemon sur le dashboard — Epic 5.

## Jalon testable

- Un replay réel placé dans le dossier surveillé est détecté par le
  watcher, parsé, et un match apparaît en base (`SELECT * FROM matches`)
  avec ses `match_players` et `talent_picks`.
- Relancer le daemon sur le même fichier ne crée pas de doublon
  (`replayHash` unique respecté).
- `daemon-python/src/main.py --resync <dossier>` sur un dossier contenant
  plusieurs replays les upsert tous sans erreur.
- Un payload avec un `parserVersion` inférieur à celui déjà stocké ne
  modifie pas les données existantes (vérifiable via un test API direct
  avec `curl`/Postman, sans avoir besoin d'un vrai replay).
