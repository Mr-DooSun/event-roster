import { z } from "zod";
import type { OrganizationIdSchema } from "./organizations";

export const RoleSchema = z.enum(["OPERATOR", "ORGANIZATION_MANAGER"]);
export type Role = z.infer<typeof RoleSchema>;

export const SessionKindSchema = z.enum(["FULL", "MUST_CHANGE_PASSWORD"]);
export type SessionKind = z.infer<typeof SessionKindSchema>;

export const LoginIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9._-]{2,31}$/);

export const PasswordSchema = z
  .string()
  .min(10)
  .refine(
    (value) => new TextEncoder().encode(value).byteLength <= 72,
    "비밀번호는 UTF-8 기준 72바이트 이하여야 합니다.",
  );

export const LoginRequestSchema = z.object({
  loginId: LoginIdSchema,
  password: PasswordSchema,
});

export const PasswordChangeRequestSchema = z.object({
  currentPassword: PasswordSchema,
  newPassword: PasswordSchema,
});

export interface AccessClaims {
  sub: string;
  sid: string;
  sv: number;
  kind: SessionKind;
  iss: "event-roster";
  aud: "event-roster-web";
  iat: number;
  exp: number;
}

export interface AuthSessionView {
  user: {
    id: string;
    loginId: string;
    displayName: string;
    role: Role;
    organizationIds: Array<z.infer<typeof OrganizationIdSchema>>;
    isBootstrap: boolean;
  };
  sessionKind: SessionKind;
}

export interface AuthSuccess {
  accessToken: string;
  csrfToken: string;
  session: AuthSessionView;
}
