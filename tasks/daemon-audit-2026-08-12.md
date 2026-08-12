# Audit du daemon (`daemon-python/`) — 2026-08-12

État des lieux critique du daemon Windows : performance, logique/fiabilité,
et qualité UX, fonctionnalité par fonctionnalité. Basé sur une lecture
complète des ~5 400 lignes de `src/` (18 modules), de la suite de tests
(245 tests après cette session), du `README.md` du daemon et du workflow
`build-daemon.yml`.

**Constat général** : ce daemon a déjà fait l'objet de plusieurs vagues de
durcissement ciblées (voir l'historique git récent : "make live-draft
capture failures visible instead of silent", "stop the daemon vanishing
silently on update/sync failures", "improve live-draft OCR accuracy"...).
Beaucoup des pièges classiques d'un tel outil sont déjà couverts : aucune
exception ne peut tuer la boucle de sync (`ingestion.ingest_file` ne lève
jamais), les mises à jour ont un filet de sécurité complet (rollback vers
la version précédente si le relaunch échoue), la capture de draft gère la
superposition de deux pressions de touche via un compteur de génération,
etc. Cet audit part donc de cette base déjà solide et cherche les angles
morts restants plutôt que de re-découvrir ce qui est déjà traité.

## 1. Corrections appliquées directement dans cette session

Trois problèmes concrets, corrigés et testés (`245 passed`, `ruff check`
propre) — pas de changement de comportement pour le cas nominal.

### 1.1 Un raccourci de draft en cours d'enregistrement peut avaler la
prochaine frappe du joueur *en jeu* (logique — le plus sérieux des trois)

`gui.py`, onglet Draft Live, bouton « Modifier… » : `_capture_hotkey_worker`
appelle `keyboard.read_hotkey(suppress=True)`, un appel **bloquant sans API
d'annulation** qui garde un hook clavier bas-niveau installé (et qui
supprime les frappes) jusqu'à ce qu'une combinaison soit pressée — n'importe
quand. Rien n'empêchait de fermer la fenêtre des paramètres (croix, Annuler,
Enregistrer) pendant cette attente : le thread restait actif en arrière-plan,
et la *toute prochaine* frappe du joueur — potentiellement une touche de
sort en pleine partie — était silencieusement absorbée par ce hook orphelin
au lieu d'atteindre le jeu.

**Scénario concret** : ouvrir les paramètres → Draft Live → « Modifier… » →
fermer la fenêtre sans presser de touche (croix ou Annuler) → lancer une
partie → la première touche pressée (une capacité, un raccourci) ne
déclenche rien dans le jeu.

**Fix** (`gui.py`, `_on_close` / `_save`) : bloque désormais la fermeture de
la fenêtre (croix, Annuler, Enregistrer) tant qu'une capture de raccourci
est en cours, avec un message explicite invitant à terminer (presser une
combinaison, ou Échap pour annuler) — c'est la seule façon de relâcher
proprement le hook.

### 1.2 Callbacks tkinter depuis des threads d'arrière-plan après fermeture
de la fenêtre (logique, robustesse)

Trois workers (`_check_connection_worker`, `_load_stats_worker`,
`_capture_hotkey_worker`) renvoient leur résultat au thread Tk via
`self._root.after(0, ...)`. Rien ne vérifiait que la fenêtre était encore
ouverte : fermer les paramètres pendant une vérification de connexion (le
check est *debounced* à 600 ms puis fait un aller-retour réseau) ou pendant
le chargement des stats pouvait faire arriver ce callback après
`root.destroy()`, avec un risque de `TclError`/`RuntimeError` levée dans un
thread que personne ne surveille (silencieux pour l'utilisateur, mais du
bruit et un état incohérent en interne).

**Fix** : nouveau helper `_after_if_open` (no-op si la fenêtre est déjà
fermée, `try/except` sur l'appel à `after` pour la fenêtre de course
résiduelle), branché sur les 7 points d'appel concernés.

### 1.3 Le moteur OCR (RapidOCR) se charge à froid pendant la toute
première capture réelle de la session (performance/UX)

`ocr.py` charge le moteur RapidOCR en singleton paresseux — délibérément,
pour ne pas payer ce coût (« over a second ») sur les démarrages où la
fonctionnalité n'est pas utilisée. Mais cela veut dire que le *premier*
appui sur le raccourci d'une session de jeu — en plein draft, le moment où
la rapidité compte le plus — payait ce coût de chargement en plus du
screenshot/crop/OCR normal, sans qu'aucune fenêtre n'ait de raison d'être
ouverte à ce moment pour l'amortir.

