import { watch, type WatchStopHandle } from "vue";

/** A value a filter takes once parsed from the query string. */
export type UrlFilterValue = string | number | string[];

/** Query-string shape accepted by the parser (subset of vue-router LocationQuery). */
export type UrlQuery = Record<string, unknown>;

export type UrlFilterKind = "string" | "date" | "int" | "enum" | "csv";

export interface UrlFilterSpec {
  /** Store field name, used as the query-string key. */
  name: string;
  kind: UrlFilterKind;
  /** Allowed values for enum (whole value) and csv (each member). */
  allowed?: readonly string[];
  /** Maximum accepted length for string values. */
  maxLength?: number;
}

const DEFAULT_MAX_LENGTH = 64;
const MAX_CSV_MEMBERS = 100;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function readParam(query: UrlQuery, name: string): string | undefined {
  const raw = query[name];
  if (raw === undefined || raw === null) return undefined;
  if (Array.isArray(raw)) {
    const first = raw.find((value) => value !== null && value !== undefined);
    return first === undefined ? undefined : String(first);
  }
  return String(raw);
}

function parseParam(spec: UrlFilterSpec, raw: string): UrlFilterValue | undefined {
  const value = raw.trim();
  switch (spec.kind) {
    case "string":
      if (value.length === 0 || value.length > (spec.maxLength ?? DEFAULT_MAX_LENGTH)) return undefined;
      return value;
    case "date": {
      if (!ISO_DATE.test(value)) return undefined;
      return Number.isNaN(Date.parse(value + "T00:00:00Z")) ? undefined : value;
    }
    case "int": {
      if (!/^\d+$/.test(value)) return undefined;
      const parsed = Number(value);
      return parsed >= 1 ? parsed : undefined;
    }
    case "enum":
      return spec.allowed?.includes(value) ? value : undefined;
    case "csv": {
      const seen = new Set<string>();
      const members: string[] = [];
      for (const part of raw.split(",")) {
        const member = part.trim();
        if (member.length === 0 || seen.has(member)) continue;
        if (spec.allowed && !spec.allowed.includes(member)) continue;
        seen.add(member);
        members.push(member);
        if (members.length >= MAX_CSV_MEMBERS) break;
      }
      return members.length > 0 ? members : undefined;
    }
  }
}

function serializeParam(spec: UrlFilterSpec, value: unknown): string | undefined {
  switch (spec.kind) {
    case "string":
    case "date": {
      if (typeof value !== "string") return undefined;
      const trimmed = value.trim();
      if (trimmed.length === 0) return undefined;
      if (spec.kind === "date" && !ISO_DATE.test(trimmed)) return undefined;
      return trimmed;
    }
    case "int":
      if (typeof value !== "number" || !Number.isFinite(value) || value < 1) return undefined;
      return String(Math.trunc(value));
    case "enum":
      return typeof value === "string" && spec.allowed?.includes(value) ? value : undefined;
    case "csv": {
      if (!Array.isArray(value)) return undefined;
      const members = [
        ...new Set(
          value.filter((member): member is string => typeof member === "string" && member.trim().length > 0),
        ),
      ].sort();
      return members.length > 0 ? members.join(",") : undefined;
    }
  }
}

/** Two values are equal for the URL when they serialise identically. */
export function urlValuesEqual(spec: UrlFilterSpec, a: unknown, b: unknown): boolean {
  return serializeParam(spec, a) === serializeParam(spec, b);
}

/** Validate the URL filter params; unknown or malformed values are dropped. */
export function parseUrlFilters(query: UrlQuery, specs: readonly UrlFilterSpec[]): Record<string, UrlFilterValue> {
  const values: Record<string, UrlFilterValue> = {};
  for (const spec of specs) {
    const raw = readParam(query, spec.name);
    if (raw === undefined) continue;
    const parsed = parseParam(spec, raw);
    if (parsed !== undefined) values[spec.name] = parsed;
  }
  return values;
}

/** Serialise non-default values into a query object (all values are strings). */
export function buildUrlQuery(
  values: Record<string, unknown>,
  specs: readonly UrlFilterSpec[],
  defaults: Record<string, unknown>,
): Record<string, string> {
  const query: Record<string, string> = {};
  for (const spec of specs) {
    const serialized = serializeParam(spec, values[spec.name]);
    if (serialized === undefined) continue;
    if (serialized === serializeParam(spec, defaults[spec.name])) continue;
    query[spec.name] = serialized;
  }
  return query;
}

/** True when every managed param already matches desired (other params ignored). */
export function isSameUrlFilterQuery(
  current: UrlQuery,
  desired: Record<string, string>,
  specs: readonly UrlFilterSpec[],
): boolean {
  return specs.every((spec) => (readParam(current, spec.name) ?? undefined) === desired[spec.name]);
}

/** Current query with the managed params replaced by desired, unmanaged params preserved. */
export function mergeUrlFilterQuery(
  current: UrlQuery,
  desired: Record<string, string>,
  specs: readonly UrlFilterSpec[],
): Record<string, unknown> {
  const managed = new Set(specs.map((spec) => spec.name));
  const merged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(current)) {
    if (!managed.has(key)) merged[key] = value;
  }
  return { ...merged, ...desired };
}

export interface UrlFilterSyncOptions {
  specs: readonly UrlFilterSpec[];
  defaults: Record<string, unknown>;
  /** Current filter values keyed by spec name. */
  read: () => Record<string, unknown>;
  /** Apply validated values; only the keys that actually changed are passed. */
  write: (values: Record<string, UrlFilterValue>) => void;
  readQuery: () => UrlQuery;
  writeQuery: (query: Record<string, unknown>) => void;
}

export interface UrlFilterSync {
  /** URL -> stores. Returns every validated value found in the URL. */
  hydrate(): Record<string, UrlFilterValue>;
  /** Apply already-parsed values, writing only the keys that changed. */
  apply(values: Record<string, UrlFilterValue>): void;
  /** Stores -> URL. Returns true when the URL was rewritten. */
  project(): boolean;
  /** Watch the stores and project on every change. */
  start(): void;
  stop(): void;
}

export function createUrlFilterSync(options: UrlFilterSyncOptions): UrlFilterSync {
  let stopHandle: WatchStopHandle | undefined;

  function apply(values: Record<string, UrlFilterValue>) {
    const changed: Record<string, UrlFilterValue> = {};
    const current = options.read();
    for (const [name, value] of Object.entries(values)) {
      const spec = options.specs.find((candidate) => candidate.name === name);
      if (spec && !urlValuesEqual(spec, value, current[name])) changed[name] = value;
    }
    if (Object.keys(changed).length > 0) options.write(changed);
  }

  function hydrate() {
    const parsed = parseUrlFilters(options.readQuery(), options.specs);
    apply(parsed);
    return parsed;
  }

  function project(): boolean {
    const desired = buildUrlQuery(options.read(), options.specs, options.defaults);
    if (isSameUrlFilterQuery(options.readQuery(), desired, options.specs)) return false;
    options.writeQuery(mergeUrlFilterQuery(options.readQuery(), desired, options.specs));
    return true;
  }

  function start() {
    if (stopHandle) return;
    if (options.specs.length === 0) return;
    stopHandle = watch(() => options.read(), () => project());
  }

  function stop() {
    stopHandle?.();
    stopHandle = undefined;
  }

  return { hydrate, apply, project, start, stop };
}
