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

## 2. Chantiers identifiés nécessitant validation avant implémentation

Classés par priorité perçue. Aucun n'est un bug qui casse une
fonctionnalité aujourd'hui — ce sont des choix de conception ou des trous
UX qui valent la peine d'une décision produit avant d'y toucher.

### 2.1 [UX — priorité haute] Le daemon ne signale jamais proactivement son
état ; il faut ouvrir les Paramètres pour tout voir

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
