# Daemon : table d'upload, ordonnanceur discret, remontée d'erreurs, garde-fou de dépendance — Design

Date : 2026-10-05. Statut : en attente de relecture.

## Objectif

Le joueur voit exactement l'état de synchronisation de chacune de ses parties, la sync ne gêne
pas une partie en cours, toutes les erreurs du daemon (builds non gérés compris) arrivent au
serveur pour qu'un prompt « vérifie les parties non à jour » puisse servir à améliorer la
gestion d'upload, et un build de replay compatible ne demande jamais de réinstaller le daemon.

## Décisions prises (avec l'utilisateur)

- Le protocole de replay bouge rarement : le cas courant est « build nouveau mais compatible »,
  déclaré par le serveur. Une mise à jour du daemon n'est nécessaire que si `heroprotocol`
  lui-même doit monter.
- Colonne « partie » = libellé `Map · Héros · Mode` ; nom de fichier au survol ; bouton
  « Afficher dans l'explorateur » par ligne.
- Données d'affichage de l'historique : récupérées auprès de l'API par lots, sans re-parser.
- Upload : un worker, une connexion, pause du backlog pendant le jeu, réglage + bouton manuel.
- Erreurs : tout `WARNING`/`ERROR` du daemon remonte, avec dédoublonnage, débit limité et file
  hors ligne. Pas d'état de sync périodique (YAGNI).
- Hors périmètre : livrer du code de parsing depuis l'API ; télémétrie périodique.

## 1. Modèle de données et statut d'upload

Un statut unique par replay dans la table `replays` de `SyncState` (`sync_state.py`), partagé
par l'ordonnanceur, la table et les rapports d'erreur :

`pending`, `uploading`, `synced`, `outdated`, `error`, `quarantined`, `skipped`, `missing`.

- `outdated` : synchronisé à une version de parseur inférieure à `minParserVersion`.
- `missing` : suivi mais fichier absent (déjà géré par `refresh_file_existence`).

Colonnes ajoutées par `ALTER TABLE ADD COLUMN` (même mécanisme que les migrations existantes
de `_open`) : `status`, `uploaded_at`, `last_attempt_at`, `base_build`, `hero`, `game_mode`,
`played_at`, `won`. Les lignes existantes sont rétro-remplies : `status` déduit de
`synced`/`error`/`skipped`, le reste à `NULL`.

Champs d'affichage, deux chemins :
- Nouveau replay : pris dans le payload au parsing.
- Historique : `HistoryEnricher` (section 3).

## 2. `UploadScheduler`

Remplace le `ThreadPoolExecutor` de `_run_sync_loop` (`app.py`).

- Un thread, une file à deux priorités : nouveaux replays (`watch_replays`) puis backlog
  (`pending`/`outdated`). Pause ~1 s entre deux fichiers du backlog (constante).
