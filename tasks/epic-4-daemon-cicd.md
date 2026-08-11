# Epic 4 — CI/CD du Daemon (build `.exe`)

## Contexte

Tu travailles sur **HotS Analytics** (monorepo Bun, voir racine du repo).
**Prérequis : l'Epic 3 doit être terminé** — le daemon Python doit exister
et fonctionner dans `daemon-python/` (structure : `src/main.py`,
`src/watcher.py`, `src/parser.py`, `src/hasher.py`, `src/api_client.py`,
`src/config.py`, `src/constants.py`, plus `pyproject.toml` ou
`requirements.txt`). Si ce dossier n'existe pas encore ou est vide, arrête
et signale que l'Epic 3 doit être fait avant.

## Objectif

Une GitHub Action qui compile `daemon-python` en exécutable Windows
standalone (`.exe`), sans dépendance Python à installer côté joueur, et
publie cet exécutable de façon à ce que l'app web puisse le proposer au
téléchargement (Epic 5 s'occupera du lien de téléchargement côté UI ; ici
on s'occupe uniquement de produire et publier l'artefact).

## Périmètre

- Fichier : `.github/workflows/build-daemon.yml`.
- Runner : `windows-latest` (obligatoire — la compilation croisée
  Linux->Windows pour un `.exe` qui doit tourner nativement sans
  émulation n'est pas fiable pour ce cas d'usage).
- Outil de compilation : **Nuitka**, en mode standalone
  (`--standalone --onefile` ou `--standalone` + zip selon la taille finale
  — teste les deux et documente le choix dans un commentaire du workflow).
  Objectif explicite du choix Nuitka plutôt que PyInstaller : réduire les
  faux positifs antivirus (Nuitka compile en C puis natif, moins souvent
  flaggé que les exécutables PyInstaller qui embarquent un interpréteur
  zippé détecté comme suspect par certains AV). Si Nuitka pose un problème
  bloquant en pratique (build qui échoue, dépendance `heroprotocol`/
  `watchdog` incompatible), documenter clairement pourquoi et basculer sur
  PyInstaller en fallback — mais Nuitka reste le choix par défaut à
  essayer en premier.
- Déclenchement : sur tag (`v*`) et sur `workflow_dispatch` (permet un
  build manuel de test). Optionnellement aussi sur push vers la branche
  principale dans un dossier `daemon-python/**` pour un build de
  validation continue (sans forcément publier de release à chaque fois —
  à distinguer d'un vrai build de release sur tag).
- Étapes :
  1. Checkout.
  2. Setup Python (version cohérente avec celle utilisée en dev, à fixer
     dans `daemon-python/pyproject.toml`).
  3. Installer les dépendances (`heroprotocol`, `watchdog`, `nuitka`,
     etc.).
  4. Lancer Nuitka sur `daemon-python/src/main.py` pour produire
     `hots-analytics-daemon.exe`.
  5. Un test de fumée basique : lancer l'exe généré avec `--help` (ou un
     flag équivalent) sur le runner Windows et vérifier qu'il démarre sans
     crash immédiat — ça n'exécute pas de vraie logique replay mais ça
     valide que le binaire n'est pas cassé (dépendances manquantes,
     DLL manquante, etc.).
  6. Uploader l'exe en artifact du workflow (`actions/upload-artifact`)
     systématiquement.
  7. Sur un tag `v*` uniquement : créer/mettre à jour une **GitHub
     Release** avec l'exe attaché (`softprops/action-gh-release` ou
     équivalent), avec le tag comme version affichée.
- Versionning : le nom du fichier publié doit inclure la version (ex.
  `hots-analytics-daemon-v1.2.0.exe`), et cette version doit être
  cohérente avec `PARSER_VERSION` défini dans
  `daemon-python/src/constants.py` — décide et documente si ce sont deux
  versions indépendantes (version du binaire vs version du format de
  parsing) ou la même. Recommandation : les garder **indépendantes** — le
  binaire peut recevoir un patch (fix réseau, fix watcher) sans changer le
  format de données, donc sans forcer un re-upsert de tous les replays
  existants.

## Hors périmètre

- L'UI de téléchargement côté dashboard Nuxt (lien vers la dernière
  release GitHub) — Epic 5.
- La signature de code Windows (Authenticode) — pas prévue pour l'instant,
  à ne pas bloquer dessus ; si les faux positifs antivirus persistent
  malgré Nuitka, le signaler mais ne pas essayer de mettre en place un
  certificat de signature dans cet Epic.

## Jalon testable

- Un `workflow_dispatch` manuel sur `build-daemon.yml` termine en vert et
  produit un artifact `.exe` téléchargeable depuis l'onglet Actions du
  repo GitHub.
- Le `.exe` téléchargé et exécuté sur une machine Windows (ou VM) sans
  Python installé démarre correctement (au minimum affiche son aide/
  usage sans erreur de DLL/dépendance manquante).
- Un tag `v0.1.0` (ou équivalent) déclenche la création d'une Release
  GitHub avec l'exe attaché.
