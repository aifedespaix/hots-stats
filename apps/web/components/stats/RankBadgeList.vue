<script setup lang="ts">
/**
 * Generic top-N ranked list: medal badge, an icon or initials bubble, a
 * label (+ optional sublabel), and a right-aligned value (+ optional
 * sub-value). Backs the "Rôles favoris" / "Héros favoris" / best-worst
 * cartes lists on the matches "Dashboard" -- and, being data-only, is just
 * as usable for any other top-N ranking elsewhere (e.g. Diagnostic).
 */
export interface RankBadgeItem {
  id: string;
  label: string;
  sublabel?: string;
  value: string;
  valueSub?: string;
  icon?: string;
  avatarLabel?: string;
}

withDefaults(
  defineProps<{
    items: RankBadgeItem[];
    tone?: "default" | "success" | "danger";
    dense?: boolean;
    emptyText?: string;
  }>(),
  { tone: "default", dense: false, emptyText: "-" },
);

const medals = ["🥇", "🥈", "🥉"];
</script>

<template>
  <ol v-if="items.length > 0" class="space-y-1">
    <li
      v-for="(item, index) in items"
      :key="item.id"
      class="flex items-center gap-2 rounded-lg px-1.5 transition-colors hover:bg-background/60"
      :class="dense ? 'py-1' : 'py-1.5'"
    >
      <span class="w-4 shrink-0 text-center text-xs leading-none">{{ medals[index] ?? index + 1 }}</span>

      <span
        v-if="item.icon"
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-background"
        :class="{ 'text-success': tone === 'success', 'text-danger': tone === 'danger', 'text-muted': tone === 'default' }"
      >
        <UIcon :name="item.icon" class="h-3.5 w-3.5" />
      </span>
      <span
        v-else-if="item.avatarLabel"
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/15 text-[10px] font-semibold text-brand"
      >
        {{ item.avatarLabel }}
      </span>

      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-medium leading-tight">{{ item.label }}</span>
        <span v-if="item.sublabel" class="block truncate text-[11px] leading-tight text-muted">{{ item.sublabel }}</span>
      </span>

      <span class="shrink-0 text-right">
        <span
          class="block font-mono text-xs font-semibold leading-tight"
          :class="{
            'text-success': tone === 'success',
            'text-danger': tone === 'danger',
            'text-foreground': tone === 'default',
          }"
        >
          {{ item.value }}
        </span>
        <span v-if="item.valueSub" class="block text-[10px] leading-tight text-muted">{{ item.valueSub }}</span>
      </span>
    </li>
  </ol>
  <p v-else class="py-2 text-center text-xs text-muted">{{ emptyText }}</p>
</template>
