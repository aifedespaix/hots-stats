#!/usr/bin/env bun
import { promoteUserToAdmin } from "../src/services/admin.service";

/**
 * `bun run promote-admin <identifier>` -- thin CLI wrapper around
 * `promoteUserToAdmin` (see `admin.service.ts`). `<identifier>` is the
 * user's id, battletag, or email. Deliberately a manual script, not part of
 * `db:seed`: seeding runs automatically in every environment, and granting
 * admin is a one-off action against one real account in one real database.
 */
async function main() {
  const identifier = process.argv[2];
  if (!identifier) {
    console.error("Usage: bun run promote-admin <id|battletag|email>");
    process.exit(1);
  }

  const user = await promoteUserToAdmin(identifier);
  if (!user) {
    console.error(`No user found matching ${JSON.stringify(identifier)}.`);
    process.exit(1);
  }

  console.log(`✓ ${user.displayName} (${user.battletag ?? user.email ?? user.id}) is now an admin.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
