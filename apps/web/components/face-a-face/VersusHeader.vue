<script setup lang="ts">
interface VersusPlayer {
  displayName: string;
  avatarUrl: string | null;
  battletag: string | null;
}

defineProps<{ me: VersusPlayer; friend: VersusPlayer }>();
</script>

<template>
  <div class="relative overflow-hidden rounded-lg border border-border bg-surface">
    <div class="flex">
      <div class="flex flex-1 flex-col items-center gap-2 bg-brand/10 px-3 py-8 text-center sm:py-10">
        <img
          v-if="me.avatarUrl"
          :src="me.avatarUrl"
          :alt="me.displayName"
          class="h-16 w-16 rounded-full ring-4 ring-brand sm:h-20 sm:w-20"
        >
        <UIcon v-else name="i-heroicons-user-circle" class="h-16 w-16 text-brand sm:h-20 sm:w-20" />
        <p class="mt-1 max-w-full truncate font-heading text-lg font-semibold text-brand sm:text-xl">
          {{ me.displayName }}
        </p>
        <p v-if="me.battletag" class="max-w-full truncate font-mono text-xs text-muted">{{ me.battletag }}</p>
      </div>

      <div class="flex flex-1 flex-col items-center gap-2 bg-accent/10 px-3 py-8 text-center sm:py-10">
        <img
          v-if="friend.avatarUrl"
          :src="friend.avatarUrl"
          :alt="friend.displayName"
          class="h-16 w-16 rounded-full ring-4 ring-accent sm:h-20 sm:w-20"
        >
        <UIcon v-else name="i-heroicons-user-circle" class="h-16 w-16 text-accent sm:h-20 sm:w-20" />
        <p class="mt-1 max-w-full truncate font-heading text-lg font-semibold text-accent sm:text-xl">
          {{ friend.displayName }}
        </p>
        <p v-if="friend.battletag" class="max-w-full truncate font-mono text-xs text-muted">{{ friend.battletag }}</p>
      </div>
    </div>

    <div
      class="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-4 border-background bg-foreground font-heading text-sm font-extrabold text-background shadow-lg sm:h-16 sm:w-16 sm:text-base"
    >
      VS
    </div>
  </div>
</template>
