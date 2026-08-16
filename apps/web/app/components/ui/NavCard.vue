<script setup lang="ts">
export type NavCardColor =
  | "brand"
  | "success"
  | "danger"
  | "info"
  | "accent"
  | "role-tank"
  | "role-bruiser"
  | "role-ranged"
  | "role-melee"
  | "role-healer"
  | "role-support";

const props = withDefaults(
  defineProps<{
    to: string;
    icon: string;
    title: string;
    description: string;
    color?: NavCardColor;
    chip?: { show: boolean; text?: string } | null;
  }>(),
  { color: "brand", chip: null },
);

const colorClass: Record<NavCardColor, { card: string; iconWrap: string }> = {
  brand: { card: "border-brand/20 hover:border-brand/40 hover:bg-brand/5", iconWrap: "bg-brand/15 text-brand" },
  success: { card: "border-success/20 hover:border-success/40 hover:bg-success/5", iconWrap: "bg-success/15 text-success" },
  danger: { card: "border-danger/20 hover:border-danger/40 hover:bg-danger/5", iconWrap: "bg-danger/15 text-danger" },
  info: { card: "border-info/20 hover:border-info/40 hover:bg-info/5", iconWrap: "bg-info/15 text-info" },
  accent: { card: "border-accent/20 hover:border-accent/40 hover:bg-accent/5", iconWrap: "bg-accent/15 text-accent" },
  "role-tank": { card: "border-role-tank/20 hover:border-role-tank/40 hover:bg-role-tank/5", iconWrap: "bg-role-tank/15 text-role-tank" },
  "role-bruiser": { card: "border-role-bruiser/20 hover:border-role-bruiser/40 hover:bg-role-bruiser/5", iconWrap: "bg-role-bruiser/15 text-role-bruiser" },
  "role-ranged": { card: "border-role-ranged/20 hover:border-role-ranged/40 hover:bg-role-ranged/5", iconWrap: "bg-role-ranged/15 text-role-ranged" },
  "role-melee": { card: "border-role-melee/20 hover:border-role-melee/40 hover:bg-role-melee/5", iconWrap: "bg-role-melee/15 text-role-melee" },
  "role-healer": { card: "border-role-healer/20 hover:border-role-healer/40 hover:bg-role-healer/5", iconWrap: "bg-role-healer/15 text-role-healer" },
  "role-support": { card: "border-role-support/20 hover:border-role-support/40 hover:bg-role-support/5", iconWrap: "bg-role-support/15 text-role-support" },
};

const classes = computed(() => colorClass[props.color]);
</script>

<template>
  <NuxtLink
    :to="to"
    class="group flex flex-col gap-3 rounded-lg border bg-surface p-4 transition-colors"
    :class="classes.card"
  >
    <div class="flex items-center justify-between">
      <UChip v-if="chip?.show" :text="chip.text" color="error" size="sm">
        <span class="flex h-10 w-10 items-center justify-center rounded-full" :class="classes.iconWrap">
          <UIcon :name="icon" class="h-5 w-5" />
        </span>
      </UChip>
      <span v-else class="flex h-10 w-10 items-center justify-center rounded-full" :class="classes.iconWrap">
        <UIcon :name="icon" class="h-5 w-5" />
      </span>
      <UIcon
        name="i-heroicons-arrow-right"
        class="h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
      />
    </div>
    <div>
      <p class="font-heading text-sm font-semibold text-foreground">{{ title }}</p>
      <p class="mt-1 text-xs leading-relaxed text-muted">{{ description }}</p>
    </div>
  </NuxtLink>
</template>
