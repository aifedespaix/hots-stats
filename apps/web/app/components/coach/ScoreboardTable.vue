<script setup lang="ts">
import type { ScoreboardRow, TopPerformerBadge } from "~/types/coach";

const props = defineProps<{
  rows: ScoreboardRow[];
  badges: Map<string, TopPerformerBadge[]>;
  sortKey: string;
  sortDir: "asc" | "desc";
}>();

const emit = defineEmits<{ (e: "sort", key: string): void; (e: "select-player", battletag: string): void }>();

// The "raw box score" columns match Blizzard's own end-of-game scoreboard;
// the three tinted ones (KP%, Dégâts/Mort, Part XP) are the added ratio
// layer -- self-healing was dropped from the default view (low, rarely
// comparable signal across heroes) to keep the table from ballooning past
// what "épuré" allows once ratios are added. See the Tab 1 critique for the
// reasoning.
const columns = [
  { key: "heroName", label: "Héros", sortable: true },
  { key: "battletag", label: "Joueur", sortable: true },
  { key: "kills", label: "K", numeric: true, sortable: true },
  { key: "assists", label: "A", numeric: true, sortable: true },
  { key: "deaths", label: "D", numeric: true, sortable: true },
  { key: "killParticipation", label: "KP%", numeric: true, sortable: true },
  { key: "damagePerDeath", label: "Dégâts/Mort", numeric: true, sortable: true },
  { key: "heroDamage", label: "Dégâts héros", numeric: true, sortable: true },
  { key: "siegeDamage", label: "Dégâts siège", numeric: true, sortable: true },
  { key: "healing", label: "Soin", numeric: true, sortable: true },
  { key: "xpShare", label: "Part XP", numeric: true, sortable: true },
  { key: "damageTaken", label: "Dégâts subis", numeric: true, sortable: true },
];

function rowClass(row: Record<string, unknown>): string {
  const r = row as unknown as ScoreboardRow;
  const teamClass = r.isAlly ? "bg-info/10 hover:bg-info/15" : "bg-danger/10 hover:bg-danger/15";
  return r.isMe ? `${teamClass} ring-1 ring-inset ring-brand` : teamClass;
}

function badgesFor(row: Record<string, unknown>): TopPerformerBadge[] {
  return props.badges.get((row as unknown as ScoreboardRow).id) ?? [];
}

function onRowClick(row: Record<string, unknown>) {
  emit("select-player", (row as unknown as ScoreboardRow).battletag);
}
</script>

<template>
  <UiDataTable
    :columns="columns"
    :rows="rows"
    :sort-key="sortKey"
    :sort-dir="sortDir"
    :row-class="rowClass"
    clickable
    mobile-primary-key="heroName"
    mobile-secondary-key="battletag"
    mobile-badge-key="killParticipation"
    @sort="emit('sort', $event)"
    @row-click="onRowClick"
  >
    <template #header-killParticipation><span class="text-brand">KP%</span></template>
    <template #header-damagePerDeath><span class="text-brand">Dégâts/Mort</span></template>
    <template #header-xpShare><span class="text-brand">Part XP</span></template>

    <template #cell-heroName="{ row }">
      <span class="inline-flex items-center gap-1.5">
        <span
          class="h-1.5 w-1.5 shrink-0 rounded-full"
          :style="{ backgroundColor: heroRoleColor((row as unknown as ScoreboardRow).heroRole) }"
        />
        <span class="font-medium">{{ row.heroName }}</span>
      </span>
      <span class="ml-3 text-xs text-muted">{{ formatHeroRole((row as unknown as ScoreboardRow).heroRole) }}</span>
    </template>

    <template #cell-battletag="{ row }">
      <div class="flex flex-wrap items-center gap-1.5">
        <NuxtLink
          v-if="!(row as unknown as ScoreboardRow).isMe"
          :to="`/players/${encodeURIComponent(row.battletag as string)}`"
          class="font-mono underline-offset-2 hover:underline"
          @click.stop
        >
          {{ row.battletag }}
        </NuxtLink>
        <span v-else class="font-mono">{{ row.battletag }}</span>
        <PlayersAnnotationBadges :battletag="row.battletag as string" />
      </div>
      <div v-if="badgesFor(row).length > 0" class="mt-1 flex flex-wrap gap-1">
        <UBadge
          v-for="badge in badgesFor(row)"
          :key="badge.category"
          color="primary"
          variant="subtle"
          size="sm"
          :icon="badge.icon"
        >
          {{ badge.label }}
        </UBadge>
      </div>
    </template>

    <template #cell-killParticipation="{ row }">
      <span class="font-semibold text-brand">{{ formatPercent((row as unknown as ScoreboardRow).killParticipation) }}</span>
    </template>
    <template #cell-damagePerDeath="{ row }">
      <span class="text-brand">{{ Math.round((row as unknown as ScoreboardRow).damagePerDeath).toLocaleString() }}</span>
    </template>
    <template #cell-heroDamage="{ row }">{{ (row.heroDamage as number).toLocaleString() }}</template>
    <template #cell-siegeDamage="{ row }">{{ (row.siegeDamage as number).toLocaleString() }}</template>
    <template #cell-healing="{ row }">{{ (row.healing as number).toLocaleString() }}</template>
    <template #cell-xpShare="{ row }">
      <span class="text-brand">{{ formatPercent((row as unknown as ScoreboardRow).xpShare) }}</span>
      <span class="block text-[10px] text-muted">{{ (row.experienceContribution as number).toLocaleString() }}</span>
    </template>
    <template #cell-damageTaken="{ row }">{{ (row.damageTaken as number).toLocaleString() }}</template>
  </UiDataTable>
</template>
