import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { playerGoals } from "./player-goals";
import { users } from "./users";

describe("player_goals schema", () => {
  // AC3: deleting a goal can only ever cascade to nothing else -- the single
  // foreign key targets users, never matches/match_players.
  test("AC3: the only foreign key points at users with ON DELETE cascade", () => {
    const config = getTableConfig(playerGoals);
    expect(config.name).toBe("player_goals");
    expect(config.foreignKeys).toHaveLength(1);
    expect(config.foreignKeys[0]!.reference().foreignTable).toBe(users);
    expect(config.foreignKeys[0]!.onDelete).toBe("cascade");
  });
});
