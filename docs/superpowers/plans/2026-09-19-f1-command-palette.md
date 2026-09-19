# F1 — Command Palette (Ctrl+K) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the session brief mandates: write the plan, then execute it). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a client-only Ctrl+K / Cmd+K command palette that navigates to static pages, the viewer's heroes, maps and friends, plus rows registered by the current page.

**Architecture:** A pure, DB-free ranking module (`apps/web/app/utils/commandPalette.ts`) owns matching/grouping/ordering and is locked by vitest. A composable (`apps/web/app/composables/useCommandPalette.ts`) owns the module-level open state, the dynamic entry registry and the lazy fetch of the three existing endpoints (no new API). A single `CommandPalette.vue` component is mounted once in the default layout; it owns keyboard interaction and ARIA. The `/matches` page registers its current rows through the registry to prove the "current page rows" requirement.

**Tech Stack:** Nuxt 4 SSR, Vue 3 `<script setup>`, Nuxt UI 4 (`UModal`, `UInput`, `UIcon`), Tailwind tokens, vitest (node env, no jsdom).

**Spec:** `docs/superpowers/specs/2026-09-18-player-progression-design.md` § F1 (lines 728–741).

## Global Constraints

- **Client-side only, no new API** (§ F1). Sources are the existing `GET /heroes`, `GET /maps`, `GET /friends`.
- **No new dependency.** Nuxt UI / Vue / vitest already present.
- **French UI strings, English identifiers and comments** (repo rule).
- **Empty/error states use `UiStateCard`** (repo gate).
- Existing endpoints/pages keep their exact values: all changes here are additive (new files + lazy-only fetch options on `useApiFetch` + a mount point in the layout).
- Every new pure rule gets a vitest file next to the code and is written test-first: fail → minimal code → pass.
- Verification commands: `bun run typecheck`, `bun run --filter './apps/web' test`.

---

## File Structure

- **Create** `apps/web/app/utils/commandPalette.ts` — pure types + scoring/grouping/ordering + source mappers. No Nuxt import except shared types; fully testable under vitest.
- **Create** `apps/web/app/utils/commandPalette.test.ts` — vitest lock for the above.
- **Create** `apps/web/app/composables/useCommandPalette.ts` — module-level open state, dynamic entry registry, lazy remote sources.
- **Create** `apps/web/app/components/ui/CommandPalette.vue` — the dialog UI (input, listbox, keyboard, empty/error states).
- **Modify** `apps/web/app/composables/useApiFetch.ts` — add optional `lazy` / `immediate` passthrough (default unchanged).
- **Modify** `apps/web/app/layouts/default.vue` — mount the palette with the existing nav items, add a header "Rechercher" affordance.
- **Modify** `apps/web/app/pages/matches/index.vue` — register the current match rows.
- **Modify** `tasks/progression-roadmap.md`, `tasks/README.md` — tick F1 and summarize.

---

### Task 1: Pure ranking rules

**Files:**
- Create: `apps/web/app/utils/commandPalette.ts`
- Test: `apps/web/app/utils/commandPalette.test.ts`

**Interfaces:**
- Produces: `CommandPaletteGroupId`, `CommandPaletteEntry`, `CommandPaletteGroup`, `COMMAND_GROUP_ORDER`, `COMMAND_GROUP_LABELS`, `normalizeCommandText`, `scoreCommandEntry`, `groupCommandEntries`, `flattenCommandGroups`, `moveCommandSelection`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import {
  flattenCommandGroups,
  groupCommandEntries,
  moveCommandSelection,
  normalizeCommandText,
  scoreCommandEntry,
  type CommandPaletteEntry,
} from "./commandPalette";

function entry(overrides: Partial<CommandPaletteEntry>): CommandPaletteEntry {
  return { id: "e", label: "L", group: "pages", ...overrides };
}

describe("normalizeCommandText", () => {
  test("lowercases, strips accents and collapses whitespace", () => {
    expect(normalizeCommandText("  Méphisto   LE  Roi ")).toBe("mephisto le roi");
  });
});

