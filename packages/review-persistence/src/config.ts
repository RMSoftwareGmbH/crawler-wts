import { ReviewPersistenceError } from "./errors.js";

export interface MongoPersistenceConfig {
  uri: string;
  databaseName: string;
  maxPoolSize: number;
  serverSelectionTimeoutMS: number;
  connectTimeoutMS: number;
  retryWrites: boolean;
}

function requiredValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new ReviewPersistenceError(
      "configuration",
      `${name} is required when MongoDB persistence is enabled.`,
    );
  }
  return value;
}

function positiveInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: number,
): number {
  const raw = env[name]?.trim();
  if (!raw) {
    return defaultValue;
  }
  if (!/^\d+$/.test(raw)) {
    throw new ReviewPersistenceError(
      "configuration",
      `${name} must be a positive integer.`,
    );
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ReviewPersistenceError(
      "configuration",
      `${name} must be a positive integer.`,
    );
  }
  return value;
}

function retryWrites(env: NodeJS.ProcessEnv): boolean {
  const raw = env.MONGODB_RETRY_WRITES?.trim().toLowerCase();
  if (!raw) {
    return true;
  }
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  throw new ReviewPersistenceError(
    "configuration",
    "MONGODB_RETRY_WRITES must be true or false.",
  );
}

function validateUri(uri: string): void {
  try {
    const parsed = new URL(uri);
    if (
      !["mongodb:", "mongodb+srv:"].includes(parsed.protocol) ||
      !parsed.hostname
    ) {
      throw new Error("invalid URI");
    }
  } catch {
    throw new ReviewPersistenceError(
      "configuration",
      "MONGODB_URI must be a valid mongodb:// or mongodb+srv:// URI.",
    );
  }
}

function validateDatabaseName(databaseName: string): void {
  if (/[\0/\\. "$]/.test(databaseName)) {
    throw new ReviewPersistenceError(
      "configuration",
      "MONGODB_DB_NAME contains characters that MongoDB does not allow.",
    );
  }
}

export function loadMongoPersistenceConfig(
  env: NodeJS.ProcessEnv = process.env,
): MongoPersistenceConfig {
  const uri = requiredValue(env, "MONGODB_URI");
  const databaseName = requiredValue(env, "MONGODB_DB_NAME");
  validateUri(uri);
  validateDatabaseName(databaseName);

  return {
    uri,
    databaseName,
    maxPoolSize: positiveInteger(env, "MONGODB_MAX_POOL_SIZE", 10),
    serverSelectionTimeoutMS: positiveInteger(
      env,
      "MONGODB_SERVER_SELECTION_TIMEOUT_MS",
      5_000,
    ),
    connectTimeoutMS: positiveInteger(
      env,
      "MONGODB_CONNECT_TIMEOUT_MS",
      10_000,
    ),
    retryWrites: retryWrites(env),
  };
}
