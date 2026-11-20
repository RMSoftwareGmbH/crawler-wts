import type {
  CrawlerLocator,
  CrawlerPage,
} from "../../../crawler-core/src/browser/pageFactory.js";

interface FixtureNode {
  tagName: string;
  attributes: Record<string, string>;
  innerHtml: string;
}

function decodeText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function attributes(source: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pattern = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (const match of source.matchAll(pattern)) {
    const key = match[1];
    if (key) {
      result[key] = match[2] ?? match[3] ?? match[4] ?? "";
    }
  }
  return result;
}

function matches(node: FixtureNode, selector: string): boolean {
  const tag = selector.match(/^[a-z][a-z0-9-]*/i)?.[0];
  if (tag && node.tagName.toLowerCase() !== tag.toLowerCase()) {
    return false;
  }

  const classes = [...selector.matchAll(/\.([a-z0-9_-]+)/gi)].map(
    (match) => match[1],
  );
  const actualClasses = (node.attributes.class ?? "").split(/\s+/);
  if (classes.some((className) => !actualClasses.includes(className ?? ""))) {
    return false;
  }

  for (const match of selector.matchAll(/\[([^\]]+)\]/g)) {
    const attributeMatch = match[1]?.match(
      /^([^\s*=~^$|]+)(?:([*^]?=)["']?([^"']*)["']?)?$/,
    );
    const name = attributeMatch?.[1];
    if (!name || !(name in node.attributes)) {
      return false;
    }
    const operator = attributeMatch?.[2];
    const expected = attributeMatch?.[3] ?? "";
    const actual = node.attributes[name] ?? "";
    if (operator === "=" && actual !== expected) {
      return false;
    }
    if (operator === "*=" && !actual.includes(expected)) {
      return false;
    }
    if (operator === "^=" && !actual.startsWith(expected)) {
      return false;
    }
  }
  return true;
}

function findNodes(html: string, selector: string): FixtureNode[] {
  const selectors = selector.split(",").map((part) => part.trim());
  const found: FixtureNode[] = [];
  const stack: Array<{
    node: FixtureNode;
    contentStart: number;
    excluded: boolean;
  }> = [];
  const voidElements = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
  ]);
  const pattern = /<\/?([a-z][a-z0-9-]*)\b[^>]*>/gi;

  for (const match of html.matchAll(pattern)) {
    const tagName = match[1]?.toLowerCase();
    if (!tagName || match.index === undefined) {
      continue;
    }
    if (match[0].startsWith("</")) {
      const stackIndex = stack
        .map((entry) => entry.node.tagName)
        .lastIndexOf(tagName);
      if (stackIndex < 0) {
        continue;
      }
      const entry = stack[stackIndex];
      if (entry) {
        entry.node.innerHtml = html.slice(entry.contentStart, match.index);
      }
      stack.splice(stackIndex);
      continue;
    }

    const attributeSource = match[0]
      .slice(tagName.length + 1)
      .replace(/\/?>$/, "");
    const node: FixtureNode = {
      tagName,
      attributes: attributes(attributeSource),
      innerHtml: "",
    };
    const excluded =
      stack.some((entry) => entry.excluded) || tagName === "template";
    if (!excluded && selectors.some((item) => matches(node, item))) {
      found.push(node);
    }
    if (!voidElements.has(tagName) && !match[0].endsWith("/>")) {
      stack.push({
        node,
        contentStart: match.index + match[0].length,
        excluded,
      });
    }
  }
  return found;
}

class FixtureLocator implements CrawlerLocator {
  constructor(
    private readonly page: FixturePage,
    private readonly query: () => FixtureNode[],
  ) {}

  async count(): Promise<number> {
    return this.query().length;
  }

  nth(index: number): CrawlerLocator {
    return new FixtureLocator(this.page, () => {
      const node = this.query()[index];
      return node ? [node] : [];
    });
  }

  first(): CrawlerLocator {
    return this.nth(0);
  }

  locator(selector: string): CrawlerLocator {
    return new FixtureLocator(this.page, () =>
      this.query().flatMap((node) => findNodes(node.innerHtml, selector)),
    );
  }

  async getAttribute(name: string): Promise<string | null> {
    return this.query()[0]?.attributes[name] ?? null;
  }

  async textContent(): Promise<string | null> {
    const node = this.query()[0];
    return node ? decodeText(node.innerHtml) : null;
  }

  async innerText(): Promise<string> {
    return (await this.textContent()) ?? "";
  }

  async isVisible(): Promise<boolean> {
    const node = this.query()[0];
    return Boolean(
      node &&
      !("hidden" in node.attributes) &&
      node.attributes["aria-hidden"] !== "true",
    );
  }

