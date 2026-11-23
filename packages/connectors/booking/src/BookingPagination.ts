import type { CrawlerPage } from "../../../crawler-core/src/browser/pageFactory.js";
import {
  BookingSelectors as S,
  bookingSelectorList,
} from "./BookingSelectors.js";

export class BookingPagination {
  async next(page: CrawlerPage): Promise<boolean> {
    const controls = page.locator(bookingSelectorList(S.nextPage));
    for (let index = 0; index < (await controls.count()); index += 1) {
      const control = controls.nth(index);
      if (!(await control.isVisible())) continue;
      if (
        (await control.getAttribute("disabled")) !== null ||
        (await control.getAttribute("aria-disabled")) === "true"
      ) {
        continue;
      }
      await control.click({ timeout: 5_000 });
      return true;
    }
    return false;
  }
}
