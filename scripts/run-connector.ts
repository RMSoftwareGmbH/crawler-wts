import "dotenv/config";
import {
  CrawlAndPersistService,
  createReviewConnector,
  loadRuntimeEnvironment,
} from "../packages/crawler-application/src/index.js";
import { MongoClientProvider } from "../packages/review-persistence/src/mongoClientProvider.js";
import { ReviewPersistenceService } from "../packages/review-persistence/src/ReviewPersistenceService.js";
import type { CrawlAndPersistResult } from "../packages/crawler-application/src/CrawlAndPersistService.js";
import type { RuntimeEnvironment } from "../packages/crawler-application/src/runtimeEnvironment.js";
import { CONNECTOR_CLI_USAGE, parseConnectorCliArgs } from "./connectorCli.js";

function safeErrorMessage(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "Connector command failed.";
  return message
    .replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, "[database URI]")
    .replace(/https?:\/\/[^\s)"'<>]+/gi, "[URL]")
    .replace(
      /((?:password|token|cookie|authorization|secret|api[_-]?key)\s*[=:]\s*)[^\s&]+/gi,
      "$1[redacted]",
    )
    .slice(0, 500);
}

function hasFailure(results: readonly CrawlAndPersistResult[]): boolean {
  return results.some(
    (result) =>
      !result.crawlResult?.success ||
      Boolean(result.crawlFailure) ||
      Boolean(result.persistenceFailure) ||
      (result.persistenceResult?.failed ?? 0) > 0,
  );
}

async function main(): Promise<void> {
  let options: ReturnType<typeof parseConnectorCliArgs>;
  try {
    options = parseConnectorCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error(safeErrorMessage(error));
    console.error(CONNECTOR_CLI_USAGE);
    process.exitCode = 1;
    return;
  }

  let runtime: RuntimeEnvironment;
  try {
    const proxyEnabledOverride = options.requests[0]?.proxyEnabled;
    runtime = loadRuntimeEnvironment(
      {
        source: options.source,
        persist: options.persist,
        ...(proxyEnabledOverride !== undefined ? { proxyEnabledOverride } : {}),
      },
      process.env,
    );
  } catch (error) {
    console.error(safeErrorMessage(error));
    process.exitCode = 1;
    return;
  }

  let persistence: ReviewPersistenceService;
  let closePersistence: () => Promise<void> = async () => {};
  try {
    if (options.persist) {
      if (!runtime.mongoPersistenceConfig) {
        throw new Error(
          "MongoDB configuration is required when --persist is enabled.",
        );
      }
      const provider = new MongoClientProvider(runtime.mongoPersistenceConfig);
      const connected = await ReviewPersistenceService.connect(provider);
      persistence = connected.service;
      closePersistence = connected.close;
    } else {
      persistence = new ReviewPersistenceService();
    }

    const service = new CrawlAndPersistService(
      options.source,
      createReviewConnector(options.source),
      persistence,
    );
    let results;
    try {
      results =
        options.requests.length === 1
          ? [
              await service.run(options.requests[0]!, {
                persist: options.persist,
              }),
            ]
          : await service.runBatch(options.requests, {
              persist: options.persist,
            });
    } finally {
      await closePersistence();
    }

    const output = options.showPersistence
      ? results.length === 1
        ? results[0]
        : results
      : results.length === 1
        ? (results[0]?.crawlResult ?? results[0])
        : results.map((result) => result.crawlResult ?? result);
    console.log(JSON.stringify(output, null, 2));
    if (hasFailure(results)) process.exitCode = 1;
  } catch (error) {
    console.error(safeErrorMessage(error));
    process.exitCode = 1;
  }
}

void main();
