import { mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * Mirrors packages/db/src/seed.ts's HEROES list (names only) -- keep in
 * sync when a new hero ships. One-off/rare script, not part of the app
 * runtime: downloads each hero's portrait once from Heroes-Profile into
 * this app's own public/ so the frontend never hotlinks raw.githubusercontent.com
 * (no uptime/rate-limit guarantee there) and never has to reconstruct a
 * source URL at request time.
 */
const HERO_NAMES = [
  "Abathur", "Alarak", "Alexstrasza", "Ana", "Anduin", "Anub'arak", "Artanis", "Arthas", "Auriel", "Azmodan",
  "Blaze", "Brightwing", "Cassia", "Chen", "Cho", "Chromie", "Deathwing", "Deckard", "Dehaka", "Diablo",
  "D.Va", "E.T.C.", "Falstad", "Fenix", "Gall", "Garrosh", "Gazlowe", "Genji", "Greymane", "Gul'dan",
  "Hanzo", "Hogger", "Illidan", "Imperius", "Jaina", "Johanna", "Junkrat", "Kael'thas", "Kel'Thuzad", "Kerrigan",
  "Kharazim", "Leoric", "Li Li", "Li-Ming", "Lt. Morales", "Lucio", "Lunara", "Maiev", "Malfurion", "Mal'Ganis",
  "Malthael", "Medivh", "Mei", "Mephisto", "Muradin", "Murky", "Nazeebo", "Nova", "Orphea", "Probius",
  "Qhira", "Ragnaros", "Raynor", "Rehgar", "Rexxar", "Samuro", "Sgt. Hammer", "Sonya", "Stitches", "Stukov",
  "Sylvanas", "Tassadar", "The Butcher", "The Lost Vikings", "Thrall", "Tracer", "Tychus", "Tyrael", "Tyrande", "Uther",
  "Valeera", "Valla", "Varian", "Xul", "Whitemane", "Yrel", "Zagara", "Zarya", "Zeratul", "Zul'jin",
];

const SOURCE_BASE = "https://raw.githubusercontent.com/Heroes-Profile/heroesprofile/develop/public/images/heroes";
const CONCURRENCY = 6;
const MAX_ATTEMPTS = 3;

/** Mirrors packages/db/src/seed.ts's slugify exactly -- this app's internal hero id, used as the mirrored filename. */
function internalSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Heroes-Profile's own filename convention: punctuation and spaces stripped entirely, no separator. Only ever used here, at mirror time -- never at runtime. */
function sourceSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Shells out to curl rather than using fetch(): Bun's fetch consistently
// hits ECONNRESET through this environment's outbound proxy, while curl
// (which honors the same HTTPS_PROXY env var) downloads reliably.
async function downloadOne(url: string, destPath: string): Promise<boolean> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const proc = Bun.spawn(["curl", "-sS", "-f", "-o", destPath, url], { stderr: "pipe" });
    const exitCode = await proc.exited;
    if (exitCode === 0) return true;
    if (attempt === MAX_ATTEMPTS) {
      const stderr = (await new Response(proc.stderr).text()).trim();
      console.warn(`  ! ${url} failed after ${MAX_ATTEMPTS} attempts: ${stderr}`);
      return false;
    }
    await sleep(500 * attempt);
  }
  return false;
}

async function mirrorHero(destRoot: string, name: string): Promise<{ name: string; square: boolean; circular: boolean }> {
  const src = sourceSlug(name);
  const dest = internalSlug(name);
  const [square, circular] = await Promise.all([
    downloadOne(`${SOURCE_BASE}/${src}.png`, path.join(destRoot, "square", `${dest}.png`)),
    downloadOne(`${SOURCE_BASE}/circular/${src}.png`, path.join(destRoot, "circular", `${dest}.png`)),
  ]);
  return { name, square, circular };
}

async function main() {
  const destRoot = path.join(process.cwd(), "public", "images", "heroes");
  await mkdir(path.join(destRoot, "square"), { recursive: true });
  await mkdir(path.join(destRoot, "circular"), { recursive: true });

  const results: { name: string; square: boolean; circular: boolean }[] = [];
  for (let i = 0; i < HERO_NAMES.length; i += CONCURRENCY) {
    const batch = HERO_NAMES.slice(i, i + CONCURRENCY);
    results.push(...(await Promise.all(batch.map((name) => mirrorHero(destRoot, name)))));
  }

  const failed = results.filter((r) => !r.square || !r.circular);
  console.log(`Mirrored ${results.length - failed.length}/${results.length} heroes (both variants) into ${destRoot}`);
  if (failed.length > 0) {
    console.warn("Missing at least one variant for:");
    for (const r of failed) {
      console.warn(`  - ${r.name}: square=${r.square} circular=${r.circular}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
