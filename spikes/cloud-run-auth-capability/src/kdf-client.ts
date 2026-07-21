import type { Env } from "./env";

export type ProbeOperation =
  | { operation: "hash"; password: string }
  | { operation: "verify"; password: string; phc: string }
  | { operation: "verifyDummy"; password: string }
  | { operation: "corruptSignature"; password: string };

export interface PasswordServiceResult {
  status: number;
  body: unknown;
  milliseconds: number;
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function sha256Base64url(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<string> {
  return base64url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  );
}

async function hmacSha256Base64url(
  secret: string,
  message: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64url(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, encoder.encode(message)),
    ),
  );
}

function requestFor(operation: ProbeOperation): {
  path: string;
  body: string;
  corrupt: boolean;
} {
  switch (operation.operation) {
    case "hash":
      return {
        path: "/internal/v1/password/hash",
        body: JSON.stringify({ password: operation.password }),
        corrupt: false,
      };
    case "corruptSignature":
      return {
        path: "/internal/v1/password/hash",
        body: JSON.stringify({ password: operation.password }),
        corrupt: true,
      };
    case "verify":
      return {
        path: "/internal/v1/password/verify",
        body: JSON.stringify({
          password: operation.password,
          phc: operation.phc,
        }),
        corrupt: false,
      };
    case "verifyDummy":
      return {
        path: "/internal/v1/password/verify",
        body: JSON.stringify({ password: operation.password }),
        corrupt: false,
      };
  }
}

export function createPasswordServiceClient(
  env: Env,
  fetcher: Fetcher = (url, init) => fetch(url, init),
): { execute(operation: ProbeOperation): Promise<PasswordServiceResult> } {
  return {
    async execute(operation: ProbeOperation): Promise<PasswordServiceResult> {
      const request = requestFor(operation);
      const timestamp = Math.floor(Date.now() / 1_000).toString();
      const rawBody = encoder.encode(request.body);
      const bodyDigest = await sha256Base64url(rawBody);
      const message = `v1\n${timestamp}\nPOST\n${request.path}\n${bodyDigest}`;
      const validSignature = await hmacSha256Base64url(
        env.AUTH_KDF_SHARED_SECRET,
        message,
      );
      const signature = request.corrupt
        ? `invalid-${validSignature}`
        : validSignature;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8_000);
      const startedAt = performance.now();
      try {
        const response = await fetcher(
          new URL(request.path, env.PASSWORD_SERVICE_URL).toString(),
          {
            method: "POST",
            redirect: "error",
            signal: controller.signal,
            headers: {
              "content-type": "application/json",
              "x-er-kdf-key-id": "v1",
              "x-er-kdf-timestamp": timestamp,
              "x-er-kdf-body-sha256": bodyDigest,
              "x-er-kdf-signature": signature,
            },
            body: request.body,
          },
        );
        let body: unknown = null;
        try {
          body = await response.json();
        } catch {
          body = null;
        }
        return {
          status: response.status,
          body,
          milliseconds: performance.now() - startedAt,
        };
      } catch (error) {
        if (controller.signal.aborted) {
          throw new Error("password_service_timeout");
        }
        throw new Error("password_service_request_failed", { cause: error });
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export async function constantTimeEqualUtf8(
  left: string,
  right: string,
): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftDigest);
  const rightBytes = new Uint8Array(rightDigest);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}
