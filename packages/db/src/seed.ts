import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { heroes, heroRoleEnum, maps, type NewHero, type NewMap } from "./schema";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL environment variable is required");
}

/**
 * Mirrors `daemon-python/src/parser.py`'s `_slugify` exactly, so the ids
 * generated here always match the `map`/`heroId` slugs the daemon sends in
 * a replay payload.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Mirrors `daemon-python/src/constants.py`'s `MAP_DISPLAY_NAMES` values.
 * Keep both in sync when a new map ships.
 */
const MAP_NAMES = [
  "Sky Temple",
  "Towers of Doom",
  "Haunted Mines",
  "Battlefield of Eternity",
  "Blackheart's Bay",
  "Cursed Hollow",
  "Dragon Shire",
  "Garden of Terror",
  "Infernal Shrines",
  "Tomb of the Spider Queen",
  "Volskaya Foundry",
  "Warhead Junction",
  "Braxis Holdout",
  "Hanamura Temple",
  "Alterac Pass",
  "Braxis Outpost",
  "Industrial District",
  "Lost Cavern",
  "Silver City",
];

type HeroRole = (typeof heroRoleEnum.enumValues)[number];

/**
 * Mirrors `daemon-python/src/constants.py`'s `HERO_DISPLAY_NAMES` values
 * (same names, same order), paired with each hero's role under Blizzard's
 * six-role system. Cross-checked against nexuscompendium.com's per-role
 * hero lists (Aug 2026): 13 Tank, 17 Bruiser, 30 RangedAssassin,
 * 10 MeleeAssassin, 16 Healer, 4 Support = 90.
 *
 * Icon URLs aren't seeded yet (no Blizzard-hosted source wired up) --
 * `iconUrl` stays null until that's tackled separately.
 */
const HEROES: { name: string; role: HeroRole }[] = [
  { name: "Abathur", role: "Support" },
  { name: "Alarak", role: "MeleeAssassin" },
  { name: "Alexstrasza", role: "Healer" },
  { name: "Ana", role: "Healer" },
  { name: "Anduin", role: "Healer" },
  { name: "Anub'arak", role: "Tank" },
  { name: "Artanis", role: "Bruiser" },
  { name: "Arthas", role: "Tank" },
  { name: "Auriel", role: "Healer" },
  { name: "Azmodan", role: "RangedAssassin" },
  { name: "Blaze", role: "Tank" },
  { name: "Brightwing", role: "Healer" },
  { name: "Cassia", role: "RangedAssassin" },
  { name: "Chen", role: "Bruiser" },
  { name: "Cho", role: "Tank" },
  { name: "Chromie", role: "RangedAssassin" },
  { name: "Deathwing", role: "Bruiser" },
  { name: "Deckard", role: "Healer" },
  { name: "Dehaka", role: "Bruiser" },
  { name: "Diablo", role: "Tank" },
  { name: "D.Va", role: "Bruiser" },
  { name: "E.T.C.", role: "Tank" },
  { name: "Falstad", role: "RangedAssassin" },
  { name: "Fenix", role: "RangedAssassin" },
  { name: "Gall", role: "RangedAssassin" },
  { name: "Garrosh", role: "Tank" },
  { name: "Gazlowe", role: "Bruiser" },
  { name: "Genji", role: "RangedAssassin" },
  { name: "Greymane", role: "RangedAssassin" },
  { name: "Gul'dan", role: "RangedAssassin" },
  { name: "Hanzo", role: "RangedAssassin" },
  { name: "Hogger", role: "Bruiser" },
  { name: "Illidan", role: "MeleeAssassin" },
  { name: "Imperius", role: "Bruiser" },
  { name: "Jaina", role: "RangedAssassin" },
  { name: "Johanna", role: "Tank" },
  { name: "Junkrat", role: "RangedAssassin" },
  { name: "Kael'thas", role: "RangedAssassin" },
  { name: "Kel'Thuzad", role: "RangedAssassin" },
  { name: "Kerrigan", role: "MeleeAssassin" },
  { name: "Kharazim", role: "Healer" },
  { name: "Leoric", role: "Bruiser" },
  { name: "Li Li", role: "Healer" },
  { name: "Li-Ming", role: "RangedAssassin" },
  { name: "Lt. Morales", role: "Healer" },
  { name: "Lucio", role: "Healer" },
  { name: "Lunara", role: "RangedAssassin" },
  { name: "Maiev", role: "MeleeAssassin" },
  { name: "Malfurion", role: "Healer" },
  { name: "Mal'Ganis", role: "Tank" },
  { name: "Malthael", role: "Bruiser" },
  { name: "Medivh", role: "Support" },
  { name: "Mei", role: "Tank" },
  { name: "Mephisto", role: "RangedAssassin" },
  { name: "Muradin", role: "Tank" },
  { name: "Murky", role: "MeleeAssassin" },
  { name: "Nazeebo", role: "RangedAssassin" },
  { name: "Nova", role: "RangedAssassin" },
  { name: "Orphea", role: "RangedAssassin" },
  { name: "Probius", role: "RangedAssassin" },
  { name: "Qhira", role: "MeleeAssassin" },
  { name: "Ragnaros", role: "Bruiser" },
  { name: "Raynor", role: "RangedAssassin" },
  { name: "Rehgar", role: "Healer" },
  { name: "Rexxar", role: "Bruiser" },
  { name: "Samuro", role: "MeleeAssassin" },
  { name: "Sgt. Hammer", role: "RangedAssassin" },
  { name: "Sonya", role: "Bruiser" },
  { name: "Stitches", role: "Tank" },
  { name: "Stukov", role: "Healer" },
  { name: "Sylvanas", role: "RangedAssassin" },
  { name: "Tassadar", role: "RangedAssassin" },
  { name: "The Butcher", role: "MeleeAssassin" },
  { name: "The Lost Vikings", role: "Support" },
  { name: "Thrall", role: "Bruiser" },
  { name: "Tracer", role: "RangedAssassin" },
  { name: "Tychus", role: "RangedAssassin" },
  { name: "Tyrael", role: "Tank" },
  { name: "Tyrande", role: "Healer" },
  { name: "Uther", role: "Healer" },
  { name: "Valeera", role: "MeleeAssassin" },
  { name: "Valla", role: "RangedAssassin" },
  { name: "Varian", role: "Bruiser" },
  { name: "Xul", role: "Bruiser" },
  { name: "Whitemane", role: "Healer" },
  { name: "Yrel", role: "Bruiser" },
  { name: "Zagara", role: "RangedAssassin" },
  { name: "Zarya", role: "Support" },
  { name: "Zeratul", role: "MeleeAssassin" },
  { name: "Zul'jin", role: "RangedAssassin" },
];

async function main() {
  const queryClient = postgres(databaseUrl as string, { max: 1 });
  const db = drizzle(queryClient);

  try {
    const mapRows: NewMap[] = MAP_NAMES.map((name) => ({ id: slugify(name), name }));
    await db.insert(maps).values(mapRows).onConflictDoNothing();

    const heroRows: NewHero[] = HEROES.map(({ name, role }) => ({ id: slugify(name), name, role }));
    await db.insert(heroes).values(heroRows).onConflictDoNothing();

    console.log(`Seeded ${mapRows.length} maps and ${heroRows.length} heroes (existing rows were left untouched).`);
  } finally {
    await queryClient.end();
  }
}

await main();
