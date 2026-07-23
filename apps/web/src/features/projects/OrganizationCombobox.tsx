import type { Organization } from "@event-roster/contracts";
import { useId, useMemo, useState } from "react";

export type OrganizationComboboxSelection =
  | { kind: "EXISTING"; organizationId: string }
  | { kind: "NEW"; name: string };

export interface OrganizationComboboxProps {
  organizations: Organization[];
  linkedOrganizationIds: ReadonlySet<string>;
  disabled: boolean;
  onSelect(selection: OrganizationComboboxSelection): void;
  onQueryChange?(): void;
}

interface ExistingOption {
  kind: "EXISTING";
  organization: Organization;
  disabled: boolean;
}

interface NewOption {
  kind: "NEW";
  name: string;
  disabled: false;
}

type ComboboxOption = ExistingOption | NewOption;

export function canonicalizeOrganizationInput(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

export function OrganizationCombobox({
  organizations,
  linkedOrganizationIds,
  disabled,
  onSelect,
  onQueryChange,
}: OrganizationComboboxProps) {
  const listboxId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const options = useMemo<ComboboxOption[]>(() => {
    const canonicalQuery = canonicalizeOrganizationInput(query);
    const existing: ExistingOption[] = organizations
      .filter(
        (organization) =>
          organization.isActive &&
          (!canonicalQuery ||
            canonicalizeOrganizationInput(organization.name).includes(
              canonicalQuery,
            )),
      )
      .map((organization) => ({
        kind: "EXISTING",
        organization,
        disabled: linkedOrganizationIds.has(organization.id),
      }));
    const exactMatch = organizations.some(
      (organization) =>
        canonicalizeOrganizationInput(organization.name) === canonicalQuery,
    );
    const trimmed = query.trim();
    return canonicalQuery && !exactMatch
      ? [...existing, { kind: "NEW", name: trimmed, disabled: false }]
      : existing;
  }, [linkedOrganizationIds, organizations, query]);

  function optionId(index: number) {
    return `${listboxId}-option-${index}`;
  }

  function select(option: ComboboxOption) {
    if (option.disabled) return;
    if (option.kind === "EXISTING") {
      setQuery(option.organization.name);
      onSelect({
        kind: "EXISTING",
        organizationId: option.organization.id,
      });
    } else {
      setQuery(option.name);
      onSelect({ kind: "NEW", name: option.name });
    }
    setOpen(false);
    setActiveIndex(-1);
  }

  function moveActive(direction: 1 | -1) {
    if (options.length === 0) return;
    setOpen(true);
    setActiveIndex((current) => {
      let next = current;
      for (let attempts = 0; attempts < options.length; attempts += 1) {
        next = (next + direction + options.length) % options.length;
        if (!options[next]?.disabled) return next;
      }
      return -1;
    });
  }

  const expanded = open && options.length > 0;
  const activeOption = activeIndex >= 0 ? options[activeIndex] : undefined;

  return (
    <div className="er-organization-combobox">
      <label className="er-field">
        <span>조직 이름 검색 또는 입력</span>
        <input
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listboxId}
          aria-activedescendant={
            expanded && activeOption ? optionId(activeIndex) : undefined
          }
          autoComplete="off"
          disabled={disabled}
          value={query}
          onFocus={() => {
            setOpen(true);
            setActiveIndex(-1);
          }}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setOpen(true);
            setActiveIndex(-1);
            onQueryChange?.();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
              setActiveIndex(-1);
              return;
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              moveActive(event.key === "ArrowDown" ? 1 : -1);
              return;
            }
            if (event.key === "Enter" && expanded) {
              const firstEnabled = options.find((option) => !option.disabled);
              const selected = activeOption?.disabled
                ? firstEnabled
                : (activeOption ?? firstEnabled);
              if (selected) {
                event.preventDefault();
                select(selected);
              }
            }
          }}
        />
      </label>
      {expanded ? (
        <div id={listboxId} className="er-combobox-list" role="listbox">
          {options.map((option, index) => {
            const linked = option.kind === "EXISTING" && option.disabled;
            const label =
              option.kind === "EXISTING"
                ? `${option.organization.name}${linked ? " · 이미 추가됨" : ""}`
                : `“${option.name}” 새 조직 생성 후 추가`;
            return (
              <button
                key={
                  option.kind === "EXISTING"
                    ? option.organization.id
                    : `new-${option.name}`
                }
                id={optionId(index)}
                className="er-combobox-option"
                type="button"
                role="option"
                aria-selected={activeIndex === index}
                disabled={option.disabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(option)}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
