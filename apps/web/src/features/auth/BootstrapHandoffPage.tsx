import { type FormEvent, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Dialog } from "../../components/ui/Dialog";
import { StatusMessage } from "../../components/ui/StatusMessage";
import { TextInput } from "../../components/ui/TextInput";
import { useAuth } from "./AuthProvider";

export function BootstrapHandoffPage() {
  const { api, logout } = useAuth();
  const [loginId, setLoginId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const result = await api.post<{ temporaryPassword: string }>(
        "/bootstrap/first-operator",
        { loginId, displayName },
      );
      setTemporaryPassword(result.temporaryPassword);
    } catch {
      setError("첫 운영자 계정을 만들지 못했습니다.");
    }
  }

  return (
    <main className="er-auth-layout">
      <Card className="er-auth-card">
        <p className="er-eyebrow">초기 설정</p>
        <h1>첫 운영자 계정 인계</h1>
        <p className="er-muted">
          운영자 계정을 만든 뒤 초기 계정은 더 이상 사용할 수 없습니다.
        </p>
        <form onSubmit={submit}>
          <TextInput
            label="영문 로그인 ID"
            required
            value={loginId}
            onChange={(event) => setLoginId(event.currentTarget.value)}
          />
          <TextInput
            label="표시 이름"
            required
            value={displayName}
            onChange={(event) => setDisplayName(event.currentTarget.value)}
          />
          {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
          <Button type="submit" variant="primary">
            운영자 계정 만들기
          </Button>
        </form>
      </Card>
      {temporaryPassword ? (
        <Dialog
          title="임시 비밀번호"
          onClose={() => {
            setTemporaryPassword(null);
            void logout();
          }}
        >
          <p className="er-secret-value">{temporaryPassword}</p>
          <StatusMessage>
            지금 안전하게 전달하세요. 닫으면 다시 볼 수 없습니다.
          </StatusMessage>
        </Dialog>
      ) : null}
    </main>
  );
}
