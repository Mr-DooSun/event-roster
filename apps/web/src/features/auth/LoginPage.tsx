import { LoginRequestSchema } from "@event-roster/contracts";
import { type FormEvent, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { StatusMessage } from "../../components/ui/StatusMessage";
import { TextInput } from "../../components/ui/TextInput";
import { useAuth } from "./AuthProvider";

export function LoginPage() {
  const { login, error, clearError } = useAuth();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = LoginRequestSchema.safeParse({ loginId, password });
    if (!parsed.success) {
      setValidation(
        parsed.error.issues[0]?.message ?? "입력값을 확인해 주세요.",
      );
      return;
    }
    setSubmitting(true);
    await login(parsed.data.loginId, parsed.data.password);
    setSubmitting(false);
  }

  return (
    <main className="er-auth-layout">
      <Card className="er-auth-card">
        <p className="er-eyebrow">PROJECT ROSTER</p>
        <h1>프로젝트 참가자 명단</h1>
        <p className="er-muted">운영 계정으로 로그인해 주세요.</p>
        <form
          onSubmit={submit}
          onChange={() => {
            clearError();
            setValidation(null);
          }}
        >
          <TextInput
            label="로그인 ID"
            autoComplete="username"
            required
            value={loginId}
            onChange={(event) => setLoginId(event.currentTarget.value)}
          />
          <TextInput
            label="비밀번호"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
          />
          {validation || error ? (
            <StatusMessage tone="error">{validation ?? error}</StatusMessage>
          ) : null}
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? "로그인 중…" : "로그인"}
          </Button>
        </form>
        <a className="er-text-link" href="/recover">
          복구 코드로 비밀번호 재설정
        </a>
      </Card>
    </main>
  );
}