- Une seule `requests.Session` (celle d'`ApiClient`). Priorité CPU basse conservée
  (`_lower_worker_priority`).
- Détection du jeu : poller toutes les 5 s (uniquement s'il reste du backlog) cherchant
  `HeroesOfTheStorm_x64.exe` via `CreateToolhelp32Snapshot` en `ctypes` (pas de `psutil`).
  Jeu détecté : backlog suspendu, nouveaux replays toujours envoyés.
- Réglage « Synchroniser pendant le jeu » (config) et bouton pause/reprise manuel dans l'onglet
  Sync. Le bouton pause bloque le backlog sans condition ; « reprendre » ignore le poller.
- Réseau/429/5xx : backoff exponentiel 2 s → 5 min. `AuthError` : suspension complète + toast
  tray, reprise après nouvelle authentification (au lieu de marquer chaque fichier en erreur).
- État repris au redémarrage depuis les statuts ; arrêt via le `stop_event` existant.

## 3. API de lookup, `HistoryEnricher`, table

### API (`apps/api`)
- `POST /ingest/matches/lookup` dans `routes/ingest.ts` (derrière `authToken`). Corps
  `{ replayHashes: string[] }`, 200 maximum, schéma zod dans `packages/shared-types`.
- Réponse `{ matches: { replayHash, matchId, map, gameMode, playedAt, hero, won }[] }`.
- Un seul `SELECT` sur `matches` joint à `match_players`. Le joueur de l'utilisateur est
  `match_players.battletag IN (linkedBattletags(userId))` (`lib/account-scope.ts`), et non
  `match_players.userId`, pour respecter le multi-comptes. Hashs inconnus ou appartenant à
  d'autres utilisateurs : omis sans erreur.

### Daemon
- `HistoryEnricher` : lots de 200 pour les lignes `synced`/`outdated` auxquelles manque
  `hero`/`game_mode`/`played_at`/`won`, en arrière-plan, pause entre lots, retry hors ligne.
- Il réconcilie aussi les lignes `quarantined` : si le lookup les trouve (build déclaré
  compatible, payloads mis en attente insérés par `build-verification.service.ts`), elles
  passent `synced` sans re-parsing ni nouvel upload.

### Table (`gui.py`, onglet Sync)
- `ttk.Treeview` + barre de défilement, trié par date de partie décroissante, tri par clic.
- Colonnes : Partie, Date de la partie, Date d'envoi, Résultat, Statut (pastille), Build.
- Filtre par statut avec compteurs. Survol : nom de fichier, message d'erreur. Bouton
  « Afficher dans l'explorateur » (`explorer /select,<chemin>`, désactivé si `missing`).
- Remplissage par pages de 500 au défilement. Mises à jour depuis les threads de fond via la
  file de messages Tk existante.

## 4. `ErrorReporter`

- Nouveaux types dans `daemonErrorTypeSchema` et l'enum Postgres `daemon_error_type` :
  `quarantine`, `runtime`, `dependency` (migration Drizzle, lignes existantes inchangées).
- Chemin unique : `_report_error` (`ingestion.py`) et un `logging.Handler` de niveau `WARNING`
  sur le logger racine du paquet passent par `ErrorReporter`. Champs ajoutés au schéma :
  `heroprotocolVersion`, `status`, `occurrences`.
- Dédoublonnage par type + message normalisé + `replayHash` (compteur local, envoyé avec le
  report distinct suivant). Débit : 1/s et 30/min, excédent regroupé.
- File hors ligne : table SQLite `pending_error_reports` dans `sync_state.db`, plafonnée à 500
  (plus anciens supprimés), renvoyée à la reconnexion sur le même worker réseau que l'upload.
- Garde de réentrance : un échec d'envoi ne log jamais en `WARNING`.
- Chemins locaux (`C:\Users\<nom>\...`) remplacés par `~` dans les tracebacks. Aucun contenu
  de replay envoyé.
- Serveur : `recordDaemonError` additionne `occurrences` sur la ligne de même clé ;
  `GET /_internal/errors` les regroupe déjà. `raw_replays_quarantine` reste la source des
  payloads bruts.

## 5. Builds compatibles et garde-fou `heroprotocol`

- Build compatible : flux serveur inchangé (quarantaine → `check-build`). Retour au daemon via
  la réconciliation du `HistoryEnricher`. Si un adapter est nécessaire, il est écrit dans
  `adapters/registry.ts`, sans déploiement du daemon.
- `HEROPROTOCOL_VERSION` : constante de `constants.py`, avec un test la comparant au tag épinglé
  dans `pyproject.toml` (pas d'`importlib.metadata`, peu fiable dans l'`.exe` Nuitka).
- `GET /ingest/version` ajoute `minHeroprotocolVersion` (`apps/api/src/constants.ts`, monté à
  la main quand un build l'exige).
- Daemon sous le minimum : backlog suspendu (`pending`), nouveaux replays toujours tentés,
  vérification de mise à jour Velopack forcée (installée si auto-update actif), bandeau
  « Mise à jour requise » dans l'onglet Sync, un seul report `dependency`. Revérification aux
  cycles de l'updater ; reprise automatique après mise à jour.

## Tests

- Daemon (`pytest`) : ordonnanceur (priorités, pause jeu, backoff, auth), `ErrorReporter`
  (dédoublonnage, débit, file hors ligne, pas de boucle de logs, anonymisation), migrations et
  colonnes de `SyncState`, `HistoryEnricher`, garde-fou de version, cohérence
  `HEROPROTOCOL_VERSION`/`pyproject`. Table : tests de la couche de données (tri, filtre,
  pagination), pas du rendu.
- API : lookup (limite 200, isolation entre utilisateurs, multi-comptes), `occurrences`,
  nouveaux types d'erreur, `minHeroprotocolVersion`.

## Ordre de livraison proposé

1. Types d'erreur + `ErrorReporter` (répond au besoin « tout remonte au serveur »).
2. Statut et colonnes de `SyncState`.
3. `UploadScheduler`.
4. API de lookup + `HistoryEnricher`.
5. Table de l'onglet Sync.
6. Garde-fou `heroprotocol`.

Chaque étape est livrable seule. Aucun bump de `PARSER_VERSION` / `MIN_PARSER_VERSION` n'est
prévu : le parsing ne change pas.