describe("scoreCommandEntry", () => {
  test("ranks an exact label above a prefix above a substring", () => {
    const exact = scoreCommandEntry(entry({ label: "Garden" }), "garden")!;
    const prefix = scoreCommandEntry(entry({ label: "Garden of Terror" }), "garden")!;
    const word = scoreCommandEntry(entry({ label: "Garden of Terror" }), "terror")!;
    const inside = scoreCommandEntry(entry({ label: "Terrorgarden" }), "garden")!;
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(inside);
  });

  test("matches keywords below the label", () => {
    const label = scoreCommandEntry(entry({ label: "Anub'arak" }), "anub")!;
    const keyword = scoreCommandEntry(entry({ label: "Anub'arak", keywords: ["Tank"] }), "tank")!;
    expect(label).toBeGreaterThan(keyword);
  });

  test("is accent and case insensitive", () => {
    expect(scoreCommandEntry(entry({ label: "Méphisto" }), "mephisto")).not.toBeNull();
    expect(scoreCommandEntry(entry({ label: "Méphisto" }), "MEPHISTO")).not.toBeNull();
  });

  test("returns null when nothing matches", () => {
    expect(scoreCommandEntry(entry({ label: "Méphisto" }), "zzz")).toBeNull();
  });

  test("an empty query matches every entry at score 0", () => {
    expect(scoreCommandEntry(entry({ label: "Méphisto" }), "   ")).toBe(0);
  });
});

describe("groupCommandEntries", () => {
  const entries: CommandPaletteEntry[] = [
    entry({ id: "friend-1", label: "Zoe", group: "friends" }),
    entry({ id: "hero-1", label: "Ana", group: "heroes" }),
    entry({ id: "page-1", label: "Dashboard", group: "pages" }),
    entry({ id: "map-1", label: "Garden of Terror", group: "maps" }),
    entry({ id: "ctx-1", label: "Garden of Terror — Ana", group: "context" }),
  ];

  test("groups follow the fixed display order and omit empty groups", () => {
    const groups = groupCommandEntries(entries, "a");
    expect(groups.map((g) => g.id)).toEqual(["pages", "context", "heroes", "maps"]);
    expect(groups.map((g) => g.label)).toEqual(["Pages", "Sur cette page", "Héros", "Cartes"]);
  });

  test("matches are ranked by score, then rank, then label", () => {
    const ranked = groupCommandEntries(
      [
        entry({ id: "b", label: "Bravo", group: "pages", rank: 2 }),
        entry({ id: "a", label: "Alpha", group: "pages", rank: 9 }),
        entry({ id: "c", label: "Alpha", group: "pages", rank: 1 }),
      ],
      "",
    );
    expect(ranked[0]!.entries.map((e) => e.id)).toEqual(["c", "a", "b"]);
  });

  test("a query with no match returns no group", () => {
    expect(groupCommandEntries(entries, "zzzz")).toEqual([]);
  });
});

describe("flattenCommandGroups", () => {
  test("returns every entry in visual order", () => {
    const groups = groupCommandEntries(
      [
        entry({ id: "page-1", label: "Dashboard", group: "pages" }),
        entry({ id: "hero-1", label: "Ana", group: "heroes" }),
      ],
      "",
    );
    expect(flattenCommandGroups(groups).map((e) => e.id)).toEqual(["page-1", "hero-1"]);
  });
});

