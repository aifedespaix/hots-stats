<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    heroId: string;
    name: string;
    role?: string | null;
    /** Pixel size (both width and height). */
    size?: number;
    shape?: "circle" | "square";
    /** Colored ring by role -- reserved for higher-emphasis spots (Hero ID Card, Versus) so it doesn't add noise to dense lists. */
    ring?: boolean;
  }>(),
  {
    role: null,
    size: 28,
    shape: "circle",
    ring: false,
  },
);

// Reset when the underlying image changes so a previously-broken hero
// doesn't stay stuck on the fallback if the same component instance gets
// reused for a different heroId (e.g. a v-for whose list is patched
// in-place rather than fully re-keyed).
const broken = ref(false);
watch(() => props.heroId, () => (broken.value = false));

const src = computed(() => `/images/heroes/${props.shape === "circle" ? "circular" : "square"}/${props.heroId}.png`);
const colors = computed(() => heroRoleColorClasses(props.role));
const shapeClass = computed(() => (props.shape === "circle" ? "rounded-full" : "rounded-md"));
</script>

<template>
  <img
    v-if="!broken"
    :src="src"
    :alt="name"
    loading="lazy"
    decoding="async"
    :width="size"
    :height="size"
    class="shrink-0 object-cover"
    :class="[shapeClass, ring ? `ring-2 ${colors.ring}` : '']"
    :style="{ width: `${size}px`, height: `${size}px` }"
    @error="broken = true"
  >
  <span
    v-else
    class="inline-flex shrink-0 items-center justify-center font-heading font-semibold"
    :class="[shapeClass, colors.tint, colors.text, ring ? `ring-2 ${colors.ring}` : '']"
    :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.max(9, size * 0.36)}px` }"
  >
    {{ initials(name) }}
  </span>
</template>
