/**
 * Pure RFC-4180 CSV serialisation for the match export, kept free of any DB
 * import so it is testable without a DATABASE_URL (same "pure half" convention
 * as account-selection.ts). Column layout mirrors the on-screen /matches list;
 * values stay machine-readable (ISO date, raw game-mode enum, duration in
 * seconds) while the header row and the result column are French.
 */

/** One match row as read for the export -- the same columns as GET /matches. */
export interface MatchExportRow {
  playedAt: Date;
  mapName: string;
  gameMode: string;
  heroName: string;
  durationSeconds: number;
  winner: boolean;
  gameVersion: string | null;
}

/** Header cells, left to right. */
export const MATCH_EXPORT_COLUMNS = ["Date", "Carte", "Mode", "Héros", "Durée (s)", "Résultat", "Version"] as const;

/** Rows written per streamed chunk. Bounds one enqueue, not the export. */
export const MATCH_EXPORT_CHUNK_ROWS = 200;

/**
 * RFC-4180 field escaping: a value containing a comma, a double quote or a
 * line break is wrapped in double quotes and its inner quotes are doubled.
 * null/undefined become an empty field.
 */
export function escapeCsvField(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One CSV record, CRLF-terminated as RFC 4180 requires. */
export function toCsvLine(fields: readonly unknown[]): string {
  return `${fields.map(escapeCsvField).join(",")}\r\n`;
}

/** Maps one match row to its export cells, in MATCH_EXPORT_COLUMNS order. */
export function matchExportFields(row: MatchExportRow): string[] {
  return [
    row.playedAt.toISOString(),
    row.mapName,
    row.gameMode,
    row.heroName,
    String(row.durationSeconds),
    row.winner ? "Victoire" : "Défaite",
    row.gameVersion ?? "",
  ];
}

/** The CSV header row, CRLF-terminated. */
export function buildMatchCsvHeader(): string {
  return toCsvLine(MATCH_EXPORT_COLUMNS);
}

/** One match row, CRLF-terminated. */
export function matchExportCsvLine(row: MatchExportRow): string {
  return toCsvLine(matchExportFields(row));
}

/** The complete CSV file for a bounded row set (header + records). */
export function buildMatchCsv(rows: readonly MatchExportRow[]): string {
  return buildMatchCsvHeader() + rows.map(matchExportCsvLine).join("");
}

/**
 * Applies the server-side row cap. Returns the rows that fit together with a
 * truncation flag, so the route can report both in response headers.
 */
export function capExportRows<T>(rows: readonly T[], limit: number): { rows: T[]; truncated: boolean } {
  if (rows.length <= limit) return { rows: rows.slice(), truncated: false };
  return { rows: rows.slice(0, limit), truncated: true };
}
