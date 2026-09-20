// Throwaway generator: renders a standalone, interactive preview of the
// chronology chart from a synthetic match, so the structure rows, the side
// bands and the hover card can be judged without a database. The data comes
// from the real helpers; only the DOM is hand-mirrored.
import { readFileSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import {
  buildMatchTimelineSeries,
  structureTypeLabel,
  timelineComparison,
  timelineLeadMax,
  timelineLeadY,
  timelineStructureLanes,
  timelineStructureMarkers,
  timelineStructureSideLabel,
  timelineTeamLabels,
  timelineX,
  type MatchTimelineInput,
} from "~/composables/useMatchTimelineSeries";

const NL = String.fromCharCode(10);
const DURATION = 1320;
const TRACK_LEFT = 132;
const TRACK_WIDTH = 660;
const LEAD_TOP = 22;
const LEAD_BOTTOM = 134;
const LEAD_MID = (LEAD_TOP + LEAD_BOTTOM) / 2;
const LEAD_HALF = (LEAD_BOTTOM - LEAD_TOP) / 2;
const LANES_TOP = 158;
const LANES_HEIGHT = 168;
const LANES_BOTTOM = LANES_TOP + LANES_HEIGHT;
const STRUCTURE_TOP = 330;
const STRUCTURE_ROW_HEIGHT = 15;
const STRUCTURE_MARKER_SIZE = 9;
const STRUCTURE_MARKER_SLOT_STEP = 11;
const ALLY = "rgb(59, 130, 246)";
const ENEMY = "rgb(239, 68, 68)";

function clock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return mm + ":" + (ss < 10 ? "0" : "") + ss;
}

const allyTeam: 0 | 1 = 0;
const labels = timelineTeamLabels(allyTeam);
const color0 = allyTeam === 1 ? ENEMY : ALLY;
const color1 = allyTeam === 1 ? ALLY : ENEMY;
const colorFor = (team: 0 | 1): string => (team === 0 ? color0 : color1);

const players = [
  { battletag: "Moi#1", team: 0, heroName: "Muradin" },
  { battletag: "Allie#2", team: 0, heroName: "Valla" },
  { battletag: "Allie#3", team: 0, heroName: "Jaina" },
  { battletag: "Allie#4", team: 0, heroName: "Rexxar" },
  { battletag: "Allie#5", team: 0, heroName: "Uther" },
  { battletag: "Ennemi#1", team: 1, heroName: "Diablo" },
  { battletag: "Ennemi#2", team: 1, heroName: "Nova" },
  { battletag: "Ennemi#3", team: 1, heroName: "Kael Thas" },
  { battletag: "Ennemi#4", team: 1, heroName: "Arthas" },
  { battletag: "Ennemi#5", team: 1, heroName: "Lucio" },
];

const allyLevels = [70, 160, 250, 340, 430, 520, 610, 700, 790, 880, 970, 1060, 1150];
const enemyLevels = [60, 150, 235, 320, 410, 495, 585, 690, 810, 940, 1080];
const levelSnapshots: { battletag: string; atSeconds: number; level: number }[] = [];
for (const player of players) {
  const times = player.team === 0 ? allyLevels : enemyLevels;
  times.forEach((atSeconds, index) => {
    levelSnapshots.push({ battletag: player.battletag, atSeconds: atSeconds, level: index + 2 });
  });
}

