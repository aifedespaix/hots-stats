# Roadmap — Epics restants

Ce dossier contient un brief autonome par Epic, pensé pour être collé tel
quel comme prompt de départ dans une **nouvelle session** Claude Code sur ce
repo (chaque session démarre sans mémoire des précédentes). Chaque fichier
rappelle donc le contexte nécessaire plutôt que de supposer une continuité.

## Déjà fait

- **Epic 1 — Fondations Monorepo & Infra** : Bun workspaces, `packages/db`
  (schéma Drizzle), `packages/shared-types`, squelette Hono (`apps/api`),
  squelette Nuxt (`apps/web`), docker-compose dev + Dokploy (backend/frontend
  séparés), `DEPLOYMENT.md`. Voir le commit initial sur
  `claude/hots-analytics-app-6qkjor`.
- **Epic 2 — Authentification & Comptes** : Google Auth, Personal Access
  Tokens, page Settings, middleware Bearer pour l'ingestion.
- **Epic 3 — Daemon Python & pipeline d'ingestion** : route `POST /ingest`
  (Hono, protégée par PAT, upsert par `replayHash`/`parserVersion` dans
  `apps/api/src/services/replay-upsert.service.ts`), et daemon
  `daemon-python/` (watcher, parser `heroprotocol`, hasher SHA-256, client
  API avec retries, config via env/`config.json`). Voir
  `daemon-python/README.md` pour l'usage. Notes pour la suite : le mapping
  `m_ammId` -> `ARAM` n'est pas confirmé (fallback `"Custom"`), et
  `talentId`/`talentName` réutilisent le même identifiant interne brut faute
  d'une table de traduction des talents — à affiner si besoin en Epic 6.
- **Epic 4 — CI/CD du Daemon** : `.github/workflows/build-daemon.yml`,
  compile `daemon-python` en `.exe` Windows standalone avec Nuitka
  (`--standalone --onefile`, cf. commentaires du workflow pour la
  justification du choix vs `--standalone` + zip et vs PyInstaller),
  déclenché sur tag `v*`, `workflow_dispatch`, et push sur
  `daemon-python/**`. Upload systématique en artifact ; sur tag `v*`,
  publie aussi une GitHub Release avec l'exe attaché
  (`softprops/action-gh-release`). Version du binaire (tag Git) et
  `PARSER_VERSION` (`daemon-python/src/constants.py`) sont volontairement
  indépendantes. Au passage, `mpyq` (utilisé par `parser.py` mais absent de
  `pyproject.toml`) a été ajouté aux dépendances — c'était un bug latent
  qui aurait fait échouer `pip install -e .` en CI. **Non vérifié
  end-to-end sur un vrai runner Windows** (pas d'accès à `windows-latest`
  depuis cette session) : à valider via un `workflow_dispatch` manuel avant
  de s'y fier pour une vraie release — c'est le jalon testable défini dans
  le brief de l'Epic.

## À faire, dans cet ordre

1. [`epic-5-web-core.md`](./epic-5-web-core.md) — Dashboard, Historique des
   parties, Détail d'une partie (dépend des Epics 2 et 3 pour avoir de la
   donnée réelle à afficher).
2. [`epic-6-web-analytics.md`](./epic-6-web-analytics.md) — Analytics Héros
   & Talents, Radar des Joueurs, Profil joueur + page publique SSR (dépend
   de l'Epic 5).

Chaque brief est indépendant dans sa rédaction, mais l'ordre ci-dessus est
la dépendance logique réelle : ne pas lancer l'Epic 5/6 avant d'avoir de la
vraie donnée en base (Epic 2 + 3).

Une fois un Epic terminé dans sa session, mettre à jour ce README (cocher
dans "Déjà fait") avant de lancer le suivant.
