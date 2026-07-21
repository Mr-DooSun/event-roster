export interface RequestContext {
  requestId: string;
  clientIp: string | null;
}

export function getClientIp(request: Request): string | null {
  const value = request.headers.get("CF-Connecting-IP")?.trim();
  return value ? value : null;
}

export function createRequestContext(request: Request): RequestContext {
  return {
    requestId: crypto.randomUUID(),
    clientIp: getClientIp(request),
  };
}
