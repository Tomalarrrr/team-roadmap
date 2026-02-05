/**
 * Error handling utilities for consistent error message extraction
 * and formatting across the application.
 */

/**
 * Extract error message from unknown error type.
 * Safe for use in catch blocks where error type is unknown.
 */
export function getErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return fallback;
}

/**
 * Format error message for user-facing toast notifications.
 * Prepends a context prefix to the error message.
 */
export function formatErrorForToast(error: unknown, prefix: string): string {
  const message = getErrorMessage(error);
  return `${prefix}: ${message}`;
}

/**
 * Sanitize error message to prevent XSS when displaying in UI.
 * Removes HTML tags from the error message.
 */
export function sanitizeErrorMessage(message: string): string {
  return String(message).replace(/<[^>]*>/g, '').trim();
}
