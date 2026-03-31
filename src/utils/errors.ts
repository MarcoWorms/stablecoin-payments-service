export function toSafeErrorMessage(error: unknown, fallback = "Unexpected error"): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/URL:\s*\S+/gi, "URL: [redacted]")
    .replace(/Request body:.*$/gi, "Request body omitted.")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length === 0) {
    return fallback;
  }

  return normalized.slice(0, 240);
}
