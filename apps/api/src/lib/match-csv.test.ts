import { describe, expect, test } from "bun:test";
import {
  MATCH_EXPORT_COLUMNS,
  buildMatchCsv,
  buildMatchCsvHeader,
  capExportRows,
  escapeCsvField,
  matchExportCsvLine,
  toCsvLine,
  type MatchExportRow,
} from "./match-csv";

const row: MatchExportRow = {
  playedAt: new Date("2026-09-18T20:15:00.000Z"),
  mapName: "Garden of Terror",
  gameMode: "StormLeague",
  heroName: "Li-Ming",
  durationSeconds: 1234,
  winner: true,
  gameVersion: "2.55.15.96477",
};

describe("escapeCsvField", () => {
  test("passes plain values through", () => {
    expect(escapeCsvField("Li-Ming")).toBe("Li-Ming");
    expect(escapeCsvField(42)).toBe("42");
  });

  test("renders null and undefined as an empty field", () => {
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField(undefined)).toBe("");
  });

  test("quotes a field containing a comma", () => {
    expect(escapeCsvField("Tomb of the Spider Queen, ranked")).toBe('"Tomb of the Spider Queen, ranked"');
  });

  test("quotes a field containing a double quote and doubles it", () => {
    expect(escapeCsvField('Hero "The" Name')).toBe('"Hero ""The"" Name"');
  });

  test("quotes a field containing a line break", () => {
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvField("line1\r\nline2")).toBe('"line1\r\nline2"');
  });
});

describe("toCsvLine", () => {
  test("joins escaped fields with commas and terminates with CRLF", () => {
    expect(toCsvLine(["A", 'B,"C"', "D"])).toBe('A,"B,""C""",D\r\n');
  });
});

describe("match export rows", () => {
  test("header is the documented French column list", () => {
    expect(MATCH_EXPORT_COLUMNS).toEqual(["Date", "Carte", "Mode", "Héros", "Durée (s)", "Résultat", "Version"]);
    expect(buildMatchCsvHeader()).toBe("Date,Carte,Mode,Héros,Durée (s),Résultat,Version\r\n");
  });

  test("maps a row with a null version and a loss", () => {
    expect(matchExportCsvLine({ ...row, winner: false, gameVersion: null })).toBe(
      "2026-09-18T20:15:00.000Z,Garden of Terror,StormLeague,Li-Ming,1234,Défaite,\r\n",
    );
  });

  test("builds a full file: header then one CRLF record per row", () => {
    expect(buildMatchCsv([row, { ...row, mapName: "Cursed Hollow" }])).toBe(
      buildMatchCsvHeader() +
        "2026-09-18T20:15:00.000Z,Garden of Terror,StormLeague,Li-Ming,1234,Victoire,2.55.15.96477\r\n" +
        "2026-09-18T20:15:00.000Z,Cursed Hollow,StormLeague,Li-Ming,1234,Victoire,2.55.15.96477\r\n",
    );
  });

  test("a map or hero name with a comma or quote does not break the file", () => {
    const csv = buildMatchCsv([
      { ...row, mapName: 'Tomb of the Spider Queen "nuit", ranked', heroName: "E.T.C." },
    ]);
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe(
      '2026-09-18T20:15:00.000Z,"Tomb of the Spider Queen ""nuit"", ranked",StormLeague,E.T.C.,1234,Victoire,2.55.15.96477',
    );
  });
});

describe("capExportRows", () => {
  test("keeps a short list whole and reports no truncation", () => {
    expect(capExportRows([1, 2, 3], 5)).toEqual({ rows: [1, 2, 3], truncated: false });
  });

  test("keeps exactly the limit and reports truncation", () => {
    expect(capExportRows([1, 2, 3], 2)).toEqual({ rows: [1, 2], truncated: true });
  });

  test("a list exactly at the limit is not truncated", () => {
    expect(capExportRows([1, 2], 2)).toEqual({ rows: [1, 2], truncated: false });
  });
});
