import { describe, expect, test } from "bun:test";
import { buildKillersResponse, type KillerDeathInput } from "./killer-aggregate";

function death(overrides: Partial<KillerDeathInput> & { matchId: string }): KillerDeathInput {
  return { winner: false, heroKill: true, credits: [], ...overrides };
}

const HERO_NAMES = { "li-ming": "Li-Ming", muradin: "Muradin", thrall: "Thrall" };

describe("buildKillersResponse", () => {
  test("counts one death per credited killer and shares over the scoped deaths", () => {
    const response = buildKillersResponse(
      [
        death({ matchId: "m1", winner: true, credits: [{ battletag: "Tueur#1", heroId: "li-ming" }] }),
        death({ matchId: "m2", credits: [{ battletag: "Tueur#1", heroId: "li-ming" }] }),
        death({ matchId: "m3", credits: [{ battletag: "Autre#2", heroId: "muradin" }] }),
        death({ matchId: "m4", credits: [] }),
      ],
      HERO_NAMES,
    );

    expect(response.totalDeaths).toBe(4);
    expect(response.deathsWithKiller).toBe(3);
    expect(response.deathsWithKiller).toBeLessThanOrEqual(response.totalDeaths);
    expect(response.topKillers[0]).toMatchObject({
      killerBattletag: "Tueur#1",
      killerHeroId: "li-ming",
      killerHeroName: "Li-Ming",
      deaths: 2,
      share: 0.5,
      winrateWhenKilledBy: 0.5,
    });
    expect(response.topKillers[1]).toMatchObject({
      killerBattletag: "Autre#2",
      deaths: 1,
      winrateWhenKilledBy: 0,
    });
  });

  test("counts a death with several credited killers once in deathsWithKiller", () => {
    const response = buildKillersResponse(
      [
        death({
          matchId: "m1",
          credits: [
            { battletag: "Tueur#1", heroId: "li-ming" },
            { battletag: "Ami#2", heroId: "muradin" },
          ],
        }),
      ],
      HERO_NAMES,
    );
    expect(response.totalDeaths).toBe(1);
    expect(response.deathsWithKiller).toBe(1);
    expect(response.topKillers).toHaveLength(2);
    expect(response.topKillers.map((entry) => entry.deaths)).toEqual([1, 1]);
  });

  test("excludes a non-hero kill from topKillerHeroes but counts it in totalDeaths", () => {
    const response = buildKillersResponse(
      [
        death({ matchId: "m1", heroKill: true, credits: [{ battletag: "Tueur#1", heroId: "li-ming" }] }),
        death({ matchId: "m2", heroKill: false, credits: [] }),
      ],
      HERO_NAMES,
    );
    expect(response.totalDeaths).toBe(2);
    expect(response.deathsWithKiller).toBe(1);
    expect(response.topKillerHeroes).toHaveLength(1);
    expect(response.topKillerHeroes[0]).toMatchObject({ killerHeroId: "li-ming", deaths: 1 });
  });

  test("keeps credits with no resolved hero out of topKillerHeroes", () => {
    const response = buildKillersResponse(
      [death({ matchId: "m1", credits: [{ battletag: "Inconnu#9", heroId: null }] })],
      HERO_NAMES,
    );
    expect(response.topKillers).toHaveLength(1);
    expect(response.topKillers[0]).toMatchObject({ killerHeroId: null, killerHeroName: null, deaths: 1 });
    expect(response.topKillerHeroes).toEqual([]);
  });

  test("merges the same battletag regardless of casing, keeping the first spelling", () => {
    const response = buildKillersResponse(
      [
        death({ matchId: "m1", credits: [{ battletag: "Tueur#1", heroId: "li-ming" }] }),
        death({ matchId: "m2", credits: [{ battletag: "tueur#1", heroId: "li-ming" }] }),
      ],
      HERO_NAMES,
    );
    expect(response.topKillers).toHaveLength(1);
    expect(response.topKillers[0]).toMatchObject({ killerBattletag: "Tueur#1", deaths: 2 });
  });

  test("groups topKillerHeroes by hero and keeps the most frequent battletag", () => {
    const response = buildKillersResponse(
      [
        death({ matchId: "m1", credits: [{ battletag: "Tueur#1", heroId: "li-ming" }] }),
        death({ matchId: "m2", credits: [{ battletag: "Tueur#1", heroId: "li-ming" }] }),
        death({ matchId: "m3", credits: [{ battletag: "Autre#2", heroId: "li-ming" }] }),
      ],
      HERO_NAMES,
    );
    expect(response.topKillerHeroes).toHaveLength(1);
    expect(response.topKillerHeroes[0]).toMatchObject({
      killerBattletag: "Tueur#1",
      killerHeroId: "li-ming",
      killerHeroName: "Li-Ming",
      deaths: 3,
    });
  });

  test("sorts by deaths descending then by battletag for stability", () => {
    const response = buildKillersResponse(
      [
        death({ matchId: "m1", credits: [{ battletag: "Zoe#1", heroId: "thrall" }] }),
        death({ matchId: "m2", credits: [{ battletag: "Anna#2", heroId: "li-ming" }] }),
        death({ matchId: "m3", credits: [{ battletag: "Marc#3", heroId: "muradin" }] }),
      ],
      HERO_NAMES,
    );
    expect(response.topKillers.map((entry) => entry.killerBattletag)).toEqual([
      "Anna#2",
      "Marc#3",
      "Zoe#1",
    ]);
  });

  test("returns the canonical empty shape with no death", () => {
    const response = buildKillersResponse([], {});
    expect(response).toEqual({
      scope: "personal",
      totalDeaths: 0,
      deathsWithKiller: 0,
      topKillers: [],
      topKillerHeroes: [],
    });
  });
});
