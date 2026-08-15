<script setup lang="ts">
/**
 * "Carte des builds": a talent-tree flow diagram for the Analyzer's top
 * builds -- one column per tier, one node per talent that appears in at
 * least one of the ranked builds, curved connectors between consecutive
 * tiers. Edge thickness encodes sample size (games played on that exact
 * transition), edge color encodes winrate (danger -> success), and the
 * single best-ranked build (already sorted by Wilson lower bound by the
 * API) is drawn opaque while every other path fades -- the eye follows the
 * strongest path first, exactly the way the "Top builds" table already
 * ranks first but here shown as branching structure a table can't convey.
 */
interface FlowPick {
  tier: number;
  talentId: string;
  talentName: string;
}
interface FlowBuild {
  picks: FlowPick[];
  gamesPlayed: number;
  winrate: number;
}

const props = withDefaults(defineProps<{ builds: FlowBuild[]; heroName: string; maxBuilds?: number }>(), {
  maxBuilds: 8,
});

const BUILD_COUNT_OPTIONS = [4, 8, 12] as const;
const visibleBuildCount = ref(Math.min(props.maxBuilds, props.builds.length) || BUILD_COUNT_OPTIONS[1]);

// Reset to a sane default whenever the underlying build list changes (new
// hero/map/pins) so a leftover "12" from a previous, richer population
// doesn't silently clip against a much smaller one.
watch(
  () => props.builds,
  () => {
    visibleBuildCount.value = Math.min(props.maxBuilds, props.builds.length) || BUILD_COUNT_OPTIONS[1];
  },
);

// Only offer counts the current build list can actually satisfy, so a
// disabled-but-clickable pill (a past source of "buggy" filter state) can't
// exist in the first place.
const buildCountOptions = computed(() =>
  BUILD_COUNT_OPTIONS.filter((count) => count <= props.builds.length || count === visibleBuildCount.value).map(
    (count) => ({ value: String(count), label: `Top ${count}` }),
  ),
);

const themeColor = useChartThemeColor();
const themeColorRaw = useChartThemeColorRaw();

const WIDTH = 780;
const NODE_W = 122;
const NODE_MIN_H = 24;
const NODE_MAX_H = 60;
const PX_PER_GAME = 3.2;
const ROW_GAP = 10;
const TOP_PAD = 30;
const BOTTOM_PAD = 14;

const usedBuilds = computed(() => props.builds.slice(0, visibleBuildCount.value));

interface FlowNode {
  key: string;
  tier: number;
  talentId: string;
  talentName: string;
  weight: number;
}

const graph = computed(() => {
  const nodes = new Map<string, FlowNode>();
  const edges = new Map<string, { fromKey: string; toKey: string; weight: number; winrateSum: number; isBest: boolean }>();
  const bestNodeKeys = new Set<string>();

  usedBuilds.value.forEach((build, buildIndex) => {
    const sorted = [...build.picks].sort((a, b) => a.tier - b.tier);
    sorted.forEach((pick, i) => {
      const key = `${pick.tier}:${pick.talentId}`;
      const node = nodes.get(key) ?? { key, tier: pick.tier, talentId: pick.talentId, talentName: pick.talentName, weight: 0 };
      node.weight += build.gamesPlayed;
      nodes.set(key, node);
      if (buildIndex === 0) bestNodeKeys.add(key);

      if (i > 0) {
        const prev = sorted[i - 1]!;
        const fromKey = `${prev.tier}:${prev.talentId}`;
        const edgeKey = `${fromKey}->${key}`;
        const edge = edges.get(edgeKey) ?? { fromKey, toKey: key, weight: 0, winrateSum: 0, isBest: false };
        edge.weight += build.gamesPlayed;
        edge.winrateSum += build.winrate * build.gamesPlayed;
        if (buildIndex === 0) edge.isBest = true;
        edges.set(edgeKey, edge);
      }
    });
  });

  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()].map((e) => ({ ...e, winrate: e.weight > 0 ? e.winrateSum / e.weight : 0 })),
    bestNodeKeys,
  };
});