**Fix** : `ocr.warm_up()` (nouveau), appelé sur un thread dédié dès
`run_app()` si `draftFeatureEnabled` est vrai — le modèle est déjà chargé
en mémoire par le moment où le joueur presse le raccourci pour de vrai.
Best-effort et idempotent (le singleton existant garantit qu'il n'est
construit qu'une fois).

Fichiers modifiés : `src/gui.py`, `src/app.py`, `src/ocr.py`,
`tests/test_ocr.py` (2 nouveaux tests).

## 2. Chantiers identifiés, implémentés dans une session de suivi

Classés par priorité perçue. Aucun n'était un bug qui cassait une
fonctionnalité — ce sont des choix de conception ou des trous UX. Les
sections 2.1 à 2.4 ont été implémentées dans une session de suivi
(2026-08-12, `268 passed`, `ruff check` sans nouvelle régression) ; chacune
documente ci-dessous le choix retenu là où le texte original appelait
explicitement une décision produit. 2.5 reste volontairement non traitée
(voir cette sous-section : ce n'est pas un problème visible aujourd'hui).

### 2.1 [UX — priorité haute] Le daemon ne signale jamais proactivement son
état ; il faut ouvrir les Paramètres pour tout voir

**Implémenté.** `TrayController.notify` est maintenant relié à la sync de
replays via `_DaemonRunner` (`app.py`) : la construction du tray a été
déplacée *avant* le premier `daemon.start()` dans `run_app()` (elle avait
lieu après), ce qui permet à `_DaemonRunner.set_tray_notify` de brancher
`tray.notify` avant que quoi que ce soit ne parte en synchronisation. Deux
notifications, correspondant aux deux pistes évoquées ci-dessous :

- **Scan initial** : `_run_sync_loop` prend un callback `on_initial_scan`,
  appelé une fois avec le nombre de replays trouvés sur disque avant toute
  ingestion. `_DaemonRunner.start(config, announce_initial_scan=...)`
  n'active ce toast que pour le tout premier lancement (`first_run`, calculé
  dans `run_app()` avant que la fenêtre de configuration initiale ne crée
  `config.json`) — décision délibérée pour ne pas re-notifier à chaque
  redémarrage normal du daemon (un joueur qui redémarre son PC avec des
  milliers de replays déjà synchronisés n'a pas besoin de revoir ce message
  à chaque fois, puisque `status.set_found` compte tous les fichiers sur
  disque, pas seulement les non-synchronisés).
- **Échecs persistants** : `StatusTracker` suit désormais
  `consecutive_failures` (remis à zéro à chaque succès). Au-delà de
  `_PERSISTENT_FAILURE_THRESHOLD = 5` échecs d'affilée,
  `_DaemonRunner._maybe_notify_persistent_failure` déclenche un toast unique
  ("Ouvrez les paramètres pour voir le détail"), protégé par un verrou pour
  rester idempotent malgré la parallélisation de 2.3. Le seuil de 5 est un
  choix arbitraire raisonnable (assez haut pour ignorer un fichier isolé
  corrompu, assez bas pour prévenir avant qu'un token révoqué ne fasse
  échouer tout un backlog) — pas de notion de "tentatives espacées dans le
  temps" au-delà de ça, jugée superflue pour une première version.

Le tray icon est statique quel que soit l'état du daemon : pas de couleur,
pas de badge, pas de notification pour une erreur de sync persistante. Deux
mécanismes existent déjà pourtant (`TrayController.notify`, utilisé pour
les mises à jour ; `StatusTracker` / `DraftCaptureCoordinator`, qui suivent
déjà l'état en detail) — ils ne sont simplement jamais reliés l'un à
l'autre pour la sync de replays.

La manifestation la plus visible est au **tout premier lancement** :
`gui._build_sync_tab` masque délibérément les compteurs live quand
`is_first_run` est vrai (« Les statistiques de synchronisation seront
disponibles ici une fois le daemon lancé »), et `run_app()` ferme cette
fenêtre *avant même* de démarrer `_DaemonRunner`. Résultat : un joueur qui
configure le daemon avec des centaines/milliers de replays déjà sur disque
voit la fenêtre se fermer, puis... rien. Pas de tray balloon, pas
d'indication que « 1 240 replays trouvés, synchronisation en cours ». Le
seul moyen de savoir que ça travaille est de rouvrir les Paramètres soi-même
et de regarder l'onglet Synchronisation. C'est exactement le moment où un
nouvel utilisateur a le plus besoin d'être rassuré que ça fonctionne.

**Pourquoi documenter plutôt que corriger directement** : la correction
correcte touche l'ordre de construction dans `run_app()` (le tray doit
exister *avant* que la boucle de sync démarre pour pouvoir notifier) et
demande des décisions produit : à partir de combien d'échecs consécutifs
notifier (pour ne pas spammer), un message différent au premier lancement
(« synchronisation initiale en cours ») vs en régime permanent (« erreur de
sync persistante »), etc. Piste : notifier une fois quand le scan initial
trouve des replays (première fois seulement), et notifier une fois quand
`StatusTracker.failed` dépasse un seuil sans amélioration après N tentatives
espacées.