const deathPlan: Record<string, number[]> = {
  "Moi#1": [128, 372, 645, 902],
  "Allie#2": [131, 540, 651, 1104],
  "Allie#3": [255, 398, 760, 1002],
  "Allie#4": [129, 505, 880],
  "Allie#5": [260, 646, 908, 1180],
  "Ennemi#1": [180, 366, 500, 900, 1205],
  "Ennemi#2": [185, 370, 656, 1110],
  "Ennemi#3": [258, 395, 764, 1008],
  "Ennemi#4": [130, 498, 884, 1184],
  "Ennemi#5": [262, 650, 905],
};
const deaths: { battletag: string; team: 0 | 1; atSeconds: number; killers: string[]; killType: "hero" | "other" }[] = [];
for (const player of players) {
  const enemies = players.filter((other) => other.team !== player.team);
  for (const atSeconds of deathPlan[player.battletag] ?? []) {
    const killer = enemies[atSeconds % enemies.length]!;
    deaths.push({
      battletag: player.battletag,
      team: player.team as 0 | 1,
      atSeconds: atSeconds,
      killers: [killer.battletag],
      killType: "hero",
    });
  }
}

const structureEvents = [
  { team: 1, atSeconds: 305, structureType: "tower" },
  { team: 0, atSeconds: 425, structureType: "gate" },
  { team: 1, atSeconds: 600, structureType: "tower" },
  { team: 1, atSeconds: 600, structureType: "tower" },
  { team: 1, atSeconds: 655, structureType: "bastion" },
  { team: 0, atSeconds: 760, structureType: "bastion" },
  { team: 1, atSeconds: 905, structureType: "bastion" },
  { team: 0, atSeconds: 1185, structureType: "gate" },
  { team: 1, atSeconds: 1255, structureType: "core" },
];

const input: MatchTimelineInput = {
  timeline: { deaths: deaths, levelSnapshots: levelSnapshots, structureEvents: structureEvents },
  players: players,
  durationSeconds: DURATION,
  myBattletags: ["Moi#1"],
};
const series = buildMatchTimelineSeries(input);
const trackX = (seconds: number): number => TRACK_LEFT + timelineX(seconds, DURATION, TRACK_WIDTH);

const leadMax = timelineLeadMax(series.points);
const curve = series.points.map((point) => ({
  x: trackX(point.atSeconds),
  y: timelineLeadY(point.lead, leadMax, LEAD_MID, LEAD_HALF),
}));
const polyline = curve.map((point) => point.x + "," + point.y).join(" ");
const area =
  curve.length > 0
    ? "M " + curve[0]!.x + "," + LEAD_MID + " L " + curve.map((point) => point.x + "," + point.y).join(" L ") +
      " L " + curve[curve.length - 1]!.x + "," + LEAD_MID + " Z"
    : "";

const tickStep = DURATION <= 360 ? 30 : DURATION <= 900 ? 60 : DURATION <= 2400 ? 120 : 300;
const ticks: { x: number; label: string }[] = [];
for (let seconds = 0; seconds <= DURATION; seconds += tickStep) ticks.push({ x: trackX(seconds), label: clock(seconds) });

const laneRows = series.lanes.map((lane, index) => ({
  lane: lane,
  y: LANES_TOP + index * (LANES_HEIGHT / series.lanes.length),
  height: LANES_HEIGHT / series.lanes.length,
  color: colorFor(lane.team),
}));

const structureLanes = timelineStructureLanes(allyTeam, labels);
const markers = timelineStructureMarkers(series.structures, { startSeconds: 0, endSeconds: DURATION });
const structureRows = structureLanes.map((lane, index) => {
  const y = STRUCTURE_TOP + index * STRUCTURE_ROW_HEIGHT;
  const height = STRUCTURE_ROW_HEIGHT - 2;
  const center = y + height / 2;
  const color = colorFor(lane.team);
  const marks = markers
    .filter((marker) => marker.team === lane.team)
    .map((marker) => {
      const size = marker.structureType === "core" ? STRUCTURE_MARKER_SIZE + 3 : STRUCTURE_MARKER_SIZE;
      const raw = trackX(marker.atSeconds) + marker.slot * STRUCTURE_MARKER_SLOT_STEP;
      const x = Math.min(TRACK_LEFT + TRACK_WIDTH - size / 2, Math.max(TRACK_LEFT + size / 2, raw));
      return {
        x: x,
        y: center,
        size: size,
        color: color,
        type: marker.structureType,
        title: structureTypeLabel(marker.structureType) + " détruit, " + timelineStructureSideLabel(marker.team, allyTeam),
      };
    });
  return { label: lane.label, color: color, y: y, height: height, labelY: center + 3, marks: marks };
});

