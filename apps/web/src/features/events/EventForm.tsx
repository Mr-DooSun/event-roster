import type { Half } from "@event-roster/contracts";
import { type FormEvent, useState } from "react";
import { Button } from "../../components/ui/Button";
import { TextInput } from "../../components/ui/TextInput";

export function EventForm({
  onSubmit,
}: {
  onSubmit: (input: {
    year: number;
    half: Half;
    name: string;
  }) => Promise<void>;
}) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [half, setHalf] = useState<Half>("H1");
  const [name, setName] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    await onSubmit({ year, half, name });
    setName("");
  }
  return (
    <form className="er-form-grid" onSubmit={submit}>
      <TextInput
        label="연도"
        type="number"
        min={2000}
        max={2100}
        required
        value={year}
        onChange={(event) => setYear(event.currentTarget.valueAsNumber)}
      />
      <label className="er-field">
        <span>구분</span>
        <select
          value={half}
          onChange={(event) => setHalf(event.currentTarget.value as Half)}
        >
          <option value="H1">상반기</option>
          <option value="H2">하반기</option>
        </select>
      </label>
      <TextInput
        label="행사 이름"
        required
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
      />
      <Button type="submit" variant="primary">
        행사 만들기
      </Button>
    </form>
  );
}
