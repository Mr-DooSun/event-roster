import { type FormEvent, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Dialog } from "../../components/ui/Dialog";
import { StatusMessage } from "../../components/ui/StatusMessage";
import { TextInput } from "../../components/ui/TextInput";
import { useAuth } from "./AuthProvider";

interface FirstOperatorHandoff {
  temporaryPassword: string;
  recoveryCode: string;
}

export function BootstrapHandoffPage() {
  const { api, logout } = useAuth();
  const [loginId, setLoginId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [handoff, setHandoff] = useState<FirstOperatorHandoff | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const result = await api.post<FirstOperatorHandoff>(
        "/bootstrap/first-operator",
        { loginId, displayName },
      );
      setHandoff(result);
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
          첫 운영자가 임시 비밀번호를 변경하면 초기 계정은 더 이상 사용할 수
          없습니다.
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
      {handoff ? (
        <Dialog
          title="첫 운영자 계정 정보"
          closeLabel="기록했고 로그아웃"
          onClose={() => void logout()}
        >
          <p>아래 값은 지금 한 번만 확인할 수 있습니다.</p>
          <p>임시 비밀번호</p>
          <p className="er-secret-value">{handoff.temporaryPassword}</p>
          <p>복구 코드</p>
          <p className="er-secret-value">{handoff.recoveryCode}</p>
          <StatusMessage>
            두 값을 안전한 채널로 전달하세요. 새 운영자는 임시 비밀번호로
            로그인한 뒤 새 비밀번호를 설정해야 합니다.
          </StatusMessage>
          <StatusMessage>
            아래 버튼을 누르면 초기 설정 계정에서 로그아웃되고 로그인 화면으로
            이동합니다.
          </StatusMessage>
        </Dialog>
      ) : null}
    </main>
  );
}
