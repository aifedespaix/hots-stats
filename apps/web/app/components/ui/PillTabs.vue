<script setup lang="ts" generic="T extends string">
export interface PillTabOption<T extends string> {
  value: T;
  label: string;
  icon?: string;
}

withDefaults(
  defineProps<{
    modelValue: T;
    options: PillTabOption<T>[];
    shape?: "pill" | "rounded";
    iconOnly?: boolean;
  }>(),
  { shape: "pill", iconOnly: false },
);

defineEmits<{ (e: "update:modelValue", value: T): void }>();
</script>

<template>
  <div
    class="flex items-center gap-1 border border-border bg-surface p-1"
    :class="shape === 'pill' ? 'rounded-full' : 'rounded-md'"
  >
    <template v-if="iconOnly">
      <button
        v-for="option in options"
        :key="option.value"
        type="button"
        class="rounded p-1.5 text-muted transition-colors"
        :class="modelValue === option.value ? 'bg-brand/20 text-brand' : 'hover:text-foreground'"
        :title="option.label"
        :aria-pressed="modelValue === option.value"
        @click="$emit('update:modelValue', option.value)"
      >
        <UIcon v-if="option.icon" :name="option.icon" class="h-4 w-4" />
      </button>
    </template>
    <template v-else>
      <button
        v-for="option in options"
        :key="option.value"
        type="button"
        class="flex items-center gap-1.5 px-3 py-1 text-xs font-medium transition-colors"
        :class="[
          shape === 'pill' ? 'rounded-full' : 'rounded',
          modelValue === option.value ? 'bg-brand text-white' : 'text-muted hover:text-foreground',
        ]"
        :aria-pressed="modelValue === option.value"
        @click="$emit('update:modelValue', option.value)"
      >
        <UIcon v-if="option.icon" :name="option.icon" class="h-3.5 w-3.5" />
        {{ option.label }}
      </button>
    </template>
  </div>
</template>
