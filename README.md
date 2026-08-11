# HotS Analytics

Application d'analyse de statistiques Heroes of the Storm. Monorepo Bun :
Nuxt (SSR) + Hono (API) + PostgreSQL/Drizzle, alimenté par un daemon Windows
qui parse les `.StormReplay` locaux et POST les stats extraites.

## Stack

- **Runtime & monorepo :** Bun (workspaces)
- **Frontend :** Nuxt 3 + Nuxt UI (`apps/web`)
- **API :** Hono sur Bun (`apps/api`)
- **DB :** PostgreSQL + Drizzle ORM (`packages/db`)
- **Contrats partagés :** `packages/shared-types`
- **Daemon local (Windows) :** Python + `watchdog` + `heroprotocol` (`daemon-python`)

Voir `DEPLOYMENT.md` pour le déploiement en prod (Raspberry Pi + Dokploy).

## Démarrage local

Prérequis : [Bun](https://bun.sh) >= 1.3, Docker (pour Postgres).

```bash
bun install

cp .env.example apps/api/.env.example.local   # ou éditer directement apps/api/.env.example -> .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

bun run docker:dev:up      # démarre Postgres en local
bun run --filter './packages/db' generate
bun run --filter './packages/db' migrate

bun run dev:api            # http://localhost:3001
bun run dev:web            # http://localhost:3000
```

`http://localhost:3000` doit afficher `API status: ok`.

## Structure du monorepo

```
apps/web            Nuxt (SSR)
apps/api            Hono (API)
packages/db          Schéma Drizzle + client Postgres
packages/shared-types Types/contrats partagés (payload replay, stats)
packages/config       tsconfig/eslint partagés
daemon-python         Client Windows (parsing replays + envoi API)
.github/workflows     CI + build du daemon .exe
```

## Scripts utiles

| Commande | Effet |
|---|---|
| `bun run dev` | Lance web + api en parallèle |
| `bun run db:generate` | Génère une migration Drizzle depuis le schéma |
| `bun run db:migrate` | Applique les migrations |
| `bun run db:studio` | Ouvre Drizzle Studio |
| `bun run docker:dev:up` / `docker:dev:down` | Postgres local via Docker |
