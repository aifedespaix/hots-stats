import { describe, expect, test } from "bun:test";
import {
  authorizeInputSchema,
  buildCancelRedirectUrl,
  buildRedirectUrl,
  deriveCodeChallenge,
  isLoopbackRedirectUri,
  sanitizeDeviceName,
  verifyCodeChallenge,
} from "./daemon-auth";

// RFC 7636, Appendix B.
const RFC_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const RFC_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

describe("deriveCodeChallenge", () => {
  test("matches the RFC 7636 Appendix B vector", () => {
    expect(deriveCodeChallenge(RFC_VERIFIER)).toBe(RFC_CHALLENGE);
  });
});

describe("verifyCodeChallenge", () => {
  test("accepts the matching verifier", () => {
    expect(verifyCodeChallenge(RFC_VERIFIER, RFC_CHALLENGE)).toBe(true);
  });

  test("rejects a different verifier", () => {
    expect(verifyCodeChallenge("x".repeat(43), RFC_CHALLENGE)).toBe(false);
  });

  test("rejects a challenge of a different length without throwing", () => {
    expect(verifyCodeChallenge(RFC_VERIFIER, "short")).toBe(false);
  });
});

describe("isLoopbackRedirectUri", () => {
  test("accepts 127.0.0.1 with an explicit port", () => {
    expect(isLoopbackRedirectUri("http://127.0.0.1:51337/callback")).toBe(true);
  });

  test("accepts localhost with an explicit port", () => {
    expect(isLoopbackRedirectUri("http://localhost:8080/callback")).toBe(true);
  });

  test("rejects https", () => {
    expect(isLoopbackRedirectUri("https://127.0.0.1:51337/callback")).toBe(false);
  });

  test("rejects a non-loopback host", () => {
    expect(isLoopbackRedirectUri("http://evil.example.com:51337/callback")).toBe(false);
  });

  test("rejects a missing port", () => {
    expect(isLoopbackRedirectUri("http://127.0.0.1/callback")).toBe(false);
  });

  test("rejects a different path", () => {
    expect(isLoopbackRedirectUri("http://127.0.0.1:51337/steal")).toBe(false);
  });

  test("rejects a query or a hash", () => {
    expect(isLoopbackRedirectUri("http://127.0.0.1:51337/callback?x=1")).toBe(false);
    expect(isLoopbackRedirectUri("http://127.0.0.1:51337/callback#frag")).toBe(false);
  });

  test("rejects garbage", () => {
    expect(isLoopbackRedirectUri("not a url")).toBe(false);
  });
});

describe("buildRedirectUrl", () => {
  test("appends code and state", () => {
    expect(buildRedirectUrl("http://127.0.0.1:51337/callback", "abc", "state1234")).toBe(
      "http://127.0.0.1:51337/callback?code=abc&state=state1234",
    );
  });
});

describe("buildCancelRedirectUrl", () => {
  test("appends access_denied and state", () => {
    expect(buildCancelRedirectUrl("http://127.0.0.1:51337/callback", "state1234")).toBe(
      "http://127.0.0.1:51337/callback?error=access_denied&state=state1234",
    );
  });
});

describe("sanitizeDeviceName", () => {
  test("keeps letters, digits, spaces, dot, dash and underscore", () => {
    expect(sanitizeDeviceName("DESKTOP-ABC_1.local")).toBe("DESKTOP-ABC_1.local");
  });

  test("strips control and quote characters", () => {
    expect(sanitizeDeviceName('bad"name\n<svg>')).toBe("badnamesvg");
  });

  test("falls back to Daemon for empty or non-string input", () => {
    expect(sanitizeDeviceName("")).toBe("Daemon");
    expect(sanitizeDeviceName(undefined)).toBe("Daemon");
    expect(sanitizeDeviceName(42)).toBe("Daemon");
  });

  test("caps the length at 64 characters", () => {
    expect(sanitizeDeviceName("a".repeat(200)).length).toBe(64);
  });
});

describe("authorizeInputSchema", () => {
  const valid = {
    redirectUri: "http://127.0.0.1:51337/callback",
    state: "state1234",
    codeChallenge: RFC_CHALLENGE,
    codeChallengeMethod: "S256" as const,
  };

  test("accepts a valid body", () => {
    expect(authorizeInputSchema.safeParse(valid).success).toBe(true);
  });

  test("rejects a non-loopback redirectUri", () => {
    expect(
      authorizeInputSchema.safeParse({ ...valid, redirectUri: "https://example.com/callback" }).success,
    ).toBe(false);
  });

  test("rejects a method other than S256", () => {
    expect(authorizeInputSchema.safeParse({ ...valid, codeChallengeMethod: "plain" }).success).toBe(false);
  });

  test("rejects a too-short state", () => {
    expect(authorizeInputSchema.safeParse({ ...valid, state: "short" }).success).toBe(false);
  });
});