const svg: string[] = [];
svg.push("<svg id='chart' viewBox='0 0 800 380' class='chart'>");
for (const tick of ticks) {
  svg.push("<line x1='" + tick.x + "' y1='22' x2='" + tick.x + "' y2='326' stroke='currentColor' stroke-opacity='0.5' />");
}
svg.push("<rect x='0' y='" + LEAD_TOP + "' width='6' height='" + LEAD_HALF + "' fill='" + color0 + "' fill-opacity='0.85' />");
svg.push("<rect x='0' y='" + LEAD_MID + "' width='6' height='" + LEAD_HALF + "' fill='" + color1 + "' fill-opacity='0.85' />");
svg.push("<text x='10' y='" + (LEAD_TOP + 14) + "' fill='" + color0 + "' font-size='10' font-weight='600'>" + labels.team0 + "</text>");
svg.push("<text x='10' y='" + (LEAD_TOP + 25) + "' fill='currentColor' fill-opacity='0.6' font-size='9'>en tête</text>");
svg.push("<text x='10' y='" + (LEAD_BOTTOM - 15) + "' fill='" + color1 + "' font-size='10' font-weight='600'>" + labels.team1 + "</text>");
svg.push("<text x='10' y='" + (LEAD_BOTTOM - 4) + "' fill='currentColor' fill-opacity='0.6' font-size='9'>en tête</text>");
svg.push("<text x='132' y='14' fill='currentColor' fill-opacity='0.6' font-size='10'>avance en niveaux</text>");
svg.push("<path d='" + area + "' class='brand' fill='currentColor' fill-opacity='0.14' />");
svg.push("<polyline points='" + polyline + "' fill='none' class='brand' stroke='currentColor' stroke-width='2' />");
for (const row of laneRows) {
  svg.push("<rect x='132' y='" + row.y + "' width='660' height='" + row.height + "' fill='" + row.color + "' fill-opacity='" + (row.lane.isMe ? 0.1 : 0.04) + "' />");
  svg.push("<line x1='132' y1='" + (row.y + row.height) + "' x2='792' y2='" + (row.y + row.height) + "' stroke='currentColor' stroke-opacity='0.35' />");
  svg.push("<text x='8' y='" + (row.y + row.height / 2 + 3) + "' font-size='" + (row.height >= 40 ? 12 : row.height >= 13 ? 10 : 7) + "' font-weight='" + (row.lane.isMe ? 600 : 400) + "' fill='" + row.color + "' fill-opacity='" + (row.lane.isMe ? 1 : 0.75) + "'>" + (row.lane.heroName ?? row.lane.battletag) + (row.lane.isMe ? " (moi)" : "") + "</text>");
  for (const death of row.lane.deaths) {
    const radius = row.height >= 40 ? 5 : row.height >= 13 ? 3.4 : 2.4;
    svg.push("<circle cx='" + trackX(death.atSeconds) + "' cy='" + (row.y + row.height / 2) + "' r='" + radius + "' fill='" + row.color + "' fill-opacity='0.85' stroke='rgba(0,0,0,0.6)' />");
  }
}
for (const row of structureRows) {
  svg.push("<rect x='132' y='" + row.y + "' width='660' height='" + row.height + "' fill='" + row.color + "' fill-opacity='0.07' />");
  svg.push("<line x1='132' y1='" + (row.y + row.height) + "' x2='792' y2='" + (row.y + row.height) + "' stroke='currentColor' stroke-opacity='0.35' />");
  svg.push("<text x='8' y='" + row.labelY + "' font-size='9' font-weight='600' fill='" + row.color + "' fill-opacity='0.9'>" + row.label + "</text>");
  for (const mark of row.marks) {
    const half = mark.size / 2;
    svg.push("<g transform='" + "translate(" + mark.x + " " + mark.y + ")" + "'>");
    svg.push("<rect x='" + -half + "' y='" + -half + "' width='" + mark.size + "' height='" + mark.size + "' fill='" + mark.color + "' fill-opacity='0.95' stroke='rgba(0,0,0,0.55)' />");
    if (mark.type === "tower") {
      svg.push("<rect x='" + (-half + 0.9) + "' y='" + (-half + 0.9) + "' width='1.7' height='2.7' fill='#e8edf7' />");
      svg.push("<rect x='-0.85' y='" + (-half + 0.9) + "' width='1.7' height='2.7' fill='#e8edf7' />");
      svg.push("<rect x='" + (half - 2.6) + "' y='" + (-half + 0.9) + "' width='1.7' height='2.7' fill='#e8edf7' />");
    } else if (mark.type === "gate") {
      svg.push("<path d='" + "M " + (1.6 - half) + " " + (half - 0.7) + " L " + (1.6 - half) + " 0 A " + (half - 1.6) + " " + (half - 1.6) + " 0 0 1 " + (half - 1.6) + " 0 L " + (half - 1.6) + " " + (half - 0.7) + "' fill='none' stroke='#e8edf7' stroke-width='1.3' />");
    } else if (mark.type === "core") {
      svg.push("<circle r='2.5' fill='none' stroke='#e8edf7' stroke-width='1.4' />");
    }
    svg.push("<title>" + mark.title + "</title></g>");
  }
}
svg.push("<line x1='" + trackX(600) + "' y1='18' x2='" + trackX(600) + "' y2='360' class='fg' stroke='currentColor' stroke-dasharray='3 3' />");
svg.push("<line x1='132' y1='360' x2='792' y2='360' stroke='currentColor' stroke-opacity='0.5' />");
for (const tick of ticks) {
  svg.push("<text x='" + tick.x + "' y='372' fill='currentColor' fill-opacity='0.6' font-size='10' text-anchor='middle'>" + tick.label + "</text>");
}
svg.push("</svg>");