### 2.2 [UX — priorité moyenne] Pas de moyen de tester la capture de draft
sans être en jeu

Le seul moyen de vérifier que hotkey → fenêtre → screenshot → crop → OCR →
upload fonctionne bout en bout est d'être en pleine partie, en plein draft.
En cas de souci, l'utilisateur doit aller fouiller
`%APPDATA%\hots-analytics\live-draft\captures\latest\` à la main pour voir
les crops et `crop-info.json` — un rapport très complet, mais pas accessible
depuis l'application elle-même.

**Piste** (à valider, plus gros que 2.1 côté UI) : un bouton « Tester la
capture » dans l'onglet Draft Live qui lance `capture_and_submit` sur la
fenêtre active (n'importe laquelle, pas seulement HotS) et affiche les 10
crops + le texte OCR + la confiance directement dans une fenêtre, sans
POST réel vers `/draft/snapshot`. Réduirait beaucoup la friction pour un
joueur non technique qui n'a jamais ouvert `%APPDATA%`.

**Implémenté.** `screen_capture.find_foreground_window` /
`capture_foreground_window` (nouveau) screenshotent la fenêtre qui a le
focus, sans filtrage de titre — contrairement à `find_game_window`, utilisé
par le hotkey réel. `draft_capture.run_test_capture` (nouveau) réutilise le
pipeline crop/OCR de `capture_and_submit` sur cette capture, sans jamais
construire de client API ni appeler `post_draft_snapshot` : structurellement
impossible d'envoyer un POST réel. Le bouton « Tester la capture » (onglet
Draft Live, `gui.py`) déclenche un compte à rebours de 3s avant la capture
(le clic laisse la fenêtre des paramètres au premier plan — le compte à
rebours laisse le temps de basculer vers la fenêtre à tester), puis ouvre
une fenêtre de résultat avec les 10 vignettes (agrandies ×~2-3 pour rester
lisibles) et le texte OCR + confiance de chaque slot, coloré comme le reste
de l'UI (vert = lu, rouge = illisible). Disponible même au tout premier
lancement, indépendamment de la case « Activer la capture de draft en
direct » — le but est justement de pouvoir tester avant de s'engager.

### 2.3 [Performance — priorité moyenne] Synchronisation initiale
strictement séquentielle, mono-thread

`app._run_sync_loop` traite le dossier de replays trouvés au démarrage
**un par un**, sur un seul thread (`ingestion.ingest_file` = hash + parse
CPU-bound via `heroprotocol` + upload réseau, en série). Le
`README.md`/`sync_state.py` mentionnent eux-mêmes que les replays « peuvent
se compter en milliers » pour un joueur avec beaucoup d'historique — la
toute première synchronisation (ou une resynchronisation complète après
« Réinitialiser mes données », qui vide tout le cache local, cf.
`SyncState.wipe_all`) peut donc prendre un temps significatif avant que
tout apparaisse sur le dashboard.

**Pourquoi documenter plutôt que corriger directement** : `SyncState` a déjà
un verrou interne (`threading.Lock`) et une connexion SQLite
`check_same_thread=False`, donc un pool de threads pour le hash+parse (I/O
+ CPU) est plausible sans tout réécrire — mais il faut décider du
parallélisme sur les *uploads* eux-mêmes (ne pas bombarder l'API de
requêtes concurrentes sans réflexion sur un éventuel rate-limit côté
serveur), et l'ordre d'affichage dans `StatusTracker.currently_syncing`
(actuellement "le fichier en cours", au singulier) devrait probablement
devenir une liste avec plusieurs fichiers en parallèle. Changement
structurel, pas une correction ponctuelle.

**Implémenté**, avec un choix de compromis délibéré sur le point qui
appelait explicitement une décision produit (le parallélisme des
*uploads*) : `app._run_sync_loop` traite désormais le backlog initial via
un `ThreadPoolExecutor` (`_INITIAL_SYNC_WORKERS = 4`), un seul pool pour
tout le pipeline `ingest_file` (hash+parse *et* upload), plutôt que deux
paliers de parallélisme distincts (un plus élevé pour le CPU-bound, un plus
bas et séparément réglé pour le réseau) — ce découplage plus fin reste
possible en évolution future mais aurait ajouté une vraie complexité pour
un premier jet. 4 requêtes concurrentes vers l'API reste modeste (l'ordre de
grandeur d'un navigateur vers un seul host), et chaque requête garde son
propre retry/backoff (`api_client.ApiClient.post_replay`) — donc pas de
"bombardement" au sens où l'audit initial s'en inquiétait. Les nouveaux
replays détectés après le backlog initial (`watch_replays`) restent traités
un par un, comme avant : ils arrivent trop rarement pour bénéficier du
parallélisme. `StatusTracker.currently_syncing` est passé de `str | None` à
`frozenset[str]` (plusieurs fichiers "en cours" à la fois), et l'onglet
Synchronisation (`gui.py`) les affiche joints par une virgule. `SyncState`
n'a nécessité aucun changement : son verrou interne et sa connexion
`check_same_thread=False` géraient déjà l'accès concurrent, comme
l'audit initial l'avait anticipé.

### 2.4 [Performance — priorité basse] Re-hachage complet de chaque replay
déjà synchronisé à chaque redémarrage du daemon

`ingestion.ingest_file` calcule le SHA-256 du fichier entier
(`hash_replay_file`, lecture par blocs de 1 Mo) avant même de savoir si le
replay a changé — donc à *chaque* démarrage du daemon, chaque replay déjà
synchronisé sur disque est relu intégralement juste pour vérifier qu'il n'a
pas changé. Pour une bibliothèque de plusieurs milliers de replays (quelques
Ko à quelques Mo chacun), ça peut représenter plusieurs centaines de Mo à
plusieurs Go relus à chaque lancement du daemon, avant même de savoir qu'il
n'y a rien à faire.

**Pourquoi documenter plutôt que corriger directement** : le hash de
contenu est le choix délibéré d'identité stable (survit à un déplacement/
renommage du fichier, contrairement à un couple chemin+mtime) — le
« corriger » sans le casser demanderait d'ajouter un cache
(chemin, taille, mtime) → hash déjà connu dans `sync_state.py`, avec
invalidation si l'un de ces trois change, ce qui touche le schéma de la
table `replays` et mérite d'être pensé avec le reste du schéma plutôt que
patché isolément.

**Implémenté**, exactement selon la piste décrite ci-dessus : nouvelle
table `file_hash_cache` (chemin, taille, mtime, hash) dans `sync_state.py`
— une table séparée plutôt qu'une extension de `replays`, pour ne pas
mélanger "identité stable d'un replay" (la table `replays`, clé = hash) et
"raccourci de calcul pour un chemin donné" (clé = chemin), deux besoins de
forme différente. `SyncState.cached_hash`/`cache_hash` : `ingest_file`
(`ingestion.py`) consulte le cache par `(chemin, taille, mtime)` avant de
lire le fichier ; toute différence sur taille ou mtime est traitée comme un
cache miss (recalcul + réécriture), ce qui couvre nativement le cas d'un
fichier modifié sur place. Un chemin jamais vu est aussi un miss simple —
pas besoin d'invalidation explicite au sens propre.

### 2.5 [Robustesse — priorité basse] Vérification de mise à jour GitHub
non authentifiée

`updater.check_for_update` appelle l'API GitHub publique
(`api.github.com/repos/.../releases/latest`) sans authentification —
limite à 60 requêtes/heure par IP source. À l'échelle actuelle (un check au
démarrage + un toutes les 6h par installation), ça ne pose pas de problème
pour un joueur isolé, mais plusieurs daemons derrière la même IP publique
(cybercafé, LAN party, un même foyer avec plusieurs comptes) pourraient se
gêner mutuellement — l'échec dégrade proprement (aucune mise à jour
détectée ce cycle-là, réessai au suivant), donc ce n'est pas un problème
visible aujourd'hui, juste un risque à surveiller si la base d'utilisateurs
grossit dans un même réseau.

## 3. Point examiné, écarté (pas une action à mener)

**Appariement des battletags par ordre d'apparition**
(`parser._extract_battletags`) : les battletags ("Nom#1234") sont extraits
du buffer brut du lobby puis associés aux joueurs de `m_playerList` par
ordre d'apparition parmi les candidats partageant le même nom affiché. Deux
joueurs avec un nom affiché strictement identique (mais des battletags
différents) dans la même partie pourraient en théorie se faire échanger
leurs battletags. C'est la même technique que `hots-parser` (le projet de
référence cité dans le docstring) — donc une limitation connue et déjà
acceptée par l'écosystème de parsers communautaires, pas une régression de
ce daemon. Pas d'action proposée sans un cas réel reproduit.
