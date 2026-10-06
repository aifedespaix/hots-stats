# Daemon Onboarding Wizard, Token Fallback Page & Window Layout — Design (C3)

Follows C1 (browser-based authorization, `2026-09-18-daemon-browser-auth-design.md`) and
C2 (settings-window UX redesign, `2026-09-18-daemon-ux-redesign-design.md`). All user-facing
daemon/web copy is French.

## Goal

Give the daemon a polished first-run experience (branded welcome + 3-step wizard), a reliable
manual fallback when the browser handshake fails, and a tidier main window (tab order, sync panel,
sticky tabs/footer).

## Scope

1. Welcome/onboarding wizard in the daemon (`daemon-python`).
2. Dedicated web page `/daemon/token` for manual token retrieval (`apps/web`).
3. Main-window changes: tab order, Update merged into Config, responsive sync recap, collapsible
   activity panel, fixed tabs + footer with scroll in between, reduced top margin.

Out of scope: any API change, any change to the PKCE flow (`auth_flow.py`), the `/daemon/authorize`
page, parser/ingestion/versioning.

## 1. Onboarding wizard (daemon)

Implemented as a view inside the existing `_SettingsWindow` root (one Tk window). The view shown in
place of the tab notebook is chosen at startup and whenever the token becomes invalid (Option A:
shown whenever there is no valid token, not only on first launch).

**Common chrome:** logo, "HotS Analytics" name, version, and a stepper
`① Connexion — ② Stockage — ③ C'est prêt`.

**Startup:** a ~1 s cosmetic progress bar on first run (no token to verify yet); the reconnect case
already ran its token check before the wizard shows. Then step ①. A signed-out startup opens the
connect window (with `require_login`) instead of exiting.

**① Connexion**
- Primary button "Se connecter via le navigateur" runs `auth_flow.request_authorization` in a
  worker thread (results handed back via `_after_if_open`).
- 3-line guidance: browser opens → sign in and authorize → come back, it is automatic.
- While waiting: spinner on the button and an "Annuler" link (sets the existing `_auth_cancel`).
- On failure: the French error from `AuthorizationResult.error` is shown under the button, plus a
  link "Ça ne marche pas ? Récupérer le token manuellement".
- Manual fallback sub-view: button "Ouvrir la page des tokens" (opens `<web>/daemon/token`), a paste
  field for the token, and "Valider" which verifies the token with an API call before saving it.
- "Continuer" is enabled once the connection is validated.

**② Stockage et démarrage**
- Replays folder auto-detected (reuses `accounts_discovery`), accounts summary, "Changer" button.
- Checkbox "Lancer avec Windows" with a one-line explanation (reuses `autostart`).
- "Retour" / "Continuer".

**③ C'est prêt**
- 3-line recap (account connected, folder watched, autostart on/off) and "Accéder à l'app", which
  starts the first sync. On a first run the setup window closes, the daemon starts, and `app.py`
  reopens the full settings window (`TrayController.open_settings()`).

**Invalid token later:** only step ① is shown (②/③ already done). Reconnecting closes the window,
restarts the watcher with the new token and reopens the full window.

**Shared fields:** Stockage and Démarrage widgets/vars are the same ones used in Config (see §3),
built by shared builder functions so the wizard and Config use the same autosave path
(`_schedule_autosave`). Config keeps both sections so they stay editable after install.

## 2. Web page `/daemon/token`

New `apps/web/app/pages/daemon/token.vue` (alongside `authorize.vue`), minimal layout without the
dashboard navigation. Requires a session; unauthenticated users are redirected to `/login` by the
existing `auth` middleware (login has no return path, so the wizard tells them to reopen the page
from the daemon after signing in).

- One card with a large "Générer mon token" button → `POST /tokens` (secret returned once).
- On success the token is shown and **copied to the clipboard automatically**; a banner says
  "Copié ! Colle-le maintenant dans la fenêtre du daemon" with a "Copier à nouveau" button while the
  page stays open. If clipboard access is denied, the banner falls back to "Copie-le ci-dessous".
- Existing tokens listed (`GET /tokens`) with "Supprimer" (`DELETE /tokens/:id`) and
  "Tout supprimer sauf celui-ci".
- No API change; reuses `/tokens`. A small composable may wrap the calls.

## 3. Main window

- **Tabs:** Synchronisation (default), Draft Live, Config. The Update tab is removed.
- **Config sections:** Mises à jour (moved from the Update tab; built only when `updater.IS_FROZEN`,
  as today), Connexion, Stockage, Démarrage. Connexion has a « Se déconnecter » button: local
  sign-out that stops syncing, blanks the token and keeps the other settings (the token stays in
  the website list).
- **Footer:** Debug / Dossier de données / Ouvrir le site are icon-only ghost buttons with hover
  tooltips; « 🗕 Réduire » is solid primary; « Fermer » is ghost danger.
- **Layout:** top margin above the tab strip reduced (outer padding 24 → ~8 px at the top). The tab
  strip and footer buttons are fixed; only each tab's content scrolls (`ScrollPage` between them).
- **Sync recap panel:** stat cards reflow in a grid by available width; the progress bar is
  constrained to the container width (`fill="x"`, no fixed width) with percentage and "x / y"
  aligned; a clearer "tout est à jour" state.
- **Activity panel:** the table and pause button move into a `CollapsibleCard` titled
  "Activité en cours", with the pause button in the card header.

## Testing

- pytest: view selection (valid vs invalid/missing token), tab order and absence of the Update tab,
  Update section inside Config when frozen, wizard step transitions and the failure → manual
  fallback path (auth and token validation mocked).
- Web: vitest for the `/daemon/token` composable logic if one is added.
- Manual: run `python -m src.main` and `bun run dev:web` to check the wizard, window resize
  (progress bar never overflows), and the fixed tabs/footer.
- CI gates unchanged: `bun run typecheck`, `bun run build`, daemon `pytest`.
