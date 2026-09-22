export class CliError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly details?: unknown;

  constructor(code: string, message: string, options?: { exitCode?: number; details?: unknown; cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "CliError";
    this.code = code;
    this.exitCode = options?.exitCode ?? 1;
    if (options?.details !== undefined) this.details = options.details;
  }
}

export function toCliError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  if (error instanceof Error) {
    return new CliError("UNEXPECTED_ERROR", error.message, { cause: error });
  }
  return new CliError("UNEXPECTED_ERROR", String(error));
}

/**
 * One-line server failure for toasts: prefers the response body's own
 * message (e.g. schema/validation detail on a 400) over the generic HTTP
 * status line, which alone never says what the server rejected.
 */
export function dispatchErrorMessage(cause: unknown): string {
  if (cause instanceof CliError) {
    const details = (cause.details ?? null) as Record<string, unknown> | null;
    const body = details === null ? null : (details.body as unknown);
    if (typeof body === "string" && body.trim().length > 0) return body.slice(0, 120);
    if (body !== null && typeof body === "object") {
      const record = body as Record<string, unknown>;
      for (const key of ["message", "error", "detail", "reason"]) {
        const value = record[key];
        if (typeof value === "string" && value.trim().length > 0) return value.slice(0, 120);
      }
    }
    return String(cause).slice(0, 120);
  }
  return String(cause).slice(0, 120);
}
