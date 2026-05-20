// fetch() that aborts after a timeout. Without this, a hung connection — very
// plausible behind a flaky corporate VPN — would stall a polling loop forever,
// since the next tick only schedules after the in-flight request settles.

export class TimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs = 12_000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    // Normalize the abort into a clearer error for callers/logs.
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new TimeoutError(timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolves after `ms`. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Apply ±`ratio` random jitter to a base delay so many clients don't retry or
 * poll in lockstep. e.g. jitter(1000, 0.2) → 800–1200ms.
 */
export function jitter(baseMs: number, ratio = 0.2): number {
  const delta = baseMs * ratio;
  return Math.round(baseMs - delta + Math.random() * 2 * delta);
}
