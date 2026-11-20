/// <reference lib="dom" />
import type { CrawlerPage } from "../../../crawler-core/src/browser/pageFactory.js";

/**
 * Locates the element that actually scrolls the review list and scrolls it.
 *
 * A candidate must (a) contain visible review cards, (b) be visible with
 * clientHeight > 0, (c) have scrollHeight > clientHeight, (d) not be the
 * document body/html. The candidate containing the most cards wins; the
 * innermost wins ties, so the outer page shell loses to the review list.
 * There is deliberately no selector-based fallback: if no ancestor of the
 * cards qualifies, nothing is selected and the ancestor chain is reported.
 */

export const SCROLL_ROOT_MARKER = "data-crawler-scroll-root";

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** Metrics plus whether the element is still attached and rendered. */
export interface RootState extends ScrollMetrics {
  visible: boolean;
}

/** Structural diagnostics only: no text content, no URLs. */
export interface ScrollRootCandidate extends ScrollMetrics {
  tag: string;
  role: string;
  ariaLabel: string;
  className: string;
  scrollable: boolean;
  cardCount: number;
}

export interface AncestorInfo extends ScrollRootCandidate {
  overflowY: string;
  visible: boolean;
}

export interface ScrollRootSelection {
  found: boolean;
  /** Visible review cards the selection was based on. */
  visibleCardCount: number;
  candidates: ScrollRootCandidate[];
  selected?: ScrollRootCandidate;
  /** Ancestors of the first visible card; only filled when nothing qualified. */
  ancestorChain: AncestorInfo[];
}

export interface ScrollStepResult {
  before: ScrollMetrics;
  after: RootState;
}

/** The Playwright page exposes these; wrappers/fakes may not. */
export type EvaluablePage = CrawlerPage &
  Required<Pick<CrawlerPage, "evaluate" | "mouse">>;

export function supportsDomScrolling(
  page: CrawlerPage,
): page is EvaluablePage {
  return (
    typeof page.evaluate === "function" &&
    typeof page.mouse?.move === "function" &&
    typeof page.mouse?.wheel === "function"
  );
}

interface RawSelection {
  visibleCardCount: number;
  candidates: ScrollRootCandidate[];
  selectedIndex: number;
  ancestorChain: AncestorInfo[];
}

export async function selectScrollRoot(
  page: EvaluablePage,
  cardSelector: string,
): Promise<ScrollRootSelection> {
  const raw = await page.evaluate(
    (arg: { cardSelector: string; marker: string }): RawSelection => {
      for (const stale of Array.from(document.querySelectorAll(`[${arg.marker}]`))) {
        stale.removeAttribute(arg.marker);
      }
      const cards = Array.from(
        document.querySelectorAll(arg.cardSelector),
      ).filter((el) => {
        const style = getComputedStyle(el);
        return (
          el.getClientRects().length > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none"
        );
      });

      // Insertion order is innermost-first for the first card, so ties go to the innermost element.
      const counts = new Map<Element, number>();
      for (const card of cards) {
        let node = card.parentElement;
        while (node && node !== document.body && node !== document.documentElement) {
          const style = getComputedStyle(node);
          const overflowY = style.overflowY;
          if (
            (overflowY === "auto" ||
              overflowY === "scroll" ||
              overflowY === "overlay") &&
            node.getClientRects().length > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            node.clientHeight > 0 &&
            node.scrollHeight > node.clientHeight
          ) {
            counts.set(node, (counts.get(node) ?? 0) + 1);
          }
          node = node.parentElement;
        }
      }
      let chosen: Element | undefined;
      let best = 0;
      for (const [el, count] of counts) {
        if (count > best) {
          best = count;
          chosen = el;
        }
      }
      const listed = Array.from(counts.keys()).slice(0, 15);
      if (chosen && !listed.includes(chosen)) {
        listed.push(chosen);
      }
      if (chosen) {
        chosen.setAttribute(arg.marker, "1");
      }

      const ancestorChain: AncestorInfo[] = [];
      const firstCard = cards[0];
      if (!chosen && firstCard) {
        let node: Element | null = firstCard.parentElement;
        while (node && ancestorChain.length < 25) {
          const style = getComputedStyle(node);
          ancestorChain.push({
            tag: node.tagName.toLowerCase(),
            role: node.getAttribute("role") ?? "",
            ariaLabel: (node.getAttribute("aria-label") ?? "").slice(0, 80),
            className: (node.getAttribute("class") ?? "").slice(0, 200),
            scrollTop: node.scrollTop,
            scrollHeight: node.scrollHeight,
            clientHeight: node.clientHeight,
            scrollable: node.scrollHeight > node.clientHeight,
            cardCount: node.querySelectorAll(arg.cardSelector).length,
            overflowY: style.overflowY,
            visible:
              node.getClientRects().length > 0 &&
              style.visibility !== "hidden" &&
              style.display !== "none",
          });
          node = node.parentElement;
        }
      }
      return {
        visibleCardCount: cards.length,
        candidates: listed.map((el) => ({
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute("role") ?? "",
          ariaLabel: (el.getAttribute("aria-label") ?? "").slice(0, 80),
          className: (el.getAttribute("class") ?? "").slice(0, 200),
          scrollTop: el.scrollTop,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          scrollable: el.scrollHeight > el.clientHeight,
          cardCount: counts.get(el) ?? 0,
        })),
        selectedIndex: chosen ? listed.indexOf(chosen) : -1,
        ancestorChain,
      };
    },
    { cardSelector, marker: SCROLL_ROOT_MARKER },
  );

  const selected = raw.selectedIndex >= 0 ? raw.candidates[raw.selectedIndex] : undefined;
  return {
    found: Boolean(selected),
    visibleCardCount: raw.visibleCardCount,
    candidates: raw.candidates,
    ...(selected ? { selected } : {}),
    ancestorChain: raw.ancestorChain,
  };
}

