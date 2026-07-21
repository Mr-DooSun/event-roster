import { PasswordSchema } from "@event-roster/contracts";
import { type FormEvent, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { StatusMessage } from "../../components/ui/StatusMessage";
import { TextInput } from "../../components/ui/TextInput";
import { useAuth } from "./AuthProvider";

export function RecoveryPage() {
  const { recover, error, clearError } = useAuth();
  const [loginId, setLoginId] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [validation, setValidation] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = PasswordSchema.safeParse(newPassword);
    if (!parsed.success) {
      setValidation(
        parsed.error.issues[0]?.message ?? "새 비밀번호를 확인해 주세요.",
      );
      return;
    }
    await recover({ loginId, recoveryCode, newPassword: parsed.data });
  }

  return (
    <main className="er-auth-layout">
      <Card className="er-auth-card">
        <h1>계정 복구</h1>
        <form
          onSubmit={submit}
          onChange={() => {
            clearError();
            setValidation(null);
          }}
        >
          <TextInput
            label="로그인 ID"
            required
            value={loginId}
            onChange={(event) => setLoginId(event.currentTarget.value)}
          />
          <TextInput
            label="복구 코드"
            required
            value={recoveryCode}
            onChange={(event) => setRecoveryCode(event.currentTarget.value)}
          />
          <TextInput
            label="새 비밀번호"
            type="password"
            required
            value={newPassword}
            onChange={(event) => setNewPassword(event.currentTarget.value)}
          />
          {validation || error ? (
            <StatusMessage tone="error">{validation ?? error}</StatusMessage>
          ) : null}
          <Button type="submit" variant="primary">
            비밀번호 재설정
          </Button>
        </form>
        <a className="er-text-link" href="/login">
          로그인으로 돌아가기
        </a>
      </Card>
    </main>
  );
}
