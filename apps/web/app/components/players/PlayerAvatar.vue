<script setup lang="ts">
/** Player avatar with fallback icon, calqué sur HeroesHeroAvatar. */
const props = withDefaults(
  defineProps<{
    avatarUrl: string | null;
    displayName: string;
    /** "md" = h-16 w-16 (u/[handle]). "lg" = h-16 w-16 sm:h-20 sm:w-20 (VersusHeader). */
    size?: "md" | "lg";
    /** "neutral" (défaut) = bordure fine, icône muted. "brand"/"accent" = anneau coloré,
     * icône teintée -- pour un contexte à plus fort accent visuel (Versus). */
    tone?: "brand" | "accent" | "neutral";
  }>(),
  { size: "md", tone: "neutral" },
);

const sizeClass: Record<"md" | "lg", string> = {
  md: "h-16 w-16",
  lg: "h-16 w-16 sm:h-20 sm:w-20",
};

const toneClass: Record<"brand" | "accent" | "neutral", { frame: string; icon: string }> = {
  brand: { frame: "ring-4 ring-brand", icon: "text-brand" },
  accent: { frame: "ring-4 ring-accent", icon: "text-accent" },
  neutral: { frame: "border border-border", icon: "text-muted" },
};

const shapeClass = computed(() => [sizeClass[props.size], "shrink-0 rounded-full object-cover", toneClass[props.tone].frame]);
</script>

<template>
  <img v-if="avatarUrl" :src="avatarUrl" :alt="displayName" :class="shapeClass">
  <UIcon v-else name="i-heroicons-user-circle" class="shrink-0" :class="[sizeClass[size], toneClass[tone].icon]" />
</template>
