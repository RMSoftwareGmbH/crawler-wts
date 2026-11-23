export type ReviewPersistenceErrorKind =
  "configuration" | "connection" | "operation" | "validation";

export class ReviewPersistenceError extends Error {
  constructor(
    readonly kind: ReviewPersistenceErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "ReviewPersistenceError";
  }
}
