// Exponential backoff retry utility
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    onRetry?: (error: Error, attempt: number) => void;
  } = {}
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 1000, maxDelayMs = 10000, onRetry } = options;

  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry non-retryable errors (permission denied, invalid data, etc.)
      if (!isRetryableError(lastError)) {
        throw lastError;
      }

      if (attempt === maxRetries) {
        throw lastError;
      }

      // Calculate delay with exponential backoff + jitter
      const delay = Math.min(
        baseDelayMs * Math.pow(2, attempt) + Math.random() * 100,
        maxDelayMs
      );

      onRetry?.(lastError, attempt + 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}

// Check if error is retryable.
// Default is to RETRY unless we know the error is permanent (fail-open strategy).
export function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();

  // Non-retryable: errors that won't resolve by retrying
  if (
    message.includes('permission_denied') ||
    message.includes('permission denied') ||
    message.includes('unauthorized') ||
    message.includes('unauthenticated') ||
    message.includes('invalid_argument') ||
    message.includes('invalid argument') ||
    message.includes('already exists')
  ) {
    return false;
  }

  // Default: retry unknown errors (safer than failing immediately)
  return true;
}
