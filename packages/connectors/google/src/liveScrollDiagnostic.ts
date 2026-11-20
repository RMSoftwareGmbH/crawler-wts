/**
 * Live, headed diagnostic for the Google review scroll root. NOT part of `pnpm test`.
 *
 *   GOOGLE_DIAG_URL="https://www.google.com/maps/place/..." \
 *     pnpm tsx packages/connectors/google/scripts/liveScrollDiagnostic.ts
 *
 * Optional: GOOGLE_DIAG_HEADLESS=true, GOOGLE_DIAG_PAUSE_MS=30000 (time for a human to
 * handle a consent screen by hand; the script never bypasses consent or challenges).
 *
 * Exit codes: 0 = real scroll root with non-zero dimensions, scroll verified;
 *             1 = no valid scroll root / zero dimensions / nothing measurable;
 *             2 = consent, challenge or blocked page.
 */
import { chromium } from "playwright";
import { isFullReviewsLabel, normalizeUiLabel } from "../src/GoogleLabels.js";
import { GoogleSelectors, selectorList } from "../src/GoogleSelectors.js";
import {
  readRootState,
  scrollRootBy,
  selectScrollRoot,
  wheelScrollRoot,
  type EvaluablePage,
} from "../src/GoogleScrollRoot.js";

const url = process.env.GOOGLE_DIAG_URL;
if (!url) {
  console.error("Set GOOGLE_DIAG_URL to a Google Maps hotel URL.");
  process.exit(1);
}

const browser = await chromium.launch({
  headless: process.env.GOOGLE_DIAG_HEADLESS === "true",
});
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "load", timeout: 60_000 });
  await page.waitForTimeout(Number(process.env.GOOGLE_DIAG_PAUSE_MS ?? 3_000));

  const body = (await page.locator("body").innerText()).toLowerCase();
  if (
    /captcha|unusual traffic|before you continue|consent|sign in to continue/.test(body) ||
    /consent\.google|accounts\.google/.test(page.url())
  ) {
    console.error("Consent, challenge or sign-in page detected. Not bypassing.");
    process.exit(2);
  }

  const tab = page
    .getByRole("tab", { name: /^(?:reviews?|avis|المراجعات|التقييمات)/i })
    .first();
  if ((await tab.count()) > 0) {
    await tab.click();
    await page.waitForTimeout(1_500);
  }

  const buttons = page.locator('button, [role="button"]');
  const related: string[] = [];
  let fullReviewsClicked = false;
  for (let i = 0; i < (await buttons.count()); i += 1) {
    const button = buttons.nth(i);
    if (!(await button.isVisible())) continue;
    const text = normalizeUiLabel(
      `${(await button.getAttribute("aria-label")) ?? ""} ${await button.innerText()}`,
    );
    if (/review|avis|مراجع|تقييم/i.test(text)) related.push(text.slice(0, 80));
    if (!fullReviewsClicked && isFullReviewsLabel(text.trim())) {
      await button.click();
      fullReviewsClicked = true;
      await page.waitForTimeout(1_500);
    }
  }
  console.log("review-related controls:", related.slice(0, 15));
  console.log("full-reviews control clicked:", fullReviewsClicked);

  const evaluable = page as unknown as EvaluablePage;
  const selection = await selectScrollRoot(evaluable, selectorList(GoogleSelectors.reviewCards));
  console.log("visible cards:", selection.visibleCardCount);
  console.table(selection.candidates);
  if (!selection.selected) {
    console.error("FAIL: no scrollable ancestor of the review cards. Ancestor chain:");
    console.table(selection.ancestorChain);
    process.exit(1);
  }
  const root = selection.selected;
  console.log("selected root:", root);
  if (root.clientHeight <= 0 || root.scrollHeight <= root.clientHeight) {
    console.error("FAIL: selected root has no real scrollable range.");
    process.exit(1);
  }

  let verified = false;
  for (let step = 1; step <= 3; step += 1) {
    const result = await scrollRootBy(evaluable, 0.8);
    let method = "element";
    let after = result?.after;
    if (result && result.after.scrollTop <= result.before.scrollTop) {
      await wheelScrollRoot(evaluable, 0.8);
      await page.waitForTimeout(150);
      after = (await readRootState(evaluable)) ?? after;
      method = "wheel";
    }
    await page.waitForTimeout(1_500);
    after = (await readRootState(evaluable)) ?? after;
    const cards = await page.locator(selectorList(GoogleSelectors.reviewCards)).count();
    const moved =
      Boolean(result && after) &&
      (after!.scrollTop > result!.before.scrollTop ||
        after!.scrollHeight > result!.before.scrollHeight);
    verified ||= moved;
    console.log(`step ${step}`, { method, moved, before: result?.before, after, cards });
  }
  console.log(verified ? "PASS: real scroll verified." : "FAIL: nothing moved.");
  process.exit(verified ? 0 : 1);
} finally {
  await browser.close();
}
