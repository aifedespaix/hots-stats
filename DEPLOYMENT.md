# Déploiement — Raspberry Pi + Dokploy

HotS Analytics est pensé pour tourner en 100% self-hosted sur un Raspberry Pi
(arm64) piloté par [Dokploy](https://dokploy.com/). Le backend (API + DB) et
le frontend (Nuxt) sont déployés comme **deux applications Dokploy séparées**,
chacune à partir de son propre fichier `docker-compose.*.yml` à la racine du
repo.

```
docker-compose.backend.yml   -> App Dokploy "hots-stats-backend"  (api + postgres)
docker-compose.frontend.yml  -> App Dokploy "hots-stats-frontend" (web)
```

Les deux apps communiquent en HTTP(S) via leurs domaines publics respectifs
(pas de réseau Docker partagé entre deux projets Dokploy distincts) — le
frontend appelle l'API via son URL publique, configurée au build via
`NUXT_PUBLIC_API_BASE`.

## Prérequis

- Raspberry Pi (4/5, arm64) avec Docker installé et [Dokploy](https://docs.dokploy.com/docs/core/installation) déjà provisionné.
- Un nom de domaine (ou sous-domaines) pointant vers l'IP du Pi, ex :
  - `app.mondomaine.fr` -> frontend
  - `api.mondomaine.fr` -> backend
  (En local sans domaine, Dokploy peut aussi exposer via IP:port — voir sa doc "Domains".)
- Des identifiants OAuth Google (Google Cloud Console -> Credentials -> OAuth Client ID, type "Web application"), avec comme Authorized redirect URI : `https://api.mondomaine.fr/auth/google/callback`.

Les images Docker utilisées (`oven/bun:1-slim`, `postgres:17-alpine`) sont
multi-arch et tournent nativement en arm64, sans émulation.

## 1. Déployer le backend (API + Postgres)

1. Dans Dokploy, créer un nouveau projet -> **Application** -> type **Docker Compose**.
2. Pointer sur le repo Git `hots-stats`, branche à déployer (ex : `main`).
3. Renseigner le chemin du compose : `docker-compose.backend.yml`.
4. Onglet **Environment**, ajouter les variables (voir `.env.example`) :

   | Variable | Exemple |
   |---|---|
   | `POSTGRES_USER` | `hots_stats` |
   | `POSTGRES_PASSWORD` | (générer un mot de passe fort) |
   | `POSTGRES_DB` | `hots_stats` |
   | `WEB_ORIGIN` | `https://app.mondomaine.fr` |
   | `API_PUBLIC_URL` | `https://api.mondomaine.fr` |
   | `COOKIE_DOMAIN` | `.mondomaine.fr` |
   | `GOOGLE_CLIENT_ID` | (Google Cloud Console) |
   | `GOOGLE_CLIENT_SECRET` | (Google Cloud Console) |
   | `SESSION_SECRET` | `openssl rand -hex 32` |
   | `CLAUDE_INTERNAL_SECRET` | `openssl rand -hex 32` |

   `DATABASE_URL` n'est **pas** à définir manuellement : le compose la
   construit automatiquement à partir des variables `POSTGRES_*` (service
   `postgres` résolu par son nom DNS interne au réseau du compose).

   `COOKIE_DOMAIN` est nécessaire dès que `WEB_ORIGIN` et `API_PUBLIC_URL`
   sont sur des sous-domaines différents (cas normal ici) : sans elle, le
   cookie de session n'est visible que par l'API elle-même, et le rendu
   SSR du frontend (qui vérifie la session en relayant l'en-tête `Cookie`
   reçu du navigateur) ne le voit jamais — l'utilisateur reste bloqué sur
   `/login` après une connexion Google pourtant réussie. Utiliser le domaine
   parent commun avec un point en préfixe, ex : `.mondomaine.fr`.

5. Onglet **Domains** : ajouter `api.mondomaine.fr` -> port conteneur `3001`,
   activer HTTPS (Let's Encrypt géré par Dokploy).
6. Déployer. Dokploy build les images (`apps/api/Dockerfile`) puis démarre
   `postgres` et `api`.
7. **Les migrations s'appliquent automatiquement** au démarrage du conteneur
   `api` (`docker-entrypoint.sh` lance `bun run src/migrate.ts` avant de
   démarrer le serveur) — aucune action manuelle n'est nécessaire, ni au
   premier déploiement ni après un changement de schéma. Les fichiers SQL de
   migration restent générés en local avec `bun run db:generate` puis
   **committés** dans `packages/db/drizzle/` ; le build de l'image `api` les
   embarque. Si une migration échoue, le conteneur s'arrête (voir les logs
   Dokploy du service `api`) plutôt que de démarrer avec un schéma
   incohérent.

8. Vérifier : `https://api.mondomaine.fr/health` doit renvoyer `{"status":"ok"}`
   et `https://api.mondomaine.fr/health/db` doit renvoyer `{"status":"ok","db":"reachable"}`.

## 2. Déployer le frontend (Nuxt)

1. Nouveau projet Dokploy -> **Application** -> **Docker Compose**.
2. Même repo, chemin du compose : `docker-compose.frontend.yml`.
3. Onglet **Environment** :

   | Variable | Exemple |
   |---|---|
   | `NUXT_PUBLIC_API_BASE` | `https://api.mondomaine.fr` |

   Cette variable est injectée **au build** (elle est publique et embarquée
   dans le bundle client) : tout changement nécessite un redeploy, pas juste
   un restart.

4. Onglet **Domains** : ajouter `app.mondomaine.fr` -> port conteneur `3000`,
   activer HTTPS.
5. Déployer.
6. Vérifier que `https://app.mondomaine.fr` charge et que la page affiche
   `API status: ok` (preuve que le frontend joint bien le backend).

## Mises à jour

- Push sur la branche déployée -> si le "auto deploy on push" est activé côté
  Dokploy (webhook GitHub), les deux apps se redéploient automatiquement.
  Sinon, bouton **Redeploy** sur chacune des deux apps.
- Toujours redéployer le **backend** en premier si la mise à jour touche le
  schéma DB ou l'API — les migrations s'appliquent automatiquement au
  démarrage du conteneur `api` (voir étape 7 ci-dessus) — avant de
  redéployer le **frontend**.

## Sauvegardes

Les données persistent dans le volume Docker `hots_stats_pgdata` (déclaré
dans `docker-compose.backend.yml`). Sur le Pi :

```bash
docker exec $(docker ps -qf "name=hots-stats-backend.*postgres") \
  pg_dump -U $POSTGRES_USER $POSTGRES_DB > backup-$(date +%F).sql
```

À planifier en cron régulièrement, et à copier hors du Pi (le SD/SSD d'un Pi
n'est pas un stockage de confiance à long terme).

## Notes spécifiques Raspberry Pi

- Le Pi a des ressources limitées : évite de lancer `docker compose build`
  pour le frontend et le backend simultanément si tu es sur un Pi 4 8 Go ou
  moins (le build Nuxt est le plus gourmand en RAM).
- Si le build échoue avec un OOM, active un fichier swap (`dphys-swapfile`)
  ou augmente-le temporairement pendant les déploiements.
- Le daemon Windows (`daemon-python`) n'a rien à voir avec le Pi : il tourne
  sur les PC des joueurs et POST simplement vers `https://api.mondomaine.fr`.

## Dépannage

- **CORS bloqué côté navigateur** : vérifier que `WEB_ORIGIN` (backend)
  correspond exactement au domaine du frontend (schéma + host, sans slash
  final).
- **`/health/db` échoue** : vérifier que `postgres` est bien `healthy`
  (Dokploy -> logs du service) et que `POSTGRES_*` correspondent des deux
  côtés (ils sont assemblés dans `DATABASE_URL` au sein du même compose).
- **Le frontend affiche `API status: unreachable`** : `NUXT_PUBLIC_API_BASE`
  a été changé sans rebuild, ou le domaine `api.*` n'a pas encore de
  certificat valide.
