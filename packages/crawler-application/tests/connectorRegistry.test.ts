import { describe, expect, it } from "vitest";
import { reviewSources } from "../../crawler-contracts/src/source/sourceType.js";
import {
  createReviewConnector,
  isReviewSource,
  supportedReviewSources,
} from "../src/connectorRegistry.js";

describe("connector registry", () => {
  it("registers exactly the six supported review sources", () => {
    expect(supportedReviewSources()).toEqual(reviewSources);
    for (const source of reviewSources) {
      expect(isReviewSource(source)).toBe(true);
      expect(typeof createReviewConnector(source).crawl).toBe("function");
    }
  });

  it("rejects unknown source identifiers", () => {
    expect(isReviewSource("unknown")).toBe(false);
  });
});
