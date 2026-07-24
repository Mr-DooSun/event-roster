import { PasswordSchema } from "@event-roster/contracts";
import { type FormEvent, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { StatusMessage } from "../../components/ui/StatusMessage";
import { TextInput } from "../../components/ui/TextInput";
import { useAuth } from "./AuthProvider";

export function ChangePasswordPage() {
  const { changePassword, logout, error, clearError } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const parsed = PasswordSchema.safeParse(newPassword);
    if (!parsed.success) {
      setValidation(
        parsed.error.issues[0]?.message ?? "새 비밀번호를 확인해 주세요.",
      );
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setValidation("새 비밀번호가 일치하지 않습니다.");
      return;
    }
    setSubmitting(true);
    try {
      await changePassword(currentPassword, parsed.data);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="er-auth-layout">
      <Card className="er-auth-card">
        <p className="er-eyebrow">첫 로그인 보안 설정</p>
        <h1>새 비밀번호를 설정하세요.</h1>
        <p className="er-muted">
          변경이 끝나면 새 비밀번호로 다시 로그인합니다.
        </p>
        <form
          onSubmit={submit}
          onChange={() => {
            clearError();
            setValidation(null);
          }}
        >
          <TextInput
            label="현재 비밀번호"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.currentTarget.value)}
          />
          <TextInput
            label="새 비밀번호"
            type="password"
            autoComplete="new-password"
            required
            hint="10자 이상, UTF-8 기준 72바이트 이하"
            value={newPassword}
            onChange={(event) => setNewPassword(event.currentTarget.value)}
          />
          <TextInput
            label="새 비밀번호 확인"
            type="password"
            autoComplete="new-password"
            required
            value={confirmNewPassword}
            onChange={(event) =>
              setConfirmNewPassword(event.currentTarget.value)
            }
          />
          {validation || error ? (
            <StatusMessage tone="error">{validation ?? error}</StatusMessage>
          ) : null}
          <div className="er-action-row">
            <Button
              type="submit"
              variant="primary"
              loading={submitting}
              loadingText="비밀번호 변경 중…"
            >
              비밀번호 변경
            </Button>
            <Button type="button" onClick={() => void logout()}>
              로그아웃
            </Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
