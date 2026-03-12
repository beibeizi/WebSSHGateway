type JwtPayload = {
  exp?: number;
  sub?: string;
  iss?: string;
};

function decodeBase64(input: string): string | null {
  try {
    const padded = input.padEnd(input.length + (4 - (input.length % 4 || 4)) % 4, "=");
    return atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return null;
  }
}

export function parseJwt(token: string): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }
  const decoded = decodeBase64(parts[1]);
  if (!decoded) {
    return null;
  }
  try {
    return JSON.parse(decoded) as JwtPayload;
  } catch {
    return null;
  }
}

export function isTokenExpired(token: string): boolean {
  const payload = parseJwt(token);
  if (!payload?.exp) {
    return true;
  }
  return payload.exp * 1000 <= Date.now();
}