/** Element scroll: scrollBy({ top: clientHeight * fraction }) on the marked root. */
export async function scrollRootBy(
  page: EvaluablePage,
  fraction: number,
): Promise<ScrollStepResult | undefined> {
  const result = await page.evaluate(
    (arg: { marker: string; fraction: number }) => {
      const el = document.querySelector(`[${arg.marker}]`);
      if (!el || !el.isConnected) {
        return null;
      }
      const before = {
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      };
      el.scrollBy({
        top: Math.max(1, Math.round(el.clientHeight * arg.fraction)),
        behavior: "auto",
      });
      return {
        before,
        after: {
          scrollTop: el.scrollTop,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          visible: el.getClientRects().length > 0,
        },
      };
    },
    { marker: SCROLL_ROOT_MARKER, fraction },
  );
  return result ?? undefined;
}

export async function readRootState(
  page: EvaluablePage,
): Promise<RootState | undefined> {
  const result = await page.evaluate(
    (arg: { marker: string }) => {
      const el = document.querySelector(`[${arg.marker}]`);
      return el && el.isConnected
        ? {
            scrollTop: el.scrollTop,
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
            visible: el.getClientRects().length > 0,
          }
        : null;
    },
    { marker: SCROLL_ROOT_MARKER },
  );
  return result ?? undefined;
}

/** One normal mouse-wheel scroll over the centre of the marked root. Fallback only. */
export async function wheelScrollRoot(
  page: EvaluablePage,
  fraction: number,
): Promise<boolean> {
  const target = await page.evaluate(
    (arg: { marker: string; fraction: number }) => {
      const el = document.querySelector(`[${arg.marker}]`);
      if (!el) {
        return null;
      }
      const rect = el.getBoundingClientRect();
      const x = Math.min(Math.max(rect.left + rect.width / 2, 1), window.innerWidth - 1);
      const y = Math.min(Math.max(rect.top + rect.height / 2, 1), window.innerHeight - 1);
      return { x, y, delta: Math.max(1, Math.round(el.clientHeight * arg.fraction)) };
    },
    { marker: SCROLL_ROOT_MARKER, fraction },
  );
  if (!target) {
    return false;
  }
  await page.mouse.move(target.x, target.y);
  await page.mouse.wheel(0, target.delta);
  return true;
}
