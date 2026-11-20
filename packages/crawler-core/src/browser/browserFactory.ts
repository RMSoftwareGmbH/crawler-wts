import { chromium, type Browser, type BrowserContext } from "playwright";
import { CrawlError } from "../crawler/CrawlError.js";
import {
  createDecodoProxyConfiguration,
  type DecodoEnvironment,
} from "../proxy/decodoProvider.js";
import type {
  BrowserPool,
  BrowserSession,
  CrawlerPage,
} from "./pageFactory.js";

export interface BrowserFactoryOptions {
  proxyEnabled: boolean;
  locale?: string;
  headless?: boolean;
  optimizationEnabled?: boolean;
  environment?: DecodoEnvironment;
}

export function shouldAbortRequest(resourceType: string, value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    const analyticsHosts = [
      "google-analytics.com",
      "googletagmanager.com",
      "doubleclick.net",
    ];
    if (
      resourceType === "ping" &&
      analyticsHosts.some(
        (domain) => host === domain || host.endsWith(`.${domain}`),
      )
    ) {
      return true;
    }

    const googleMapsHost =
      /(^|\.)google\.[a-z.]+$/.test(host) ||
      [
        "googleusercontent.com",
        "gstatic.com",
        "googleapis.com",
        "ggpht.com",
      ].some((domain) => host === domain || host.endsWith(`.${domain}`));
    return (
      ["image", "media", "font"].includes(resourceType) && !googleMapsHost
    );
  } catch {
    return false;
  }
}

function acceptLanguageForLocale(locale: string): string {
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(locale)) {
    throw new CrawlError(
      "configuration_failure",
      "Google crawler locale must be a valid BCP-47 language tag.",
    );
  }
  const language = locale.split("-")[0];
  return locale.toLowerCase() === language?.toLowerCase()
    ? locale
    : `${locale},${language};q=0.9`;
}

function browserError(error: unknown, proxyEnabled: boolean): CrawlError {
  if (error instanceof CrawlError) {
    return error;
  }
  const message =
    error instanceof Error ? error.message : "Browser could not be started.";
  const classification =
    proxyEnabled &&
    /proxy|tunnel|ECONNREFUSED|ERR_PROXY/i.test(message)
      ? "proxy_failure"
      : "browser_failure";
  return new CrawlError(classification, message);
}

