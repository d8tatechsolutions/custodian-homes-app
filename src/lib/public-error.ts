/**
 * Turns a caught error into text that is safe to send to the browser.
 *
 * The app's own business rules throw a plain `new Error("…")` (or one of the
 * listed domain error classes) with a message written for the user, such as
 * "Commission accrual not found". Those pass through unchanged.
 *
 * Anything else — Mongoose and MongoDB errors (validation, cast, duplicate
 * key, bulk write), network and file-system errors (they carry `code`,
 * `errno` or `syscall`), type errors from a bug — can name collections,
 * indexes, fields, hosts or code paths. Those are logged on the server and
 * replaced by `fallback`.
 */
type ErrorClass = abstract new (...args: never[]) => Error;

const MAX_PUBLIC_MESSAGE = 300;

export function publicErrorMessage(
  error: unknown,
  fallback: string,
  allowed: readonly ErrorClass[] = [],
): string {
  if (isPublicError(error, allowed)) return error.message;
  console.error("[api] internal error replaced by a generic message:", fallback, error);
  return fallback;
}

function isPublicError(error: unknown, allowed: readonly ErrorClass[]): error is Error {
  if (!(error instanceof Error)) return false;
  const plain = Object.getPrototypeOf(error) === Error.prototype;
  if (!plain && !allowed.some((cls) => error instanceof cls)) return false;
  if ("code" in error || "errno" in error || "syscall" in error) return false;
  const message = error.message.trim();
  return message.length > 0 && message.length <= MAX_PUBLIC_MESSAGE;
}
