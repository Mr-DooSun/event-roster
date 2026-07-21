import { DomainError } from "@event-roster/domain";
import { Hono } from "hono";
import { ZodError } from "zod";
import type { Env } from "./env";
import { HttpProblem, problemResponse } from "./http/problem";
import { authRoutes } from "./routes/auth";
import { bootstrapRoutes } from "./routes/bootstrap";
import { eventRoutes } from "./routes/events";
import { healthRoutes } from "./routes/health";
import { organizationRoutes } from "./routes/organizations";
import { participantRoutes } from "./routes/participants";
import { userRoutes } from "./routes/users";

export function createApp() {
  const app = new Hono<{ Bindings: Env }>();

  app.route("/api/v1/health", healthRoutes);
  app.route("/api/v1", bootstrapRoutes);
  app.route("/api/v1", authRoutes);
  app.route("/api/v1", organizationRoutes);
  app.route("/api/v1", userRoutes);
  app.route("/api/v1", eventRoutes);
  app.route("/api/v1", participantRoutes);
  app.all("/api/*", (_c) =>
    problemResponse(
      new HttpProblem("NOT_FOUND", 404, "요청한 API를 찾을 수 없습니다."),
      crypto.randomUUID(),
    ),
  );
  app.all("*", (c) =>
    c.env.ASSETS
      ? c.env.ASSETS.fetch(c.req.raw)
      : new Response("Not Found", { status: 404 }),
  );

  app.onError((error) =>
    problemResponse(toHttpProblem(error), crypto.randomUUID()),
  );

  return app;
}

function toHttpProblem(error: Error): HttpProblem {
  if (error instanceof HttpProblem) return error;
  if (error instanceof SyntaxError) {
    return new HttpProblem(
      "VALIDATION_FAILED",
      422,
      "요청 본문이 올바른 JSON 형식이 아닙니다.",
    );
  }
  if (error instanceof ZodError) {
    return new HttpProblem(
      "VALIDATION_FAILED",
      422,
      "입력값을 확인해 주세요.",
      error.issues,
    );
  }
  if (error instanceof DomainError) {
    const definitions = {
      AUTHENTICATION_REQUIRED: [
        401,
        "로그인 ID 또는 비밀번호가 올바르지 않습니다.",
      ],
      AUTH_TEMPORARILY_UNAVAILABLE: [
        503,
        "인증을 일시적으로 처리할 수 없습니다.",
      ],
      FORBIDDEN: [403, "이 작업을 수행할 권한이 없습니다."],
      INVALID_CSRF: [403, "요청의 보안 정보를 확인할 수 없습니다."],
      INVALID_RECOVERY_CODE: [401, "복구 코드를 확인해 주세요."],
      RATE_LIMITED: [429, "로그인 시도가 잠시 제한되었습니다."],
      CONFLICT: [409, "이미 처리되었거나 충돌하는 요청입니다."],
      INVALID_TRANSITION: [409, "허용되지 않은 행사 상태 변경입니다."],
      STALE_REVISION: [409, "다른 변경이 먼저 반영되었습니다."],
      EVENT_CLOSED: [409, "종료된 행사는 변경할 수 없습니다."],
      NOT_FOUND: [404, "요청한 데이터를 찾을 수 없습니다."],
    } as const;
    const definition = definitions[error.code as keyof typeof definitions];
    if (definition) {
      return new HttpProblem(error.code, definition[0], definition[1]);
    }
  }

  return new HttpProblem(
    "INTERNAL_ERROR",
    500,
    "요청을 처리하는 중 오류가 발생했습니다.",
  );
}
