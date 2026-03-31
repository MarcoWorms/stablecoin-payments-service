import { timingSafeEqual } from "node:crypto";

interface HeaderCarrier {
  authorization?: string | string[] | undefined;
  "x-api-key"?: string | string[] | undefined;
}

function toSingleHeaderValue(value: string | string[] | undefined): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && value.length > 0) {
    return value[0] ?? null;
  }

  return null;
}

function tokensEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function extractAuthToken(headers: HeaderCarrier): string | null {
  const authorization = toSingleHeaderValue(headers.authorization);
  if (authorization) {
    const [scheme, token] = authorization.trim().split(/\s+/, 2);
    if (scheme?.toLowerCase() === "bearer" && token) {
      return token;
    }
  }

  const apiKey = toSingleHeaderValue(headers["x-api-key"]);
  return apiKey?.trim() || null;
}

export function isAuthorized(headers: HeaderCarrier, allowedTokens: string[]): boolean {
  if (allowedTokens.length === 0) {
    return true;
  }

  const providedToken = extractAuthToken(headers);
  if (!providedToken) {
    return false;
  }

  return allowedTokens.some((allowedToken) => tokensEqual(allowedToken, providedToken));
}
