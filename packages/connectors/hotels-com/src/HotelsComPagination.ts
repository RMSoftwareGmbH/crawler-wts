import type { CrawlerPage } from "../../../crawler-core/src/browser/pageFactory.js";
import {
  HotelsComSelectors as S,
  hotelsComSelectorList,
} from "./HotelsComSelectors.js";

export class HotelsComPagination {
  async next(page: CrawlerPage): Promise<boolean> {
    const controls = page.locator(hotelsComSelectorList(S.nextPage));
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
