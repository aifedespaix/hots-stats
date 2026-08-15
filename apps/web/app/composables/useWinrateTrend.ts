export interface WinrateTrendPoint {
  playedAt: string;
  winner: boolean;
}

/**
 * Fetches `GET /matches/trend` for a reactive query (filters + optional
 * `limit`) and derives the basic win/loss/winrate figures from the result.
 * Shared by the "form tracker" widget (a lightweight preview, always
 * enabled) and its detail modal (only fetches while open) -- `enabled` lets
 * each caller control that without duplicating the fetch/error/pending
 * plumbing.
 */
export function useWinrateTrend(
  query: ComputedRef<Record<string, unknown>>,
  enabled: ComputedRef<boolean> = computed(() => true),
) {
  const points = ref<WinrateTrendPoint[]>([]);
  const pending = ref(false);
  const errored = ref(false);

  async function load() {
    pending.value = true;
    errored.value = false;
    try {
      const config = useRuntimeConfig();
      const res = await $fetch<{ points: WinrateTrendPoint[] }>("/matches/trend", {
        baseURL: config.public.apiBase,
        credentials: "include",
        query: query.value,
      });
      points.value = res.points;
    } catch {
      errored.value = true;
    } finally {
      pending.value = false;
    }
  }

  watch(
    [query, enabled],
    ([, isEnabled]) => {
      if (isEnabled) load();
    },
    { immediate: true, deep: true },
  );

  const gamesPlayed = computed(() => points.value.length);
  const wins = computed(() => points.value.filter((p) => p.winner).length);
  const winrate = computed(() => (gamesPlayed.value > 0 ? wins.value / gamesPlayed.value : null));

  /**
   * Momentum: winrate of the second half of the window vs. the first half,
   * chronologically -- lets the widget show "en progression"/"en régression"
   * at a glance. Needs at least 4 games so each half has a meaningful sample.
   */
  const momentum = computed<"up" | "down" | "flat" | null>(() => {
    if (gamesPlayed.value < 4) return null;
    const mid = Math.floor(gamesPlayed.value / 2);
    const firstHalf = points.value.slice(0, mid);
    const secondHalf = points.value.slice(mid);
    const rate = (list: WinrateTrendPoint[]) => list.filter((p) => p.winner).length / list.length;
    const diff = rate(secondHalf) - rate(firstHalf);
    if (Math.abs(diff) < 0.05) return "flat";
    return diff > 0 ? "up" : "down";
  });

  return { points, pending, errored, gamesPlayed, wins, winrate, momentum, reload: load };
}

interface CumulativePoint {
  playedAt: string;
  gameNumber: number;
  winrate: number;
}

/**
 * Cumulative winrate chart.js `data`/`options` for a chronological points
 * array -- shared by every "winrate over time" chart (matches page trend
 * modal, form tracker modal) so they stay visually identical.
 */
export function useWinrateTrendChart(points: Ref<WinrateTrendPoint[]>) {
  const cumulative = computed<CumulativePoint[]>(() => {
    let wins = 0;
    return points.value.map((p, i) => {
      if (p.winner) wins++;
      return { playedAt: p.playedAt, gameNumber: i + 1, winrate: (wins / (i + 1)) * 100 };
    });
  });

  const themeColor = useChartThemeColor();

  const chartData = computed(() => ({
    labels: cumulative.value.map((p) => formatDate(p.playedAt)),
    datasets: [
      {
        label: "Winrate cumulé",
        data: cumulative.value.map((p) => p.winrate),
        borderColor: themeColor("--raw-primary"),
        backgroundColor: themeColor("--raw-primary"),
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHitRadius: 8,
        borderWidth: 2,
        tension: 0.15,
        fill: false,
      },
      {
        // Flat 50% reference line, so a reader can tell "above/below even" at
        // a glance without reading axis ticks -- excluded from the tooltip
        // via `plugins.tooltip.filter` below.
        label: "50%",
        data: cumulative.value.map(() => 50),
        borderColor: themeColor("--raw-muted"),
        borderDash: [4, 4],
        borderWidth: 1,
        pointRadius: 0,
        pointHitRadius: 0,
        fill: false,
      },
    ],
  }));

  const chartOptions = computed(() => ({
    interaction: { mode: "index" as const, intersect: false },
    scales: {
      x: {
        grid: { color: themeColor("--raw-border") },
        ticks: { color: themeColor("--raw-muted"), maxTicksLimit: 8, maxRotation: 0 },
      },
      y: {
        min: 0,
        max: 100,
        grid: { color: themeColor("--raw-border") },
        ticks: { color: themeColor("--raw-muted"), callback: (value: number | string) => `${value}%` },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        filter: (item: { datasetIndex?: number }) => item.datasetIndex === 0,
        callbacks: {
          label: (ctx: { dataIndex: number }) => {
            const point = cumulative.value[ctx.dataIndex];
            if (!point) return "";
            return `Partie ${point.gameNumber} · ${point.winrate.toFixed(1)}% de victoires cumulées`;
          },
        },
      },
    },
  }));

  return { cumulative, chartData, chartOptions };
}
