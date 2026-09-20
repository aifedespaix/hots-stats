import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/** base64url of a SHA-256 digest: 43 characters, URL-safe alphabet. */
const BASE64URL_43_128 = /^[A-Za-z0-9_-]{43,128}$/;
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);

/**
 * The only redirect targets the consent page may hand a code back to: a
 * loopback address with an explicit port and exactly the /callback path.
 * Anything else could turn the consent page into an open redirect.
 */
export function isLoopbackRedirectUri(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return (
    url.protocol === "http:" &&
    LOOPBACK_HOSTNAMES.has(url.hostname) &&
    url.port !== "" &&
    url.pathname === "/callback" &&
    url.search === "" &&
    url.hash === ""
  );
}

/** RFC 7636 S256: base64url(SHA-256(ASCII(code_verifier))). */
export function deriveCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function verifyCodeChallenge(verifier: string, challenge: string): boolean {
  const derived = Buffer.from(deriveCodeChallenge(verifier));
  const expected = Buffer.from(challenge);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function generateAuthorizationCode(): string {
  return randomBytes(32).toString("base64url");
}

export function hashAuthorizationCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export function buildRedirectUrl(redirectUri: string, code: string, state: string): string {
  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  url.searchParams.set("state", state);
  return url.toString();
}

export function buildCancelRedirectUrl(redirectUri: string, state: string, error = "access_denied"): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("state", state);
  return url.toString();
}

/** Keeps a hostname safe as a display label and as part of a token name. */
export function sanitizeDeviceName(raw: unknown): string {
  const value = typeof raw === "string" ? raw : "";
  const cleaned = value
    .replace(/[^\p{L}\p{N} ._-]/gu, "")
    .trim()
    .slice(0, 64);
  return cleaned || "Daemon";
}

export const authorizeInputSchema = z.object({
  redirectUri: z
    .string()
    .min(1)
    .max(2048)
    .refine(
      isLoopbackRedirectUri,
      "redirectUri must be http://127.0.0.1:<port>/callback or http://localhost:<port>/callback",
    ),
  state: z.string().min(8).max(128),
  codeChallenge: z.string().regex(BASE64URL_43_128),
  codeChallengeMethod: z.literal("S256"),
  deviceName: z.string().max(128).optional(),
});

export const tokenExchangeInputSchema = z.object({
  code: z.string().min(16).max(256),
  codeVerifier: z.string().min(43).max(128),
});

export type AuthorizeInput = z.infer<typeof authorizeInputSchema>;
export type TokenExchangeInput = z.infer<typeof tokenExchangeInputSchema>;
