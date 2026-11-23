import { MongoClient, type Db, type MongoClientOptions } from "mongodb";
import {
  loadMongoPersistenceConfig,
  type MongoPersistenceConfig,
} from "./config.js";
import { ReviewPersistenceError } from "./errors.js";

export interface MongoClientLike {
  connect(): Promise<unknown>;
  db(name: string): Db;
  close(): Promise<void>;
}

export type MongoClientFactory = (
  uri: string,
  options: MongoClientOptions,
) => MongoClientLike;

export class MongoClientProvider {
  private client: MongoClientLike | undefined;
  private database: Db | undefined;
  private connection: Promise<Db> | undefined;
  private closed = false;

  constructor(
    private readonly config: MongoPersistenceConfig = loadMongoPersistenceConfig(),
    private readonly createClient: MongoClientFactory = (uri, options) =>
      new MongoClient(uri, options),
  ) {}

  getDb(): Promise<Db> {
    if (this.closed) {
      return Promise.reject(
        new ReviewPersistenceError(
          "connection",
          "The MongoDB client provider has been closed.",
        ),
      );
    }
    if (this.database) {
      return Promise.resolve(this.database);
    }
    if (!this.connection) {
      this.connection = this.connect();
    }
    return this.connection;
  }

  async ping(): Promise<void> {
    const database = await this.getDb();
    try {
      await database.command({ ping: 1 });
    } catch {
      throw new ReviewPersistenceError(
        "connection",
        "MongoDB health check failed.",
      );
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.connection) {
      await this.connection;
    }
    const client = this.client;
    this.client = undefined;
    this.database = undefined;
    if (!client) {
      return;
    }
    try {
      await client.close();
    } catch {
      throw new ReviewPersistenceError(
        "connection",
        "MongoDB client could not be closed cleanly.",
      );
    }
  }

  private async connect(): Promise<Db> {
    const client = this.createClient(this.config.uri, {
      maxPoolSize: this.config.maxPoolSize,
      serverSelectionTimeoutMS: this.config.serverSelectionTimeoutMS,
      connectTimeoutMS: this.config.connectTimeoutMS,
      retryWrites: this.config.retryWrites,
    });
    try {
      await client.connect();
      if (this.closed) {
        throw new Error("provider closed");
      }
      const database = client.db(this.config.databaseName);
      this.client = client;
      this.database = database;
      return database;
    } catch {
      try {
        await client.close();
      } catch {
        throw new ReviewPersistenceError(
          "connection",
          "MongoDB connection failed and its client could not be closed.",
        );
      }
      throw new ReviewPersistenceError(
        "connection",
        "Could not connect to MongoDB.",
      );
    }
  }
}
