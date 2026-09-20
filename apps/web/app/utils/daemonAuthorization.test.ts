import { describe, expect, it } from "vitest";
import { buildCancelUrl, isPlausibleLoopbackRedirect, readAuthorizeParams } from "./daemonAuthorization";

const VALID = {
  redirectUri: "http://127.0.0.1:51337/callback",
  state: "state1234",
  codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  codeChallengeMethod: "S256",
  deviceName: "TEST-BOX",
};

describe("readAuthorizeParams", () => {
  it("accepts a complete query", () => {
    const result = readAuthorizeParams({ ...VALID });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.params.deviceName).toBe("TEST-BOX");
  });

  it("defaults a missing device name to Daemon", () => {
    const result = readAuthorizeParams({ ...VALID, deviceName: undefined });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.params.deviceName).toBe("Daemon");
  });

  it("rejects a missing state", () => {
    const result = readAuthorizeParams({ ...VALID, state: undefined });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-loopback redirect", () => {
    const result = readAuthorizeParams({ ...VALID, redirectUri: "https://example.com/callback" });
    expect(result.ok).toBe(false);
  });

  it("rejects a method other than S256", () => {
    const result = readAuthorizeParams({ ...VALID, codeChallengeMethod: "plain" });
    expect(result.ok).toBe(false);
  });

  it("rejects a malformed code challenge", () => {
    const result = readAuthorizeParams({ ...VALID, codeChallenge: "short" });
    expect(result.ok).toBe(false);
  });
});

describe("buildCancelUrl", () => {
  it("appends access_denied and the state", () => {
    expect(buildCancelUrl("http://127.0.0.1:51337/callback", "state1234")).toBe(
      "http://127.0.0.1:51337/callback?error=access_denied&state=state1234",
    );
  });
});

describe("isPlausibleLoopbackRedirect", () => {
  it("accepts a loopback callback with a port", () => {
    expect(isPlausibleLoopbackRedirect("http://localhost:8080/callback")).toBe(true);
  });

  it("rejects a missing port and a foreign host", () => {
    expect(isPlausibleLoopbackRedirect("http://127.0.0.1/callback")).toBe(false);
    expect(isPlausibleLoopbackRedirect("http://evil.test:8080/callback")).toBe(false);
  });
});
