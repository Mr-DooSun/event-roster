import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { StatusMessage } from "../../components/ui/StatusMessage";
import { TextInput } from "../../components/ui/TextInput";
import { useAuth } from "../auth/AuthProvider";
import type { OrganizationView } from "./UserForm";

export function OrganizationsPage() {
  const { api } = useAuth();
  const [organizations, setOrganizations] = useState<OrganizationView[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setOrganizations(await api.get<OrganizationView[]>("/organizations"));
    } catch {
      setError("조직 목록을 불러오지 못했습니다.");
    }
  }, [api]);
  useEffect(() => void load(), [load]);
  async function create(event: FormEvent) {
    event.preventDefault();
    try {
      await api.post("/organizations", { name });
      setName("");
      await load();
    } catch {
      setError("조직을 만들지 못했습니다.");
    }
  }
  async function update(
    item: OrganizationView,
    input: { name?: string; isActive?: boolean },
  ) {
    try {
      await api.patch(`/organizations/${item.id}`, input);
      await load();
    } catch {
      setError("조직 상태를 변경하지 못했습니다.");
    }
  }
  return (
    <div className="er-page-stack">
      <header className="er-page-heading">
        <div>
          <p className="er-eyebrow">ADMIN</p>
          <h1>조직 관리</h1>
        </div>
      </header>
      {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
      <Card className="er-panel">
        <h2>새 조직</h2>
        <form className="er-inline-form" onSubmit={create}>
          <TextInput
            label="조직 이름"
            required
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
          />
          <Button type="submit" variant="primary">
            조직 만들기
          </Button>
        </form>
      </Card>
      <Card className="er-panel">
        <h2>조직 목록</h2>
        <ul className="er-list">
          {organizations.map((item) => (
            <OrganizationRow
              key={item.id}
              item={item}
              onUpdate={(input) => update(item, input)}
            />
          ))}
        </ul>
      </Card>
    </div>
  );
}

function OrganizationRow({
  item,
  onUpdate,
}: {
  item: OrganizationView;
  onUpdate: (input: { name?: string; isActive?: boolean }) => Promise<void>;
}) {
  const [name, setName] = useState(item.name);
  return (
    <li>
      <input
        className="er-control er-control--inline"
        aria-label={`${item.name} 조직 이름`}
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
      />
      <div className="er-action-row">
        <Button type="button" onClick={() => void onUpdate({ name })}>
          이름 저장
        </Button>
        <Button
          type="button"
          variant={item.isActive ? "danger" : "secondary"}
          onClick={() => void onUpdate({ isActive: !item.isActive })}
        >
          {item.isActive ? "사용 중지" : "다시 사용"}
        </Button>
      </div>
    </li>
  );
}
