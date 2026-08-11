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

## À faire, dans cet ordre

1. [`epic-3-daemon-ingestion.md`](./epic-3-daemon-ingestion.md) — Daemon
   Python & pipeline d'ingestion (upsert des replays).
2. [`epic-4-daemon-cicd.md`](./epic-4-daemon-cicd.md) — Build CI/CD du
   daemon en `.exe` Windows (dépend de l'Epic 3).
3. [`epic-5-web-core.md`](./epic-5-web-core.md) — Dashboard, Historique des
   parties, Détail d'une partie (dépend des Epics 2 et 3 pour avoir de la
   donnée réelle à afficher).
4. [`epic-6-web-analytics.md`](./epic-6-web-analytics.md) — Analytics Héros
   & Talents, Radar des Joueurs, Profil joueur + page publique SSR (dépend
   de l'Epic 5).

Chaque brief est indépendant dans sa rédaction, mais l'ordre ci-dessus est
la dépendance logique réelle : ne pas lancer l'Epic 5/6 avant d'avoir de la
vraie donnée en base (Epic 2 + 3), et ne pas lancer l'Epic 4 avant que le
daemon de l'Epic 3 existe.

Une fois un Epic terminé dans sa session, mettre à jour ce README (cocher
dans "Déjà fait") avant de lancer le suivant.
