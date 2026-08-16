<script setup lang="ts">
withDefaults(
  defineProps<{
    modelValue: string;
    placeholder?: string;
    /** "sm" (défaut) = look actuel des listes. "lg" = pill large (maps/index). */
    size?: "sm" | "lg";
    fullWidth?: boolean;
  }>(),
  { placeholder: "Rechercher...", size: "sm", fullWidth: false },
);

defineEmits<{ (e: "update:modelValue", value: string): void }>();
</script>

<template>
  <UInput
    :model-value="modelValue"
    :placeholder="placeholder"
    icon="i-lucide-search"
    :size="size === 'lg' ? 'xl' : 'md'"
    :class="fullWidth ? 'w-full' : 'max-w-sm'"
    :ui="size === 'lg' ? { base: 'h-14 w-full rounded-full px-5 text-base', leadingIcon: 'size-5' } : undefined"
    @update:model-value="$emit('update:modelValue', $event as string)"
  />
</template>
