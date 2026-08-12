import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(3001),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  // Publicly reachable URL of this API, used to build the Google OAuth redirect URI.
  API_PUBLIC_URL: z.string().url().default("http://localhost:3001"),
  // Domain attribute for the session cookie, e.g. ".mondomaine.fr". Required
  // whenever the web app and the API live on different subdomains of the
  // same parent domain — without it the cookie is scoped to the API's own
  // host only, so the web app's SSR (which forwards the browser's Cookie
  // header) never sees the session and keeps bouncing logged-in users back
  // to /login. Leave unset for same-host setups (e.g. local dev).
  COOKIE_DOMAIN: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  // Shared secret for the internal `/_internal/*` routes (e.g. quarantine
  // sample inspection) -- not tied to a user account, so it can't reuse
  // `authToken`/`authSession`. Not meant to be exposed to the daemon or web app.
  CLAUDE_INTERNAL_SECRET: z.string().min(32),
});

export const env = envSchema.parse(process.env);