const tiers = computed(() => [...new Set(graph.value.nodes.map((n) => n.tier))].sort((a, b) => a - b));

const colX = computed(() => {
  const marginX = NODE_W / 2 + 14;
  const span = Math.max(0, WIDTH - marginX * 2);
  const step = tiers.value.length > 1 ? span / (tiers.value.length - 1) : 0;
  return new Map(tiers.value.map((tier, i) => [tier, marginX + i * step]));
});

interface LaidOutNode extends FlowNode {
  x: number;
  y: number;
  height: number;
  isBest: boolean;
}

const layout = computed(() => {
  const laidOut = new Map<string, LaidOutNode>();
  let maxColumnContentHeight = 0;

  for (const tier of tiers.value) {
    const columnNodes = graph.value.nodes.filter((n) => n.tier === tier).sort((a, b) => b.weight - a.weight);
    let cursor = 0;
    for (const node of columnNodes) {
      const height = Math.min(NODE_MAX_H, Math.max(NODE_MIN_H, node.weight * PX_PER_GAME));
      laidOut.set(node.key, { ...node, x: colX.value.get(tier) ?? 0, y: cursor, height, isBest: graph.value.bestNodeKeys.has(node.key) });
      cursor += height + ROW_GAP;
    }
    maxColumnContentHeight = Math.max(maxColumnContentHeight, cursor - ROW_GAP);
  }

  // Vertically center each column within the tallest one.
  for (const tier of tiers.value) {
    const columnNodes = [...laidOut.values()].filter((n) => n.tier === tier);
    const contentHeight = columnNodes.reduce((sum, n) => sum + n.height, 0) + ROW_GAP * Math.max(0, columnNodes.length - 1);
    const offset = (maxColumnContentHeight - contentHeight) / 2;
    for (const n of columnNodes) laidOut.set(n.key, { ...n, y: n.y + offset });
  }

  return { nodes: laidOut, contentHeight: maxColumnContentHeight };
});

const svgHeight = computed(() => Math.max(120, layout.value.contentHeight + TOP_PAD + BOTTOM_PAD));

function nodeCenterY(node: LaidOutNode): number {
  return TOP_PAD + node.y + node.height / 2;
}

function winrateColor(winrate: number): string {
  const danger = themeColorRaw("--raw-danger");
  const success = themeColorRaw("--raw-success");
  const t = Math.min(1, Math.max(0, winrate));
  const [l, c, h] = danger.map((v, i) => v + ((success[i] ?? 0) - v) * t);
  return `oklch(${l} ${c} ${h})`;
}

const maxEdgeWeight = computed(() => Math.max(1, ...graph.value.edges.map((e) => e.weight)));

