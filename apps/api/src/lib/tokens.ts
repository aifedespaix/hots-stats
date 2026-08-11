import { createHash, randomBytes } from "node:crypto";

const TOKEN_PREFIX = "hots_pat_";

export function generatePersonalAccessToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("hex")}`;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