export async function createBrowserSession(
  options: BrowserFactoryOptions,
  browserOverride?: Browser,
): Promise<BrowserSession> {
  let browser = browserOverride;
  const ownsBrowser = browserOverride === undefined;
  try {
    if (!browser) {
      const environment = options.environment ?? process.env;
      const proxy = options.proxyEnabled
        ? createDecodoProxyConfiguration(environment)
        : undefined;
      browser = await chromium.launch({
        headless: options.headless ?? true,
        ...(proxy ? { proxy } : {}),
      });
    }
    const launchedBrowser = browser;

    let context: BrowserContext | undefined;
    try {
      const locale =
        options.locale ?? process.env.GOOGLE_CRAWLER_LOCALE ?? "en-US";
      context = await launchedBrowser.newContext({
        locale,
        extraHTTPHeaders: {
          "Accept-Language": acceptLanguageForLocale(locale),
        },
      });
      const abortedResourceTypes = new Set<string>();
      if (options.optimizationEnabled) {
        await context.route("**/*", async (route) => {
          const request = route.request();
          const resourceType = request.resourceType();
          if (shouldAbortRequest(resourceType, request.url())) {
            abortedResourceTypes.add(resourceType);
            await route.abort();
            return;
          }
          await route.continue();
        });
      }
      const browserPage = await context.newPage();
      const activeContext = context;
      const page: CrawlerPage = {
        goto: (url, navigationOptions) =>
          browserPage.goto(url, navigationOptions),
        url: () => browserPage.url(),
        title: () => browserPage.title(),
        locator: (selector) => browserPage.locator(selector),
        waitForTimeout: (timeout) => browserPage.waitForTimeout(timeout),
        scrollFirstScrollable: (selector) =>
          browserPage.evaluate((panelSelector) => {
            const roots = Array.from(
              document.querySelectorAll<HTMLElement>(panelSelector),
            );
            const cards = roots.flatMap((root) =>
              Array.from(
                root.querySelectorAll<HTMLElement>(
                  '[data-review-id], [data-reviewid], [data-review-card], .jftiEf',
                ),
              ),
            );
            for (const card of cards) {
              let candidate: HTMLElement | null = card;
              while (candidate) {
                const overflowY =
                  window.getComputedStyle(candidate).overflowY;
                if (
                  /^(auto|scroll|overlay)$/.test(overflowY) &&
                  candidate.scrollHeight > candidate.clientHeight + 1
                ) {
                  candidate.scrollBy({
                    top: Math.max(
                      250,
                      Math.floor(candidate.clientHeight * 0.8),
                    ),
                  });
                  return true;
                }
                if (roots.includes(candidate)) {
                  break;
                }
                candidate = candidate.parentElement;
              }
            }
            return false;
          }, selector),
      };
      return {
        page,
        abortedResourceTypes: () => [...abortedResourceTypes],
        diagnosticSnapshot: async () =>
          browserPage.evaluate(() => {
            const snapshot = document.documentElement.cloneNode(
              true,
            ) as HTMLElement;
            snapshot
              .querySelectorAll(
                "script,style,noscript,iframe,canvas,form,input,textarea,select,button",
              )
              .forEach((element) => element.remove());
            snapshot.querySelectorAll("*").forEach((element) => {
              for (const attribute of Array.from(element.attributes)) {
                if (attribute.name === "class" || attribute.name === "role") {
                  continue;
                }
                if (attribute.name.startsWith("on")) {
                  element.removeAttribute(attribute.name);
                } else {
                  element.setAttribute(attribute.name, "[redacted]");
                }
              }
            });
            const walker = document.createTreeWalker(
              snapshot,
              NodeFilter.SHOW_TEXT,
            );
            let textNode = walker.nextNode();
            while (textNode) {
              if (textNode.textContent?.trim()) {
                textNode.textContent = "[redacted]";
              }
              textNode = walker.nextNode();
            }
            const comments = document.createTreeWalker(
              snapshot,
              NodeFilter.SHOW_COMMENT,
            );
            let comment = comments.nextNode();
            while (comment) {
              const nextComment = comments.nextNode();
              comment.parentNode?.removeChild(comment);
              comment = nextComment;
            }
            return `<!doctype html>${snapshot.outerHTML}`.slice(0, 50_000);
          }),
        diagnosticScreenshot: async (path, maskedSelectors) => {
          await browserPage.screenshot({
            path,
            fullPage: false,
            mask: [
              ...maskedSelectors.map((selector) =>
                browserPage.locator(selector),
              ),
              browserPage.locator("img"),
            ],
            maskColor: "#000000",
          });
        },
        diagnosticReviewCardSnapshot: async (selector) =>
          browserPage.evaluate((reviewCardSelector) => {
            const ratingPattern =
              /\b(\d+(?:[.,]\d+)?)\s*(?:(?:out of|\/)\s*(\d+(?:[.,]\d+)?)(?:\s*(stars?|étoiles?))?|((?:stars?|étoiles?)))/i;
            const datePattern =
              /^(?:today|yesterday|\d+\s+(?:days?|weeks?|months?|years?)\s+ago|(?:il y a\s*)?\d+\s+(?:jours?|semaines?|mois|ans?|années?)|(?:قبل|منذ)\s*(?:[0-9٠-٩]+\s*)?(?:يوم|أيام|أسبوع|أسابيع|شهر|أشهر|سنة|سنوات))$/i;
            const candidate = Array.from(
              document.querySelectorAll(reviewCardSelector),
            ).find((element) => {
              if (!(element instanceof HTMLElement)) {
                return false;
              }
              const style = window.getComputedStyle(element);
              return (
                element.getClientRects().length > 0 &&
                style.display !== "none" &&
                style.visibility !== "hidden"
              );
            });
            if (!(candidate instanceof HTMLElement)) {
              return undefined;
            }

            const ancestors: string[] = [];
            let ancestor = candidate.parentElement;
            while (ancestor && ancestors.length < 8) {
              const details = [ancestor.tagName.toLowerCase()];
              const classes = Array.from(ancestor.classList);
              if (classes.length > 0) {
                details.push(`.${classes.join(".")}`);
              }
              const role = ancestor.getAttribute("role");
              if (
                role &&
                /^(?:dialog|main|region|list|listitem|feed|tabpanel)$/i.test(
                  role,
                )
              ) {
                details.push(`[role=${role}]`);
              }
              if (
                /^(?:reviews?|avis)$/i.test(
                  ancestor.getAttribute("aria-label") ?? "",
                )
              ) {
                details.push('[aria-label="Reviews/Avis"]');
              }
              const ancestorStyle = window.getComputedStyle(ancestor);
              if (
                ancestor.scrollHeight > ancestor.clientHeight &&
                /auto|scroll/i.test(ancestorStyle.overflowY)
              ) {
                details.push("[scrollable]");
              }
              ancestors.push(details.join(""));
              ancestor = ancestor.parentElement;
            }

            const clone = candidate.cloneNode(true) as HTMLElement;
            clone
              .querySelectorAll(
                "script,style,noscript,iframe,canvas,form,input,textarea,select",
              )
              .forEach((element) => element.remove());
            const comments = document.createTreeWalker(
              clone,
              NodeFilter.SHOW_COMMENT,
            );
            let comment = comments.nextNode();
            while (comment) {
              const nextComment = comments.nextNode();
              comment.parentNode?.removeChild(comment);
              comment = nextComment;
            }

            for (const element of [
              clone,
              ...Array.from(clone.querySelectorAll("*")),
            ]) {
              for (const attribute of Array.from(element.attributes)) {
                const name = attribute.name.toLowerCase();
                const value = attribute.value;
                if (name === "class" || name === "role" || name === "lang") {
                  continue;
                }
                if (name === "data-review-id" || name === "data-reviewid") {
                  element.setAttribute(attribute.name, "[stable-id]");
                } else if (name === "href") {
                  try {
                    const path = new URL(value, location.href).pathname;
                    const safeSegments: string[] = [];
                    for (const segment of path.split("/")) {
                      if (!segment) {
                        continue;
                      }
                      safeSegments.push(
                        /^(?:maps|contrib|review|reviews|place|data)$/i.test(
                          segment,
                        )
                          ? segment
                          : "[segment]",
                      );
                    }
                    element.setAttribute(
                      attribute.name,
                      `[redacted-url:/${safeSegments.join("/")}]`,
                    );
                  } catch {
                    element.setAttribute(attribute.name, "[redacted-url]");
                  }
                } else if (name === "data-rating") {
                  const exactRating = value.trim().match(/^\d+(?:[.,]\d+)?$/);
                  const rating = value.match(ratingPattern);
                  element.setAttribute(
                    attribute.name,
                    exactRating?.[0] ??
                      (rating
                        ? `${rating[1]}${rating[2] ? ` out of ${rating[2]}` : ""}${rating[3] || rating[4] ? " stars" : ""}`
                        : "[redacted]"),
                  );
                } else if (
                  (name === "aria-label" || name === "title") &&
                  (/^\d+(?:[.,]\d+)?$/.test(value.trim()) ||
                    ratingPattern.test(value))
                ) {
                  const rating = value.match(ratingPattern);
                  element.setAttribute(
                    attribute.name,
                    value.trim().match(/^\d+(?:[.,]\d+)?$/)?.[0] ??
                      (rating
                        ? `${rating[1]}${rating[2] ? ` out of ${rating[2]}` : ""}${rating[3] || rating[4] ? " stars" : ""}`
                        : "[redacted]"),
                  );
                } else if (
                  (name === "datetime" || name === "data-review-date") &&
                  /^\d{4}-\d{2}-\d{2}(?:[t\s].*)?$/i.test(value.trim())
                ) {
                  continue;
                } else if (
                  (name === "aria-label" || name === "title") &&
                  datePattern.test(value.trim())
                ) {
                  continue;
                } else {
                  element.setAttribute(attribute.name, "[redacted]");
                }
              }
            }

            const walker = document.createTreeWalker(
              clone,
              NodeFilter.SHOW_TEXT,
            );
            let textNode = walker.nextNode();
            while (textNode) {
              const text = textNode.textContent?.trim() ?? "";
              const parent = textNode.parentElement;
              const ratingElement = parent?.closest(
                "[data-rating], [aria-label]",
              );
              const dateElement = parent?.closest("time, [data-review-date]");
              const ratingLabel =
                ratingElement?.getAttribute("data-rating") ??
                ratingElement?.getAttribute("aria-label") ??
                "";
              const exactTextRating = /^\d+(?:[.,]\d+)?$/.test(text);
              if (
                !dateElement &&
                !(
                  ratingElement &&
                  (exactTextRating || ratingPattern.test(ratingLabel))
                ) &&
                !exactTextRating &&
                !ratingPattern.test(text) &&
                !datePattern.test(text)
              ) {
                textNode.textContent = text ? "[redacted]" : "";
              }
              textNode = walker.nextNode();
            }

            const context =
              ancestors.length > 0
                ? `<!-- ancestor-context: ${ancestors.join(" > ")} -->\n`
                : "";
            return `${context}${clone.outerHTML}`.slice(0, 20_000);
          }, selector),
        close: async () => {
          try {
            await activeContext.close();
          } finally {
            if (ownsBrowser) {
              await launchedBrowser.close();
            }
          }
        },
      };
    } catch (error) {
      if (context) {
        await context.close();
      }
      if (ownsBrowser) {
        await launchedBrowser.close();
      }
      throw error;
    }
  } catch (error) {
    throw browserError(error, options.proxyEnabled);
  }
}


export async function createBrowserPool(
  options: BrowserFactoryOptions,
): Promise<BrowserPool> {
  try {
    const environment = options.environment ?? process.env;
    const proxy = options.proxyEnabled
      ? createDecodoProxyConfiguration(environment)
      : undefined;
    const browser = await chromium.launch({
      headless: options.headless ?? true,
      ...(proxy ? { proxy } : {}),
    });
    const { locale: _locale, ...launchOptions } = options;
    return {
      createSession: async (sessionOptions = {}) =>
        createBrowserSession(
          { ...launchOptions, ...sessionOptions },
          browser,
        ),
      close: () => browser.close(),
    };
  } catch (error) {
    throw browserError(error, options.proxyEnabled);
  }
}
