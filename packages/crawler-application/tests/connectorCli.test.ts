import { describe, expect, it } from "vitest";
import { parseConnectorCliArgs } from "../../../scripts/connectorCli.js";

describe("connector CLI argument parsing", () => {
  it("parses supported flags and repeatable hotel URLs", () => {
    const parsed = parseConnectorCliArgs([
      "--connector",
      "expedia",
      "--url",
      "https://www.expedia.com/hotel/123/example",
      "--url",
      "https://www.expedia.com/hotel/456/other",
      "--max-pages",
      "3",
      "--max-reviews",
      "20",
      "--timeout",
      "15000",
      "--locale",
      "fr-FR",
      "--proxy",
      "--persist",
    ]);

    expect(parsed).toMatchObject({
      source: "expedia",
      persist: true,
      dryRun: false,
      showPersistence: true,
      requests: [
        {
          url: "https://www.expedia.com/hotel/123/example",
          maxPages: 3,
          maxReviews: 20,
          timeoutMs: 15_000,
          locale: "fr-FR",
          proxyEnabled: true,
        },
        {
          url: "https://www.expedia.com/hotel/456/other",
          maxPages: 3,
          maxReviews: 20,
          timeoutMs: 15_000,
          locale: "fr-FR",
          proxyEnabled: true,
        },
      ],
    });
  });

  it("defaults to dry-run and leaves proxy choice to the environment", () => {
    const parsed = parseConnectorCliArgs([
      "--connector",
      "google",
      "--url",
      "https://www.google.com/maps/place/example",
    ]);

    expect(parsed.persist).toBe(false);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.showPersistence).toBe(false);
    expect(parsed.requests[0]?.proxyEnabled).toBeUndefined();
  });

  it("accepts explicit dry-run and no-proxy options", () => {
    const parsed = parseConnectorCliArgs([
      "--connector",
      "tripadvisor",
      "--url",
      "https://www.tripadvisor.com/Hotel_Review-g1-d1-Reviews-Example.html",
      "--no-proxy",
      "--dry-run",
    ]);

    expect(parsed).toMatchObject({
      persist: false,
      dryRun: true,
      showPersistence: true,
      requests: [{ proxyEnabled: false }],
    });
  });

  it.each([
    [["--url", "https://example.com/hotel"], "--connector must be one of"],
    [["--connector", "google"], "--url must be provided"],
    [
      [
        "--connector",
        "google",
        "--url",
        "https://example.com",
        "--max-pages",
        "0",
      ],
      "--max-pages must be a positive integer",
    ],
    [
      [
        "--connector",
        "google",
        "--url",
        "https://example.com",
        "--proxy",
        "--no-proxy",
      ],
      "Choose either --proxy or --no-proxy",
    ],
    [
      [
        "--connector",
        "google",
        "--url",
        "https://example.com",
        "--persist",
        "--dry-run",
      ],
      "Choose either --persist or --dry-run",
    ],
    [
      [
        "--connector",
        "google",
        "--url",
        "https://example.com",
        "--locale",
        "bad locale",
      ],
      "--locale must be a valid BCP-47",
    ],
  ] as const)("rejects invalid CLI input", (args, message) => {
    expect(() => parseConnectorCliArgs(args)).toThrow(message);
  });
});
