import type { Page } from "playwright";

export interface CrawlerLocator {
  count(): Promise<number>;
  nth(index: number): CrawlerLocator;
  first(): CrawlerLocator;
  locator(selector: string): CrawlerLocator;
  getAttribute(name: string): Promise<string | null>;
  textContent(): Promise<string | null>;
  innerText(): Promise<string>;
  isVisible(): Promise<boolean>;
  click(options?: { timeout?: number }): Promise<void>;
}

export interface CrawlerPage {
  goto(
    url: string,
    options?: {
      timeout?: number;
      waitUntil?: "domcontentloaded" | "load" | "networkidle" | "commit";
    },
  ): Promise<unknown>;
  url(): string;
  title(): Promise<string>;
  locator(selector: string): CrawlerLocator;
  waitForTimeout(timeout: number): Promise<void>;
  scrollFirstScrollable(selector: string): Promise<boolean>;
  evaluate?: Page["evaluate"];
  mouse?: Pick<Page["mouse"], "move" | "wheel">;
}

export interface BrowserSession {
  page: CrawlerPage;
  abortedResourceTypes?(): string[];
  diagnosticSnapshot?(): Promise<string>;
  diagnosticScreenshot?(
    path: string,
    maskedSelectors: readonly string[],
  ): Promise<void>;
  diagnosticReviewCardSnapshot?(selector: string): Promise<string | undefined>;
  close(): Promise<void>;
}

export interface BrowserPool {
  createSession(options?: { locale?: string }): Promise<BrowserSession>;
  close(): Promise<void>;
}
