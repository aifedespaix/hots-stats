import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { matchObjectiveEvents } from "./match-objective-events";
import { matchPlayers } from "./match-players";
import { matches } from "./matches";

describe("match_objective_events schema", () => {
  test("the only foreign key points at matches with ON DELETE cascade", () => {
    const config = getTableConfig(matchObjectiveEvents);
    expect(config.name).toBe("match_objective_events");
    expect(config.foreignKeys).toHaveLength(1);
    expect(config.foreignKeys[0]!.reference().foreignTable).toBe(matches);
    expect(config.foreignKeys[0]!.onDelete).toBe("cascade");
  });

  test("is keyed by match, never by match_player", () => {
    const config = getTableConfig(matchObjectiveEvents);
    const referenced = config.foreignKeys.map((fk) => fk.reference().foreignTable);
    expect(referenced).not.toContain(matchPlayers);
  });
});
