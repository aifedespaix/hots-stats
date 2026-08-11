<script setup lang="ts">
const { data: authData } = await useAuthUser();
const route = useRoute();

const sidebarExpanded = ref(false);

interface NavItem {
  to: string;
  label: string;
  icon: string;
  featured?: boolean;
}

// Logical order for the desktop sidebar (home first, settings last).
const navItems: NavItem[] = [
  { to: "/", label: "Dashboard", icon: "i-heroicons-squares-2x2", featured: true },
  { to: "/matches", label: "Historique", icon: "i-heroicons-clock" },
  { to: "/heroes", label: "Héros", icon: "i-heroicons-fire" },
  { to: "/players", label: "Joueurs", icon: "i-heroicons-user-group" },
  { to: "/settings", label: "Paramètres", icon: "i-heroicons-cog-6-tooth" },
];

// The mobile app bar renders the featured item as a centered FAB, so it
// needs the featured item moved to the middle of the row instead.
const mobileNavItems = computed(() => {
  const featuredIndex = navItems.findIndex((item) => item.featured);
  if (featuredIndex === -1) return navItems;
  const featured = navItems[featuredIndex]!;
  const rest = navItems.filter((_, index) => index !== featuredIndex);
  const middle = Math.ceil(rest.length / 2);
  return [...rest.slice(0, middle), featured, ...rest.slice(middle)];
});

function isActive(to: string) {
  if (to === "/") return route.path === "/";
  return route.path === to || route.path.startsWith(`${to}/`);
}

async function handleLogout() {
  await logout();
  await navigateTo("/login");
}
</script>

<template>
  <div class="flex min-h-screen flex-col bg-background text-foreground font-body">
    <header
      class="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-surface/95 px-4 py-3 backdrop-blur sm:px-6"
    >
      <NuxtLink to="/" class="flex items-center gap-2.5">
        <img src="/favicon.svg" alt="" width="32" height="32" class="h-8 w-8">
        <span class="font-heading text-lg font-semibold tracking-tight">HotS Analytics</span>
      </NuxtLink>

      <div class="flex items-center gap-2 sm:gap-3">
        <UiThemeSwitcher />
        <template v-if="authData?.user">
          <NuxtLink
            to="/settings"
            class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors"
            :class="isActive('/settings') ? 'text-brand' : 'text-muted hover:text-foreground'"
          >
            <img
              v-if="authData.user.avatarUrl"
              :src="authData.user.avatarUrl"
              :alt="authData.user.displayName"
              class="h-6 w-6 rounded-full"
            >
            <UIcon v-else name="i-heroicons-user-circle" class="h-5 w-5" />
            <span class="hidden sm:inline">{{ authData.user.displayName }}</span>
          </NuxtLink>
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted transition-colors hover:text-danger"
            title="Se déconnecter"
            @click="handleLogout"
          >
            <UIcon name="i-heroicons-arrow-right-on-rectangle" class="h-5 w-5" />
            <span class="hidden sm:inline">Se déconnecter</span>
          </button>
        </template>
      </div>
    </header>

    <div class="flex flex-1">
      <aside
        class="hidden shrink-0 flex-col justify-between border-r border-border bg-surface py-4 transition-[width] duration-200 md:flex"
        :class="sidebarExpanded ? 'w-64 px-3' : 'w-[76px] px-2 lg:w-64 lg:px-3'"
      >
        <nav class="flex flex-col gap-1">
          <NuxtLink
            v-for="item in navItems"
            :key="item.to"
            :to="item.to"
            :aria-current="isActive(item.to) ? 'page' : undefined"
            class="flex items-center gap-3 rounded-md py-2.5 text-sm transition-colors"
            :class="[
              sidebarExpanded ? 'justify-start px-3' : 'justify-center px-1 lg:justify-start lg:px-3',
              item.featured
                ? isActive(item.to)
                  ? 'bg-brand font-semibold text-white shadow-md shadow-brand/30'
                  : 'bg-brand/15 font-semibold text-brand hover:bg-brand/25'
                : isActive(item.to)
                  ? 'bg-brand/15 text-brand'
                  : 'text-muted hover:bg-background hover:text-foreground',
            ]"
          >
            <UIcon :name="item.icon" class="h-5 w-5 shrink-0" />
            <span :class="sidebarExpanded ? 'inline' : 'hidden lg:inline'">{{ item.label }}</span>
          </NuxtLink>
        </nav>

        <button
          type="button"
          class="hidden items-center justify-center gap-2 rounded-md border border-border py-2 text-xs text-muted transition-colors hover:text-foreground md:flex lg:hidden"
          :aria-label="sidebarExpanded ? 'Réduire le menu' : 'Déplier le menu'"
          @click="sidebarExpanded = !sidebarExpanded"
        >
          <UIcon
            :name="sidebarExpanded ? 'i-heroicons-chevron-double-left' : 'i-heroicons-chevron-double-right'"
            class="h-4 w-4"
          />
          <span v-if="sidebarExpanded">Réduire</span>
        </button>
      </aside>

      <main class="flex-1 p-4 pb-24 sm:p-6 md:pb-6 lg:p-8">
        <slot />
      </main>
    </div>

    <nav
      class="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-border bg-surface/95 backdrop-blur md:hidden"
      style="padding-bottom: env(safe-area-inset-bottom)"
    >
      <NuxtLink
        v-for="item in mobileNavItems"
        :key="item.to"
        :to="item.to"
        :aria-current="isActive(item.to) ? 'page' : undefined"
        class="flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] transition-colors"
        :class="item.featured ? 'text-foreground' : isActive(item.to) ? 'text-brand' : 'text-muted'"
      >
        <span
          v-if="item.featured"
          class="-mt-7 flex h-12 w-12 items-center justify-center rounded-full bg-brand text-white shadow-lg shadow-brand/40 ring-4 ring-background transition-transform"
          :class="isActive(item.to) ? 'scale-105' : ''"
        >
          <UIcon :name="item.icon" class="h-6 w-6" />
        </span>
        <UIcon v-else :name="item.icon" class="h-5 w-5" />
        <span :class="item.featured ? 'font-medium' : ''">{{ item.label }}</span>
      </NuxtLink>
    </nav>
  </div>
</template>