const edgePaths = computed(() =>
  graph.value.edges
    .map((edge) => {
      const from = layout.value.nodes.get(edge.fromKey);
      const to = layout.value.nodes.get(edge.toKey);
      if (!from || !to) return null;
      const x1 = from.x + NODE_W / 2;
      const y1 = nodeCenterY(from);
      const x2 = to.x - NODE_W / 2;
      const y2 = nodeCenterY(to);
      const midX = (x1 + x2) / 2;
      const strokeWidth = Math.min(22, Math.max(1.5, (edge.weight / maxEdgeWeight.value) * 20)) + (edge.isBest ? 1.5 : 0);
      return {
        key: `${edge.fromKey}->${edge.toKey}`,
        d: `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`,
        strokeWidth,
        color: winrateColor(edge.winrate),
        opacity: edge.isBest ? 0.95 : 0.26,
        isBest: edge.isBest,
        title: `${Math.round(edge.winrate * 100)}% de victoires · ${edge.weight} partie${edge.weight > 1 ? "s" : ""}${edge.isBest ? " · build le mieux classé" : ""}`,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null),
);

const nodeShapes = computed(() =>
  [...layout.value.nodes.values()].map((node) => {
    const label = formatTalentName(node.talentName, props.heroName);
    return {
      key: node.key,
      x: node.x - NODE_W / 2,
      y: TOP_PAD + node.y,
      width: NODE_W,
      height: node.height,
      isBest: node.isBest,
      label,
      shortLabel: label.length > 20 ? `${label.slice(0, 19)}…` : label,
      weight: node.weight,
      centerX: node.x,
      centerY: nodeCenterY(node),
      title: `${label} · ${node.weight} partie${node.weight > 1 ? "s" : ""} dans les builds affichés`,
    };
  }),
);

const tierHeaders = computed(() => tiers.value.map((tier) => ({ tier, x: colX.value.get(tier) ?? 0 })));

const legendGradient = computed(() => `linear-gradient(to right, ${themeColor("--raw-danger")}, ${themeColor("--raw-success")})`);
</script>

<template>
  <div v-if="builds.length > 0 && tiers.length > 1">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
        <span class="flex items-center gap-1.5">
          <span class="inline-block h-2 w-5 rounded-full" :style="{ background: legendGradient }" />
          Winrate de la transition
        </span>
        <span class="flex items-center gap-1.5"><span class="inline-block h-2 w-2 rounded-full bg-foreground/60" />Épaisseur = parties jouées</span>
        <span class="flex items-center gap-1.5"><span class="inline-block h-2 w-5 rounded-full bg-foreground/90" />Trait plein = build le mieux classé</span>
      </div>

      <UiPillTabs
        :model-value="String(visibleBuildCount)"
        :options="buildCountOptions"
        shape="pill"
        @update:model-value="visibleBuildCount = Number($event)"
      />
    </div>

    <div class="overflow-x-auto">
      <svg
        :viewBox="`0 0 ${WIDTH} ${svgHeight}`"
        class="block w-full"
        style="min-width: 620px"
        role="img"
        :aria-label="`Arbre des builds pour ${heroName}`"
      >
        <text
          v-for="header in tierHeaders"
          :key="header.tier"
          :x="header.x"
          y="14"
          text-anchor="middle"
          :fill="themeColor('--raw-muted')"
          font-size="11"
          font-family="var(--font-mono)"
          style="text-transform: uppercase; letter-spacing: 0.05em"
        >
          Palier {{ header.tier }}
        </text>

        <path
          v-for="edge in edgePaths"
          :key="edge.key"
          :d="edge.d"
          fill="none"
          :stroke="edge.color"
          :stroke-width="edge.strokeWidth"
          :stroke-opacity="edge.opacity"
          stroke-linecap="round"
        >
          <title>{{ edge.title }}</title>
        </path>

        <g v-for="node in nodeShapes" :key="node.key">
          <rect
            :x="node.x"
            :y="node.y"
            :width="node.width"
            :height="node.height"
            rx="6"
            :fill="node.isBest ? themeColor('--raw-primary', 0.14) : themeColor('--raw-surface')"
            :stroke="node.isBest ? themeColor('--raw-primary') : themeColor('--raw-border')"
            :stroke-width="node.isBest ? 2 : 1"
          >
            <title>{{ node.title }}</title>
          </rect>
          <text
            :x="node.centerX"
            :y="node.height > 40 ? node.centerY - 4 : node.centerY + 3.5"
            text-anchor="middle"
            :fill="themeColor('--raw-foreground')"
            font-size="10.5"
            font-weight="500"
          >
            {{ node.shortLabel }}
          </text>
          <text
            v-if="node.height > 40"
            :x="node.centerX"
            :y="node.centerY + 12"
            text-anchor="middle"
            :fill="themeColor('--raw-muted')"
            font-size="9.5"
            font-family="var(--font-mono)"
          >
            {{ node.weight }} partie{{ node.weight > 1 ? "s" : "" }}
          </text>
        </g>
      </svg>
    </div>
  </div>
</template>
