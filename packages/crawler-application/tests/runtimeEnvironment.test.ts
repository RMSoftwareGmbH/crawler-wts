import { describe, expect, it } from "vitest";
import { loadRuntimeEnvironment } from "../src/runtimeEnvironment.js";

describe("runtime environment validation", () => {
  it("does not require MongoDB settings for dry-run operation", () => {
    expect(
      loadRuntimeEnvironment({ source: "booking", persist: false }, {}),
    ).toEqual({ proxyEnabled: false });
  });

  it("requires a valid proxy configuration only when proxying is enabled", () => {
    expect(() =>
      loadRuntimeEnvironment(
        { source: "booking", persist: false },
        { DECODO_PROXY_ENABLED: "true" },
      ),
    ).toThrow("Decodo proxy host and port must be configured");

    expect(
      loadRuntimeEnvironment(
        {
          source: "booking",
          persist: false,
          proxyEnabledOverride: false,
        },
        { DECODO_PROXY_ENABLED: "true" },
      ),
    ).toEqual({ proxyEnabled: false });
  });

  it("validates MongoDB configuration only for explicit persistence", () => {
    expect(() =>
      loadRuntimeEnvironment({ source: "google", persist: true }, {}),
    ).toThrow("MONGODB_URI is required");

    expect(
      loadRuntimeEnvironment(
        { source: "google", persist: true },
        {
          MONGODB_URI: "mongodb://localhost:27017",
          MONGODB_DB_NAME: "reviews_test",
        },
      ).mongoPersistenceConfig?.databaseName,
    ).toBe("reviews_test");
  });

  it("validates Google booleans, numeric settings, and locale without echoing values", () => {
    expect(() =>
      loadRuntimeEnvironment(
        { source: "google", persist: false },
        { GOOGLE_CRAWLER_INTERACT: "sometimes" },
      ),
    ).toThrow("GOOGLE_CRAWLER_INTERACT must be true or false.");
    expect(() =>
      loadRuntimeEnvironment(
        { source: "google", persist: false },
        { GOOGLE_CRAWLER_SETTLE_MS: "-1" },
      ),
    ).toThrow("GOOGLE_CRAWLER_SETTLE_MS must be a non-negative integer.");
    expect(() =>
      loadRuntimeEnvironment(
        { source: "booking", persist: false },
        { GOOGLE_CRAWLER_LOCALE: "not a locale" },
      ),
    ).toThrow("GOOGLE_CRAWLER_LOCALE must be a valid BCP-47 tag.");
  });
});
