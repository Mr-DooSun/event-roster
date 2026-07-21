export function ColumnMapping({
  headers,
  nameColumn,
  organizationColumn,
  disabled,
  onChange,
}: {
  headers: string[];
  nameColumn: string;
  organizationColumn: string;
  disabled?: boolean;
  onChange: (columns: { name: string; organization: string }) => void;
}) {
  return (
    <div className="er-filter-row">
      <label className="er-field">
        <span>이름 열</span>
        <select
          disabled={disabled}
          value={nameColumn}
          onChange={(event) =>
            onChange({
              name: event.currentTarget.value,
              organization: organizationColumn,
            })
          }
        >
          {headers.map((header) => (
            <option key={header} value={header}>
              {header}
            </option>
          ))}
        </select>
      </label>
      <label className="er-field">
        <span>조직 열</span>
        <select
          disabled={disabled}
          value={organizationColumn}
          onChange={(event) =>
            onChange({
              name: nameColumn,
              organization: event.currentTarget.value,
            })
          }
        >
          {headers.map((header) => (
            <option key={header} value={header}>
              {header}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
