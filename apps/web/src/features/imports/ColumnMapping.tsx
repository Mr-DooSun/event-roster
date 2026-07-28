import type { ImportColumns } from "../../lib/excel/read-workbook";

export function ColumnMapping({
  headers,
  columns,
  disabled,
  onChange,
}: {
  headers: string[];
  columns: ImportColumns;
  disabled?: boolean;
  onChange: (columns: ImportColumns) => void;
}) {
  return (
    <div className="er-filter-row">
      <ColumnSelect
        label="이름 열"
        headers={headers}
        value={columns.name}
        disabled={disabled}
        onChange={(name) => onChange({ ...columns, name })}
      />
      <ColumnSelect
        label="조직 열"
        headers={headers}
        value={columns.organization}
        disabled={disabled}
        onChange={(organization) => onChange({ ...columns, organization })}
      />
      <ColumnSelect
        label="참가자 구분 열"
        headers={headers}
        value={columns.role}
        disabled={disabled}
        onChange={(role) => onChange({ ...columns, role })}
      />
      <ColumnSelect
        label="학년 열"
        headers={headers}
        value={columns.grade}
        disabled={disabled}
        onChange={(grade) => onChange({ ...columns, grade })}
      />
    </div>
  );
}

function ColumnSelect({
  label,
  headers,
  value,
  disabled,
  onChange,
}: {
  label: string;
  headers: string[];
  value: string;
  disabled: boolean | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <label className="er-field">
      <span>{label}</span>
      <select
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        <option value="">열 선택</option>
        {headers.map((header) => (
          <option key={header} value={header}>
            {header}
          </option>
        ))}
      </select>
    </label>
  );
}
