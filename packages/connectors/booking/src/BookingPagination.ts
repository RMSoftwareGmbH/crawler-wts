import type { CrawlerLocator } from "../../../crawler-core/src/browser/pageFactory.js";
import {
  BookingSelectors as S,
  bookingSelectorList,
} from "./BookingSelectors.js";

export class BookingPagination {
  async next(
    panel: CrawlerLocator,
    timeoutMs: number,
  ): Promise<{ controlFound: boolean; clicked: boolean }> {
    const controls = panel.locator(bookingSelectorList(S.nextPage));
    let controlFound = false;
    for (let index = 0; index < (await controls.count()); index += 1) {
      const control = controls.nth(index);
      if (!(await control.isVisible())) continue;
      controlFound = true;
      if (
        (await control.getAttribute("disabled")) !== null ||
        (await control.getAttribute("aria-disabled")) === "true"
      ) {
        continue;
      }
      await control.click({ timeout: timeoutMs });
      return { controlFound: true, clicked: true };
    }
    return { controlFound, clicked: false };
  }
}
