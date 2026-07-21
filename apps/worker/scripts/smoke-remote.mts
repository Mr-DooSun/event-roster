import { requireWorkersDevOrigin } from "./remote-origin.mjs";

const baseUrl = requireWorkersDevOrigin(required("SMOKE_BASE_URL"));
const loginId = required("SMOKE_LOGIN_ID");
const password = required("SMOKE_PASSWORD");

const correct = await login(loginId, password);
assert(correct.response.status === 200, "correct login failed");
assertRefreshCookie(correct.cookie);
const claims = decodeJwt(correct.body.accessToken);
assert(claims.exp - claims.iat === 900, "access token TTL mismatch");

await delay(2000);
const wrongPassword =
  password === "Smoke-wrong-password-A1"
    ? "Smoke-wrong-password-B2"
    : "Smoke-wrong-password-A1";
const wrong = await login(loginId, wrongPassword);
assert(
  wrong.response.status === 401,
  "wrong-password login semantics mismatch",
);

await delay(2000);
const unknown = await login(
  `missing-${crypto.randomUUID().slice(0, 8)}`,
  password,
);
assert(unknown.response.status === 401, "unknown-ID login semantics mismatch");

const refresh = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
  method: "POST",
  headers: { Cookie: cookiePair(correct.cookie), Origin: baseUrl },
});
assertNoServerError(refresh);
assert(refresh.status === 200, "refresh rotation failed");
const refreshedBody = (await refresh.json()) as AuthBody;
const rotatedCookie = refresh.headers.get("set-cookie");
assertRefreshCookie(rotatedCookie);
assert(
  cookiePair(rotatedCookie) !== cookiePair(correct.cookie),
  "refresh token did not rotate",
);

const logout = await fetch(`${baseUrl}/api/v1/auth/logout`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${refreshedBody.accessToken}`,
    "X-ER-CSRF": refreshedBody.csrfToken,
    Cookie: cookiePair(rotatedCookie),
    Origin: baseUrl,
  },
});
assertNoServerError(logout);
assert(logout.status === 204, "logout failed");
const revoked = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
  method: "POST",
  headers: { Cookie: cookiePair(rotatedCookie), Origin: baseUrl },
});
assert(revoked.status === 401, "logout did not revoke refresh session");
process.stdout.write("Remote low-frequency smoke passed.\n");

interface AuthBody {
  accessToken: string;
  csrfToken: string;
}

async function login(id: string, secret: string) {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ loginId: id, password: secret }),
  });
  assertNoServerError(response);
  const body = response.ok
    ? ((await response.clone().json()) as AuthBody)
    : ({} as AuthBody);
  return { response, body, cookie: response.headers.get("set-cookie") };
}

function decodeJwt(token: string) {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Smoke failed: malformed access token");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    iat: number;
    exp: number;
  };
}

function cookiePair(value: string | null) {
  if (!value) throw new Error("Smoke failed: refresh cookie missing");
  return value.split(";", 1)[0] ?? "";
}

function assertNoServerError(response: Response) {
  assert(response.status < 500, `server returned ${response.status}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Smoke failed: ${message}`);
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Smoke configuration missing: ${name}`);
  return value;
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assertRefreshCookie(cookie: string | null) {
  assert(typeof cookie === "string", "refresh cookie missing");
  assert(
    cookie.startsWith("__Host-er_refresh="),
    "refresh cookie name mismatch",
  );
  assert(cookie.includes("HttpOnly"), "refresh cookie is not HttpOnly");
  assert(cookie.includes("Secure"), "refresh cookie is not Secure");
  assert(cookie.includes("Path=/"), "refresh cookie Path mismatch");
  assert(cookie.includes("Max-Age=604800"), "refresh cookie Max-Age mismatch");
  assert(
    cookie.includes("SameSite=Strict"),
    "refresh cookie SameSite mismatch",
  );
}
