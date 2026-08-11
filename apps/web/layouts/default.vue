<script setup lang="ts">
const { data: authData } = await useAuthUser();
const route = useRoute();

const navItems = [
  { to: "/", label: "Dashboard", icon: "i-heroicons-squares-2x2", enabled: true },
  { to: "/matches", label: "Historique", icon: "i-heroicons-clock", enabled: true },
  { to: "/heroes", label: "Héros", icon: "i-heroicons-fire", enabled: false },
  { to: "/players", label: "Joueurs", icon: "i-heroicons-user-group", enabled: false },
];

async function handleLogout() {
  await logout();
  await navigateTo("/login");
}
</script>

<template>
  <div class="min-h-screen bg-background text-foreground font-body">
    <div class="flex min-h-screen">
      <aside class="flex w-56 flex-col border-r border-border bg-surface p-4">
        <NuxtLink to="/" class="mb-6 font-heading text-lg font-semibold">
          HotS Analytics
        </NuxtLink>

        <nav class="flex flex-1 flex-col gap-1">
          <component
            :is="item.enabled ? 'NuxtLink' : 'span'"
            v-for="item in navItems"
            :key="item.to"
            :to="item.enabled ? item.to : undefined"
            class="flex items-center gap-2 rounded-md px-3 py-2 text-sm"
            :class="[
              item.enabled
                ? route.path === item.to
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted hover:bg-background hover:text-foreground'
                : 'cursor-not-allowed text-muted/50',
            ]"
          >
            <UIcon :name="item.icon" class="h-4 w-4" />
            {{ item.label }}
            <span v-if="!item.enabled" class="ml-auto text-[10px] uppercase tracking-wide">Bientôt</span>
          </component>
        </nav>

        <div class="mt-6 space-y-3 border-t border-border pt-4">
          <UiThemeSwitcher />
          <template v-if="authData?.user">
            <NuxtLink
              to="/settings"
              class="flex items-center gap-2 text-sm text-muted hover:text-foreground"
            >
              <UIcon name="i-heroicons-cog-6-tooth" class="h-4 w-4" />
              {{ authData.user.displayName }}
            </NuxtLink>
            <button
              type="button"
              class="flex items-center gap-2 text-sm text-danger hover:opacity-80"
              @click="handleLogout"
            >
              <UIcon name="i-heroicons-arrow-right-on-rectangle" class="h-4 w-4" />
              Se déconnecter
            </button>
          </template>
        </div>
      </aside>

      <main class="flex-1 p-8">
        <slot />
      </main>
    </div>
  </div>
</template>
