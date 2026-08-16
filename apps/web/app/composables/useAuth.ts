import type { HeroStatsScope } from "@hots-stats/shared-types";

export interface AuthUser {
  id: string;
  // Only Google accounts have one -- Battle.net's OAuth never returns an
  // email (see apps/api/src/routes/auth.ts).
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  battletag: string | null;
  publicHandle: string | null;
  heroStatsScope: HeroStatsScope;
  // Gates access to admin-only tooling (currently: /admin/calibrate, see
  // middleware/admin.ts). Set via `bun run promote-admin`, never through the UI.
  role: "user" | "admin";
}

export interface AuthProviders {
  google: boolean;
  battlenet: boolean;
}

export function useAuthUser() {
  const config = useRuntimeConfig();
  const headers = import.meta.server ? useRequestHeaders(["cookie"]) : undefined;

  return useFetch<{ user: AuthUser | null }>("/auth/me", {
    baseURL: config.public.apiBase,
    credentials: "include",
    headers,
    key: "auth-user",
  });
}

// Which login buttons /login should show -- Battle.net is only enabled when
// the server has BATTLENET_CLIENT_ID/SECRET configured.
export function useAuthProviders() {
  const config = useRuntimeConfig();

  return useFetch<AuthProviders>("/auth/providers", {
    baseURL: config.public.apiBase,
    key: "auth-providers",
  });
}

export function googleLoginUrl(): string {
  const config = useRuntimeConfig();
  return `${config.public.apiBase}/auth/google`;
}

export function battlenetLoginUrl(): string {
  const config = useRuntimeConfig();
  return `${config.public.apiBase}/auth/battlenet`;
}

export async function logout(): Promise<void> {
  const config = useRuntimeConfig();
  await $fetch("/auth/logout", {
    method: "POST",
    baseURL: config.public.apiBase,
    credentials: "include",
  });
  // useAuthUser() is keyed "auth-user" and shared across pages/middleware;
  // without clearing it, navigating to /login re-reads the stale cached
  // user and bounces straight back to "/".
  clearNuxtData("auth-user");
}
