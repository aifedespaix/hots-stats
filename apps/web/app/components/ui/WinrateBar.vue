<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    winrate: number;
    marker?: number;
    centered?: boolean;
    size?: "sm" | "md";
  }>(),
  { size: "md", centered: false, marker: undefined },
);

const tone = computed(() => winrateTone(props.winrate));
const toneBgClass = computed(() => (tone.value === "success" ? "bg-success" : "bg-danger"));

const segment = computed(() => {
  const pct = props.winrate * 100;
  if (props.centered) {
    const left = Math.min(50, pct);
    const width = Math.abs(pct - 50);
    return { left: `${left}%`, width: `${width}%` };
  }
  return { left: "0%", width: `${Math.min(100, Math.max(0, pct))}%` };
});

const heightClass = computed(() => (props.size === "sm" ? "h-1.5" : "h-2"));
</script>

<template>
  <div class="relative w-full" :class="heightClass">
    <div class="h-full w-full overflow-hidden rounded-full bg-background">
      <span
        class="absolute inset-y-0 rounded-full"
        :class="toneBgClass"
        :style="{ left: segment.left, width: segment.width }"
      />
      <span v-if="centered" class="absolute inset-y-0 w-px bg-border" style="left: 50%" />
    </div>
    <span
      v-if="marker !== undefined"
      class="absolute -top-0.5 h-[calc(100%+4px)] w-px -translate-x-1/2 bg-foreground/70"
      :style="{ left: `${Math.min(100, Math.max(0, Math.round(marker * 100)))}%` }"
    />
  </div>
</template>