const samples = [];
for (let seconds = 0; seconds <= DURATION; seconds += 3) {
  const comparison = timelineComparison(series, seconds, labels);
  samples.push({
    t: seconds,
    leader: comparison.leader,
    leadLabel: comparison.leadLabel,
    rows: comparison.rows.map((row) => ({ label: row.label, level: row.level, color: colorFor(row.team) })),
    structures: comparison.structures.map((event) => ({
      label: structureTypeLabel(event.structureType),
      side: timelineStructureSideLabel(event.team, allyTeam),
      color: colorFor(event.team),
    })),
    deaths: comparison.deaths.length,
  });
}

const runtime = readFileSync(new URL("./timeline-preview-runtime.js", import.meta.url), "utf8");
const script = "var samples = " + JSON.stringify(samples) + ";" + NL + runtime;

const html = [
  "<!doctype html>",
  "<html lang='fr'><head><meta charset='utf-8'>",
  "<title>Chronologie - aperçu du nouveau rendu</title>",
  "<style>",
  ":root { --bg: #0b1120; --surface: #131c31; --border: #2a3757; --fg: #e8edf7; --muted: #93a2c4; --brand: #4f8dff; }",
  "* { box-sizing: border-box; }",
  "body { margin: 0; padding: 24px; background: var(--bg); color: var(--fg); font: 13px/1.45 system-ui, sans-serif; }",
  ".page { max-width: 1080px; margin: 0 auto; }",
  "h1 { font-size: 18px; margin: 0 0 4px; }",
  "p.intro { color: var(--muted); margin: 0 0 18px; max-width: 78ch; }",
  ".panel { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 14px; }",
  "#wrap { position: relative; }",
  ".chart { width: 100%; height: auto; display: block; color: var(--border); }",
  ".chart .brand { color: var(--brand); }",
  ".chart .fg { color: var(--fg); }",
  "#card { position: absolute; z-index: 30; width: 238px; padding: 8px; border: 1px solid var(--border); border-radius: 8px; background: rgba(19,28,49,0.96); box-shadow: 0 10px 30px rgba(0,0,0,0.45); pointer-events: none; opacity: 0; transition: opacity .12s; }",
  "#card .head { display: flex; justify-content: space-between; gap: 8px; }",
  "#card .time { font-family: ui-monospace, monospace; font-weight: 600; }",
  "#card .levels { margin-top: 6px; }",
  "#card .row { display: flex; align-items: center; gap: 6px; }",
  "#card .dot { width: 10px; height: 10px; border-radius: 999px; flex: none; }",
  "#card .sq { width: 8px; height: 8px; border-radius: 2px; flex: none; }",
  "#card .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
  "#card .level { margin-left: auto; font-size: 15px; font-weight: 600; }",
  "#card .lead { margin-top: 6px; padding: 2px 6px; border: 1px solid; border-radius: 4px; font-size: 10px; font-weight: 500; }",
  "#card .events { margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--border); }",
  "#card .side { margin-left: auto; color: var(--muted); }",
  "#card .muted { color: var(--muted); margin: 2px 0 0; font-size: 11px; }",
  ".legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 12px; color: var(--muted); font-size: 11px; align-items: center; }",
  ".legend span { display: inline-flex; align-items: center; gap: 6px; }",
  ".legend i { display: inline-block; width: 8px; height: 8px; background: currentColor; opacity: .6; }",
  ".legend i.round { border-radius: 999px; }",
  ".legend i.square { border-radius: 2px; }",
  "</style></head><body><div class='page'>",
  "<h1>Chronologie - aperçu du nouveau rendu</h1>",
  "<p class='intro'>Partie fictive de 22 min. Les données viennent des vrais helpers (buildMatchTimelineSeries, timelineStructureMarkers, timelineComparison) ; seuls le DOM et les interactions sont reproduits. Survolez le graphe : le popover suit le curseur.</p>",
  "<div class='panel'><div id='wrap'>",
  svg.join(""),
  "<div id='card'></div>",
  "</div>",
  "<div class='legend'>",
  "<span><i class='round' style='color:" + color0 + "'></i>" + labels.team0 + " - une pastille = une mort</span>",
  "<span><i class='round' style='color:" + color1 + "'></i>" + labels.team1 + " - une pastille = une mort</span>",
  "<span><i class='square' style='color:" + color0 + "'></i>un carré = une structure détruite, sur la ligne de son camp</span>",
  "<span>bandes de gauche : moitié haute = qui mène au-dessus, moitié basse = qui mène en dessous</span>",
  "</div></div></div>",
  "<script>" + script + "</" + "script>",
  "</body></html>",
].join(NL);

writeFileSync(process.argv[2]!, html);
console.log("written " + process.argv[2] + " (" + html.length + " bytes, " + samples.length + " hover samples)");

// A PNG of the same SVG, for a quick self-review without a browser. resvg has
// no CSS, so the class-driven strokes all resolve to one light grey -- enough
// to check the geometry and the marker shapes.
if (process.argv[3]) {
  const inner = svg
    .join("")
    .replace("<svg id='chart' viewBox='0 0 800 380' class='chart'>", "")
    .replace("</svg>", "");
  const standalone =
    "<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='570' style='color:#94a3b8'>" +
    "<rect width='1200' height='570' fill='#0b1120' />" +
    inner +
    "</svg>";
  const rendered = new Resvg(standalone, { fitTo: { mode: "width", value: 1200 } });
  writeFileSync(process.argv[3]!, rendered.render().asPng());
  console.log("rendered " + process.argv[3]);
}
