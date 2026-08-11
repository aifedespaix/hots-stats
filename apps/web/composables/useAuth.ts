export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  battletag: string | null;
  publicHandle: string | null;
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

export function googleLoginUrl(): string {
  const config = useRuntimeConfig();
  return `${config.public.apiBase}/auth/google`;
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
