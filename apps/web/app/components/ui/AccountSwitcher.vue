<script setup lang="ts">
// Header control for the multi-account selection: which linked BattleTag(s)
// the dashboard is computed from. See useAccountsStore and useApiFetch, which
// turns this into the `accounts` query parameter on every stats call.
const { data: authData } = await useAuthUser();
const accountsStore = useAccountsStore();

const available = computed(() => (authData.value?.user?.accounts ?? []).map((account) => account.battletag));
const primary = computed(
  () => authData.value?.user?.primaryBattletag ?? authData.value?.user?.battletag ?? null,
);
const effective = computed(() => accountsStore.effectiveAccounts(available.value, primary.value));

const label = computed(() => {
  if (effective.value.length === 0) return "Aucun compte";
  if (effective.value.length === available.value.length) return "Tous les comptes";
  if (effective.value.length === 1) return effective.value[0]!;
  return effective.value[0] + " +" + (effective.value.length - 1);
});

const items = computed(() => [
  [
    {
      label: "Tous les comptes",
      type: "checkbox" as const,
      checked: effective.value.length === available.value.length,
      onSelect: () => accountsStore.setSelection(available.value),
    },
  ],
  available.value.map((tag) => ({
    label: tag,
    type: "checkbox" as const,
    checked: effective.value.includes(tag),
    suffix: tag === primary.value ? "(principal)" : undefined,
    onSelect: () => accountsStore.toggle(tag, available.value, primary.value),
  })),
]);

// Reka's `UDropdownMenu` is modal by default, and a modal menu locks the body
// with `overflow: hidden` while it is open. Because `html` carries
// `overflow-x: hidden` (see globals.css), that turns <body> into its own scroll
// container, detaching the `sticky` site header from the viewport: scrolling
// while the menu is open pushes the header off-screen. A plain account picker
// never needs a modal focus trap, so opting out keeps the header pinned.
//
// Same stale-hydration issue as UiGameModeFilter: the persisted selection is
// restored while Vue is still hydrating this subtree, so the trigger label can
// keep a server-rendered value forever unless the subtree is re-rendered once
// mounted.
const renderKey = ref(0);
onMounted(() => {
  renderKey.value++;
});
</script>

<template>
  <div v-if="available.length > 1" :key="renderKey" class="flex items-center">
    <UDropdownMenu :items="items" :modal="false">
      <UButton
        size="xs"
        variant="soft"
        color="neutral"
        icon="i-heroicons-user-circle"
        :label="label"
        class="max-w-[11rem]"
        :ui="{ label: 'truncate' }"
      />
    </UDropdownMenu>
  </div>
</template>