describe("moveCommandSelection", () => {
  test("starts on the first entry going down and the last going up", () => {
    expect(moveCommandSelection(-1, 1, 3)).toBe(0);
    expect(moveCommandSelection(-1, -1, 3)).toBe(2);
  });

  test("wraps around both ends", () => {
    expect(moveCommandSelection(2, 1, 3)).toBe(0);
    expect(moveCommandSelection(0, -1, 3)).toBe(2);
  });

  test("returns -1 when there is nothing to select", () => {
    expect(moveCommandSelection(0, 1, 0)).toBe(-1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run --filter './apps/web' test app/utils/commandPalette.test.ts`
Expected: FAIL — cannot resolve `./commandPalette`.

- [ ] **Step 3: Write the minimal implementation**

```ts
/**
 * Pure rules behind the Ctrl+K command palette: text normalisation, match
 * scoring, grouping and keyboard ordering. No Nuxt import, no I/O -- the
 * component and the composable only render/feed this module.
 */

export type CommandPaletteGroupId = "pages" | "context" | "heroes" | "maps" | "friends";

export interface CommandPaletteEntry {
  /** Stable, unique id -- doubles as the DOM id used by aria-activedescendant. */
  id: string;
  label: string;
  group: CommandPaletteGroupId;
  /** Router target. Entries without one are ignored by the palette. */
  to?: string;
  icon?: string;
  /** Extra terms matched in addition to the label (role, battletag, mode...). */
  keywords?: string[];
  /** Secondary line shown under the label. */
  description?: string;
  /** Tie-break inside a group when scores are equal; lower comes first. */
  rank?: number;
}

export interface CommandPaletteGroup {
  id: CommandPaletteGroupId;
  label: string;
  entries: CommandPaletteEntry[];
}

export const COMMAND_GROUP_ORDER: CommandPaletteGroupId[] = ["pages", "context", "heroes", "maps", "friends"];

export const COMMAND_GROUP_LABELS: Record<CommandPaletteGroupId, string> = {
  pages: "Pages",
  context: "Sur cette page",
  heroes: "Héros",
  maps: "Cartes",
  friends: "Amis",
};

/** Lowercase, strip accents and collapse whitespace so "Méphisto" matches "mephisto". */
export function normalizeCommandText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

type TextMatch = "exact" | "prefix" | "word" | "includes";

const LABEL_SCORES: Record<TextMatch, number> = { exact: 1000, prefix: 800, word: 600, includes: 400 };
const KEYWORD_SCORES: Record<TextMatch, number> = { exact: 350, prefix: 250, word: 150, includes: 50 };

function matchText(text: string, query: string): TextMatch | null {
  if (!text) return null;
  if (text === query) return "exact";
  if (text.startsWith(query)) return "prefix";
  if (text.split(" ").some((word) => word.startsWith(query))) return "word";
  if (text.includes(query)) return "includes";
  return null;
}

/** null when the entry does not match (it is then excluded from the results). */
export function scoreCommandEntry(entry: CommandPaletteEntry, query: string): number | null {
  const normalized = normalizeCommandText(query);
  if (!normalized) return 0;

  const labelMatch = matchText(normalizeCommandText(entry.label), normalized);
  let best = labelMatch ? LABEL_SCORES[labelMatch] : 0;
  for (const keyword of entry.keywords ?? []) {
    const keywordMatch = matchText(normalizeCommandText(keyword), normalized);
    if (keywordMatch) best = Math.max(best, KEYWORD_SCORES[keywordMatch]);
  }
  return best === 0 ? null : best;
}

function compareScored(
  a: { entry: CommandPaletteEntry; score: number },
  b: { entry: CommandPaletteEntry; score: number },
): number {
  return b.score - a.score
    || (a.entry.rank ?? 0) - (b.entry.rank ?? 0)
    || a.entry.label.localeCompare(b.entry.label, "fr");
}

export function groupCommandEntries(
  entries: readonly CommandPaletteEntry[],
  query: string,
): CommandPaletteGroup[] {
  const buckets = new Map<CommandPaletteGroupId, { entry: CommandPaletteEntry; score: number }[]>();
  for (const entry of entries) {
    const score = scoreCommandEntry(entry, query);
    if (score === null) continue;
    const bucket = buckets.get(entry.group) ?? [];
    bucket.push({ entry, score });
    buckets.set(entry.group, bucket);
  }

  return COMMAND_GROUP_ORDER.filter((id) => (buckets.get(id)?.length ?? 0) > 0).map((id) => ({
    id,
    label: COMMAND_GROUP_LABELS[id],
    entries: buckets.get(id)!.sort(compareScored).map((item) => item.entry),
  }));
}

export function flattenCommandGroups(groups: readonly CommandPaletteGroup[]): CommandPaletteEntry[] {
  return groups.flatMap((group) => group.entries);
}

/** Arrow-key index arithmetic with wrapping; -1 when there is nothing to select. */
export function moveCommandSelection(current: number, delta: number, count: number): number {
  if (count <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : count - 1;
  return (current + delta + count) % count;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run --filter './apps/web' test app/utils/commandPalette.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/utils/commandPalette.ts apps/web/app/utils/commandPalette.test.ts
git commit -m "feat(web): add the command palette ranking rules"
```

---

### Task 2: Source mappers

**Files:**
- Modify: `apps/web/app/utils/commandPalette.ts`
- Test: `apps/web/app/utils/commandPalette.test.ts`

**Interfaces:**
- Consumes: `CommandPaletteEntry` from Task 1; `HeroStats` (`~/types/analytics`), `MapHubEntry` (`@hots-stats/shared-types`), `FriendUser` (`~/types/friends`), `MatchListItem` (`~/types/matches`).
- Produces: `pageCommandEntries`, `heroCommandEntries`, `mapCommandEntries`, `friendCommandEntries`, `matchCommandEntries`, `CommandPageSource`.

- [ ] **Step 1: Write the failing test**

Append to `commandPalette.test.ts`:

```ts
import {
  friendCommandEntries,
  heroCommandEntries,
  mapCommandEntries,
  matchCommandEntries,
} from "./commandPalette";

describe("source mappers", () => {
  test("maps heroes to /heroes/:heroId with the role as keyword", () => {
    const [hero] = heroCommandEntries([
      { heroId: "anubarak", heroName: "Anub'arak", heroRole: "Tank" } as never,
    ]);
    expect(hero).toMatchObject({
      id: "hero-anubarak",
      label: "Anub'arak",
      group: "heroes",
      to: "/heroes/anubarak",
      keywords: ["Tank"],
    });
  });

  test("maps maps to /maps/:mapId", () => {
    const [map] = mapCommandEntries([{ mapId: "garden", mapName: "Garden of Terror" } as never]);
    expect(map).toMatchObject({ id: "map-garden", group: "maps", to: "/maps/garden" });
  });

  test("friend targets prefer the player page and fall back to the friend page", () => {
    const [withTag, withoutTag] = friendCommandEntries([
      { id: "u1", displayName: "Zoe", battletag: "Zoe#1234" } as never,
      { id: "u2", displayName: "Ann", battletag: null } as never,
    ]);
    expect(withTag!.to).toBe("/players/Zoe%231234");
    expect(withTag!.keywords).toEqual(["Zoe#1234"]);
    expect(withoutTag!.to).toBe("/friends/u2");
  });

  test("maps match rows to the context group, ranked by their list position", () => {
    const entries = matchCommandEntries([
      { id: "m1", mapName: "Garden of Terror", heroName: "Ana", gameMode: "StormLeague" } as never,
      { id: "m2", mapName: "Cursed Hollow", heroName: "Zoe", gameMode: "QuickMatch" } as never,
    ]);
    expect(entries[0]).toMatchObject({
      id: "match-m1",
      label: "Garden of Terror — Ana",
      group: "context",
      to: "/matches/m1",
      rank: 0,
    });
    expect(entries[1]!.rank).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run --filter './apps/web' test app/utils/commandPalette.test.ts`
Expected: FAIL — the mapper exports do not exist.

- [ ] **Step 3: Write the minimal implementation**

Append to `commandPalette.ts`:

```ts
import type { MapHubEntry } from "@hots-stats/shared-types";
import type { HeroStats } from "~/types/analytics";
import type { FriendUser } from "~/types/friends";
import type { MatchListItem } from "~/types/matches";

/** Minimal shape the layout already knows for its sidebar entries. */
export interface CommandPageSource {
  to: string;
  label: string;
  icon: string;
}

export function pageCommandEntries(pages: readonly CommandPageSource[]): CommandPaletteEntry[] {
  return pages.map((page) => ({
    id: `page-${page.to}`,
    label: page.label,
    group: "pages",
    to: page.to,
    icon: page.icon,
  }));
}

export function heroCommandEntries(heroes: readonly HeroStats[]): CommandPaletteEntry[] {
  return heroes.map((hero) => ({
    id: `hero-${hero.heroId}`,
    label: hero.heroName,
    group: "heroes",
    to: `/heroes/${hero.heroId}`,
    icon: "i-heroicons-fire",
    keywords: hero.heroRole ? [hero.heroRole] : [],
  }));
}

export function mapCommandEntries(maps: readonly MapHubEntry[]): CommandPaletteEntry[] {
  return maps.map((map) => ({
    id: `map-${map.mapId}`,
    label: map.mapName,
    group: "maps",
    to: `/maps/${map.mapId}`,
    icon: "i-heroicons-map",
  }));
}

export function friendCommandEntries(friends: readonly FriendUser[]): CommandPaletteEntry[] {
  return friends.map((friend) => ({
    id: `friend-${friend.id}`,
    label: friend.displayName,
    group: "friends",
    to: friend.battletag
      ? `/players/${encodeURIComponent(friend.battletag)}`
      : `/friends/${friend.id}`,
    icon: "i-heroicons-user",
    keywords: friend.battletag ? [friend.battletag] : [],
    description: friend.battletag ?? undefined,
  }));
}

export function matchCommandEntries(matches: readonly MatchListItem[]): CommandPaletteEntry[] {
  return matches.map((match, index) => ({
    id: `match-${match.id}`,
    label: `${match.mapName} — ${match.heroName}`,
    group: "context",
    to: `/matches/${match.id}`,
    icon: "i-heroicons-clock",
    keywords: [match.heroName, match.mapName, match.gameMode],
    rank: index,
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run --filter './apps/web' test app/utils/commandPalette.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/utils/commandPalette.ts apps/web/app/utils/commandPalette.test.ts
git commit -m "feat(web): map command palette sources to entries"
```

---

### Task 3: Composables (state, registry, lazy sources)

**Files:**
- Create: `apps/web/app/composables/useCommandPalette.ts`
- Modify: `apps/web/app/composables/useApiFetch.ts`

**Interfaces:**
- Consumes: Task 2 mappers; `useApiFetch`; `HeroListResponse`, `MapHubResponse`, `FriendsListResponse`.
- Produces: `useCommandPalette()` → `{ isOpen, open, close, toggle }`; `useCommandPaletteEntries(source)`; `useCommandPaletteSources()` → `{ entries, loading, errored, ensureLoaded }`.

- [ ] **Step 1: Add the lazy passthrough to `useApiFetch`**

In `apps/web/app/composables/useApiFetch.ts`, add to `ApiFetchOptions`:

```ts
  /**
   * Passed straight through to `useFetch`. The command palette is the only
   * caller that needs a deferred call (`lazy: true, immediate: false`) so the
   * three list endpoints are fetched when the palette first opens, never on
   * every page render.
   */
  lazy?: boolean;
  immediate?: boolean;
```

and add them in the returned options:

```ts
  return useFetch<T>(url, {
    baseURL: config.public.apiBase,
    credentials: "include",
    headers,
    query,
    lazy: opts.lazy,
    immediate: opts.immediate,
  });
```

Run: `bun run --filter './apps/web' test app/composables/useApiFetch.test.ts`
Expected: PASS (unchanged `buildApiQuery` behaviour).

- [ ] **Step 2: Write the composable**

Create `apps/web/app/composables/useCommandPalette.ts`:

```ts
import type { MaybeRefOrGetter } from "vue";
import { toValue } from "vue";
import type { HeroListResponse } from "~/types/analytics";
import type { FriendsListResponse } from "~/types/friends";
import type { MapHubResponse } from "~/types/maps";
import {
  friendCommandEntries,
  heroCommandEntries,
  mapCommandEntries,
  type CommandPaletteEntry,
} from "~/utils/commandPalette";

/**
 * The palette is a browser affordance: its state lives at module scope (one
 * instance for the whole app) and is only ever touched on the client. On the
 * server `isOpen` stays false and nothing is registered, so no request can
 * leak entries into another one.
 */
const isPaletteOpen = ref(false);

interface RegisteredCommandSource {
  get: () => CommandPaletteEntry[];
}

const registeredSources = ref<RegisteredCommandSource[]>([]);
const remoteEntries = ref<CommandPaletteEntry[]>([]);
const remoteLoading = ref(false);
const remoteErrored = ref(false);
const remoteLoaded = ref(false);

export function useCommandPalette() {
  function open() {
    isPaletteOpen.value = true;
  }
  function close() {
    isPaletteOpen.value = false;
  }
  function toggle() {
    isPaletteOpen.value = !isPaletteOpen.value;
  }
  return { isOpen: isPaletteOpen, open, close, toggle };
}

/**
 * Registers the current page's rows. Called from a page/component setup; the
 * entries are removed when that scope unmounts. Deliberately client-only
 * (onMounted): registering during SSR would append to a shared module array
 * on every request.
 */
export function useCommandPaletteEntries(source: MaybeRefOrGetter<CommandPaletteEntry[]>) {
  const holder: RegisteredCommandSource = { get: () => toValue(source) };
  onMounted(() => {
    if (!registeredSources.value.includes(holder)) {
      registeredSources.value = [...registeredSources.value, holder];
    }
  });
  onBeforeUnmount(() => {
    registeredSources.value = registeredSources.value.filter((item) => item !== holder);
  });
}

/**
 * Lazy remote sources (heroes, maps, friends) plus the entries registered by
 * the current page. `ensureLoaded` is idempotent and retries on the next open
 * if a previous attempt failed, so the static Pages group never depends on it.
 */
export function useCommandPaletteSources() {
  const heroesFetch = useApiFetch<HeroListResponse>("/heroes", { lazy: true, immediate: false });
  const mapsFetch = useApiFetch<MapHubResponse>("/maps", { lazy: true, immediate: false });
  const friendsFetch = useApiFetch<FriendsListResponse>("/friends", {
    lazy: true,
    immediate: false,
    withGameMode: false,
  });

  const entries = computed<CommandPaletteEntry[]>(() => [
    ...remoteEntries.value,
    ...registeredSources.value.flatMap((source) => source.get()),
  ]);

  async function ensureLoaded() {
    if (remoteLoaded.value || remoteLoading.value) return;
    remoteLoading.value = true;
    remoteErrored.value = false;
    try {
      await Promise.all([heroesFetch.execute(), mapsFetch.execute(), friendsFetch.execute()]);
      if (heroesFetch.error.value || mapsFetch.error.value || friendsFetch.error.value) {
        remoteErrored.value = true;
      } else {
        remoteEntries.value = [
          ...heroCommandEntries(heroesFetch.data.value?.heroes ?? []),
          ...mapCommandEntries(mapsFetch.data.value?.maps ?? []),
          ...friendCommandEntries(friendsFetch.data.value?.friends ?? []),
        ];
        remoteLoaded.value = true;
      }
    } catch {
      remoteErrored.value = true;
    } finally {
      remoteLoading.value = false;
    }
  }

  return { entries, loading: remoteLoading, errored: remoteErrored, ensureLoaded };
}
```

- [ ] **Step 3: Typecheck the new module**

Run: `bun run typecheck`
Expected: PASS (no new error in `useCommandPalette.ts` / `useApiFetch.ts`).

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/composables/useCommandPalette.ts apps/web/app/composables/useApiFetch.ts
git commit -m "feat(web): add the command palette state, registry and lazy sources"
```

---

### Task 4: The palette component

**Files:**
- Create: `apps/web/app/components/ui/CommandPalette.vue`

**Interfaces:**
- Consumes: `useCommandPalette`, `useCommandPaletteSources` (Task 3), the pure rules (Task 1).
- Produces: `<UiCommandPalette :pages="..." />`.

- [ ] **Step 1: Write the component**

Create `apps/web/app/components/ui/CommandPalette.vue`:

```vue
<script setup lang="ts">
import {
  flattenCommandGroups,
  groupCommandEntries,
  moveCommandSelection,
  pageCommandEntries,
  type CommandPageSource,
  type CommandPaletteEntry,
} from "~/utils/commandPalette";

/**
 * Single instance, mounted by the default layout. It only orchestrates: the
 * matching/grouping rules live in utils/commandPalette.ts and the state in
 * composables/useCommandPalette.ts.
 */
const props = defineProps<{ pages: CommandPageSource[] }>();

const { isOpen, close, open } = useCommandPalette();
const { entries, loading, errored, ensureLoaded } = useCommandPaletteSources();

const query = ref("");
const activeIndex = ref(0);
const inputRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLElement | null>(null);

const allEntries = computed<CommandPaletteEntry[]>(() => [
  ...pageCommandEntries(props.pages),
  ...entries.value,
]);
const groups = computed(() => groupCommandEntries(allEntries.value, query.value));
const flatEntries = computed(() => flattenCommandGroups(groups.value));
const activeEntry = computed(() => flatEntries.value[activeIndex.value] ?? null);

watch(query, () => {
  activeIndex.value = 0;
});
watch(flatEntries, () => {
  if (activeIndex.value >= flatEntries.value.length) {
    activeIndex.value = Math.max(0, flatEntries.value.length - 1);
  }
});
watch(isOpen, async (value) => {
  if (!value) return;
  query.value = "";
  activeIndex.value = 0;
  void ensureLoaded();
  await nextTick();
  inputRef.value?.focus();
});

function entryDomId(entry: CommandPaletteEntry) {
  return `command-palette-${entry.id}`;
}

function move(delta: number) {
  activeIndex.value = moveCommandSelection(activeIndex.value, delta, flatEntries.value.length);
  void nextTick(() => {
    const active = activeEntry.value;
    if (!active) return;
    listRef.value
      ?.querySelector<HTMLElement>(`#${CSS.escape(entryDomId(active))}`)
      ?.scrollIntoView({ block: "nearest" });
  });
}

function select(entry: CommandPaletteEntry | null = activeEntry.value) {
  if (!entry?.to) return;
  close();
  void navigateTo(entry.to);
}

// Global shortcut: Ctrl+K / Cmd+K opens the palette, and closes it when open.
function onWindowKeydown(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") return;
  event.preventDefault();
  isOpen.value ? close() : open();
}

onMounted(() => window.addEventListener("keydown", onWindowKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onWindowKeydown));
</script>

<template>
  <UModal
    :open="isOpen"
    title="Palette de commandes"
    description="Recherche une page, un héros, une carte ou un ami."
    :ui="{ content: 'sm:max-w-xl', body: 'p-4' }"
    @update:open="(value: boolean) => (value ? open() : close())"
  >
    <template #body>
      <div class="space-y-3">
        <input
          ref="inputRef"
          v-model="query"
          type="text"
          role="combobox"
          aria-label="Rechercher"
          aria-controls="command-palette-listbox"
          aria-expanded="true"
          :aria-activedescendant="activeEntry ? entryDomId(activeEntry) : undefined"
          placeholder="Rechercher…"
          autocomplete="off"
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted focus:border-brand"
          @keydown.down.prevent="move(1)"
          @keydown.up.prevent="move(-1)"
          @keydown.enter.prevent="select()"
        >

        <div
          id="command-palette-listbox"
          ref="listRef"
          role="listbox"
          aria-label="Résultats"
          class="max-h-80 overflow-y-auto"
        >
          <template v-if="flatEntries.length > 0">
            <div
              v-for="group in groups"
              :key="group.id"
              role="group"
              :aria-label="group.label"
            >
              <p class="px-1 pb-1 pt-3 text-xs font-medium uppercase tracking-wide text-muted">
                {{ group.label }}
              </p>
              <ul>
                <li
                  v-for="entry in group.entries"
                  :id="entryDomId(entry)"
                  :key="entry.id"
                  role="option"
                  :aria-selected="entry.id === activeEntry?.id"
                  class="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors"
                  :class="entry.id === activeEntry?.id ? 'bg-brand/15 text-brand' : 'text-foreground hover:bg-background'"
                  @mouseenter="activeIndex = flatEntries.findIndex((item) => item.id === entry.id)"
                  @click="select(entry)"
                >
                  <UIcon :name="entry.icon ?? 'i-heroicons-arrow-right'" class="h-4 w-4 shrink-0" />
                  <span class="min-w-0 flex-1 truncate">{{ entry.label }}</span>
                  <span v-if="entry.description" class="shrink-0 truncate text-xs text-muted">
                    {{ entry.description }}
                  </span>
                </li>
              </ul>
            </div>
          </template>

          <div v-else-if="loading" class="py-6">
            <UiStateCard state="loading" size="sm" />
          </div>
          <div v-else class="py-6">
            <UiStateCard state="empty" size="sm" :message="`Aucun résultat pour « ${query} ».`" />
          </div>
        </div>

        <p v-if="errored" class="text-xs text-danger">
          Certaines suggestions n'ont pas pu être chargées.
        </p>

        <p class="flex gap-3 border-t border-border pt-2 text-xs text-muted">
          <span><kbd>↑</kbd> <kbd>↓</kbd> naviguer</span>
          <span><kbd>Entrée</kbd> ouvrir</span>
          <span><kbd>Échap</kbd> fermer</span>
        </p>
      </div>
    </template>
  </UModal>
</template>
```

- [ ] **Step 2: Typecheck the component**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/ui/CommandPalette.vue
git commit -m "feat(web): add the Ctrl+K command palette component"
```

---

### Task 5: Mount it and register the current-page rows

**Files:**
- Modify: `apps/web/app/layouts/default.vue`
- Modify: `apps/web/app/pages/matches/index.vue`

**Interfaces:**
- Consumes: `<UiCommandPalette :pages="navItems" />` (Task 4); `useCommandPalette` for the header button; `matchCommandEntries` + `useCommandPaletteEntries` for the matches page.

- [ ] **Step 1: Wire the layout**

In `default.vue` script, after `const isAdmin = ...`, add:

```ts
const { open: openCommandPalette } = useCommandPalette();
```

Add a desktop affordance in the header, inside the right-hand `div` (before the account switcher):

```html
<button
  type="button"
  class="hidden items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs text-muted transition-colors hover:text-foreground md:flex"
  aria-label="Ouvrir la palette de commandes"
  @click="openCommandPalette"
>
  <UIcon name="i-heroicons-magnifying-glass" class="h-4 w-4" />
  <span>Rechercher</span>
  <kbd class="rounded border border-border px-1 text-[10px]">Ctrl K</kbd>
</button>
```

Mount the palette just before the closing `</div>` of the page root:

```html
<UiCommandPalette :pages="navItems" />
```

- [ ] **Step 2: Register the current matches rows**

In `apps/web/app/pages/matches/index.vue`, import the mapper and register the rows after `matchesData` is declared:

```ts
import { matchCommandEntries } from "~/utils/commandPalette";
```

```ts
// The command palette lists the rows of the page you are currently on.
useCommandPaletteEntries(computed(() => matchCommandEntries(matchesData.value?.matches ?? [])));
```

- [ ] **Step 3: Typecheck + tests**

Run: `bun run typecheck`
Expected: PASS.
Run: `bun run --filter './apps/web' test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/layouts/default.vue apps/web/app/pages/matches/index.vue
git commit -m "feat(web): mount the command palette in the layout and register match rows"
```

---

### Task 6: Chantier bookkeeping and full verification

**Files:**
- Modify: `tasks/progression-roadmap.md`
- Modify: `tasks/README.md`

- [ ] **Step 1: Tick F1 in the roadmap and record the deviations**

Change `- [ ] **F1 — ...**` to `- [x] **F1 — ...**` and append a `**Fait** (2026-09-19). Écarts / précisions vs spec :` block noting:
- the pure rules live in `apps/web/app/utils/commandPalette.ts` (locked by `commandPalette.test.ts`), per the repo's pure/UI split;
- the dynamic row registration is `useCommandPaletteEntries`, exercised by `/matches`;
- remote sources are fetched lazily on first open via an additive `lazy`/`immediate` passthrough on `useApiFetch` (no new endpoint);
- AC2 (role/aria-modal) is provided by `UModal` and verified by reading the rendered markup, since the web test setup is a plain node vitest without jsdom.

- [ ] **Step 2: Add the one-line "Déjà fait" entry**

Append to `tasks/README.md`:

```md
- **Suite Progression — F1 (palette de commandes)** : palette Ctrl+K / Cmd+K
  client-only (`ui/CommandPalette.vue`) montée dans le layout, sources = pages
  (nav existante), héros, cartes et amis (endpoints existants, chargés
  paresseusement à la première ouverture), plus les lignes de la page courante
  (`useCommandPaletteEntries`, exercé par `/matches`). Règles pures de
  correspondance/regroupement dans `utils/commandPalette.ts` (testées).
  Aucun nouvel endpoint, aucune migration, aucune dépendance.
```

- [ ] **Step 3: Run the full gate**

```bash
bun run typecheck
bun test packages/shared-types
bun test apps/api
bun run --filter './apps/web' test
```
Expected: all PASS. The daemon is untouched.

- [ ] **Step 4: Commit and decide on push**

```bash
git add tasks/progression-roadmap.md tasks/README.md
git commit -m "docs(tasks): record the F1 command palette chantier"
```

Push only if every check above is green; otherwise leave the commits local and report the blocker.

---

## Self-Review

- **Spec coverage:** AC1 (Ctrl+K / Escape / arrows / Enter) → Task 4 + Task 5. AC2 (keyboard reachable, `role="dialog"`/`aria-modal`) → UModal supplies the dialog semantics; combobox/listbox/option + `aria-activedescendant` in Task 4; noted as manually verified. AC3 (grouped, ranked, clear empty state) → Tasks 1–2 + the `UiStateCard` empty branch in Task 4. "Current page's rows" → `useCommandPaletteEntries` (Task 3) exercised in Task 5.
- **Placeholder scan:** every code step carries the full code; no TBD/"handle edge cases".
- **Type consistency:** `CommandPaletteEntry`, `groupCommandEntries`, `flattenCommandGroups`, `moveCommandSelection`, `pageCommandEntries`, `useCommandPalette`, `useCommandPaletteEntries`, `useCommandPaletteSources` keep the same names across tasks.