  async click(): Promise<void> {
    const node = this.query()[0];
    if (node?.attributes["data-load-more"] !== undefined) {
      this.page.loadMore(node.attributes);
    }
    if (node) {
      this.page.clickNode(node);
    }
  }
}

export class FixturePage implements CrawlerPage {
  private currentUrl = "https://www.google.com/maps/place/example-hotel";
  reviewsClickCount = 0;
  reviewExpansionClickCount = 0;
  originalLanguageClickCount = 0;
  scrollCount = 0;
  waitDurations: number[] = [];

  constructor(
    private html: string,
    private readonly responseStatus = 200,
    private readonly finalUrl?: string,
  ) {}

  async goto(url: string): Promise<{ status(): number }> {
    this.currentUrl = this.finalUrl ?? url;
    return { status: () => this.responseStatus };
  }

  url(): string {
    return this.currentUrl;
  }

  async title(): Promise<string> {
    return (
      this.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? ""
    );
  }

  locator(selector: string): CrawlerLocator {
    return new FixtureLocator(this, () => findNodes(this.html, selector));
  }

  async waitForTimeout(timeout: number): Promise<void> {
    this.waitDurations.push(timeout);
  }

  async scrollFirstScrollable(selector: string): Promise<boolean> {
    const scrollable = findNodes(this.html, selector).find(
      (node) => node.attributes["data-scrollable"] === "true",
    );
    if (!scrollable || this.scrollCount >= 2) {
      return false;
    }
    this.scrollCount += 1;
    if (this.scrollCount === 1) {
      const reviewId = scrollable.attributes["data-next-review-id"];
      const rating = scrollable.attributes["data-next-rating"];
      const comment = scrollable.attributes["data-next-comment"];
      if (reviewId && rating && comment) {
        this.html = this.html.replace(
          /<\/section>/i,
          `<article data-review-id="${reviewId}"><span data-rating aria-label="${rating}"></span>` +
            `<span data-review-text>${comment}</span></article></section>`,
        );
      }
    }
    return true;
  }

  clickNode(node: FixtureNode): void {
    if (node.attributes["data-action"] === "open-reviews") {
      this.reviewsClickCount += 1;
      const reviewContent =
        this.html.match(
          /<template data-reviews-content>([\s\S]*?)<\/template>/i,
        )?.[1] ?? "";
      this.html = this.html.replace(
        /(<section\b[^>]*data-reviews-panel[^>]*)\s+hidden\b([^>]*>)([\s\S]*?)<\/section>/i,
        (_match, opening, closing) =>
          `${opening}${closing}${reviewContent}</section>`,
      );
      this.html = this.html.replace(
        /<template data-reviews-content>[\s\S]*?<\/template>/i,
        "",
      );
    }
    if (node.attributes["data-action"] === "expand-review") {
      this.reviewExpansionClickCount += 1;
      this.html = this.html.replace(
        /(<button\b[^>]*data-action="expand-review"[^>]*>)More<\/button>/i,
        "$1Less</button>",
      );
    }
    if (node.attributes["data-action"] === "show-original") {
      this.originalLanguageClickCount += 1;
      const originalText = node.attributes["data-original-text"] ?? "";
      const originalLanguage = node.attributes["data-original-language"] ?? "";
      this.html = this.html
        .replace(
          /(<span\b[^>]*data-review-text[^>]*\blang=")[^"]*(")/i,
          `$1${originalLanguage}$2`,
        )
        .replace(
          /(<span\b[^>]*data-review-text[^>]*>)[\s\S]*?(<\/span>)/i,
          `$1${originalText}$2`,
        )
        .replace(
          /(aria-label=")[^"]*(")(?=[^>]*data-action="show-original")/i,
          "$1عرض الترجمة$2",
        )
        .replace(
          /(<button\b[^>]*data-action="show-original"[^>]*>)[\s\S]*?(<\/button>)/i,
          "$1عرض الترجمة$2",
        );
    }
  }

  loadMore(buttonAttributes: Record<string, string>): void {
    const reviewId = buttonAttributes["data-next-review-id"];
    const rating = buttonAttributes["data-next-rating"];
    const comment = buttonAttributes["data-next-comment"];
    if (reviewId && rating && comment) {
      this.html = this.html.replace(
        /<\/body>/i,
        `<article data-review-id="${reviewId}"><span data-rating aria-label="${rating}"></span><span data-review-text>${comment}</span></article></body>`,
      );
    }
    this.html = this.html.replace(
      /<(?:button|a)\b[^>]*data-load-more[^>]*>[\s\S]*?<\/(?:button|a)>/i,
      "",
    );
  }
}
