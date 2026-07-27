import type { Organization } from "@event-roster/contracts";
import {
  type FocusEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { canonicalizeOrganizationInput } from "../../lib/organization-name";

export interface OrganizationSelectComboboxProps {
  label: string;
  organizations: Organization[];
  value: string;
  disabled?: boolean;
  onChange(organizationId: string): void;
}

export function OrganizationSelectCombobox({
  label,
  organizations,
  value,
  disabled = false,
  onChange,
}: OrganizationSelectComboboxProps) {
  const listboxId = useId();
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const committedValueRef = useRef(value);
  const selected = organizations.find(
    (organization) => organization.isActive && organization.id === value,
  );
  const [query, setQuery] = useState(selected?.name ?? "");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    if (committedValueRef.current === value) return;
    committedValueRef.current = value;
    setQuery(selected?.name ?? "");
  }, [selected?.name, value]);

  useEffect(() => {
    if (!value || selected) return;
    committedValueRef.current = "";
    setQuery("");
    onChange("");
  }, [onChange, selected, value]);

  const options = useMemo(() => {
    const key = canonicalizeOrganizationInput(query);
    return organizations.filter(
      (organization) =>
        organization.isActive &&
        (!key || canonicalizeOrganizationInput(organization.name).includes(key)),
    );
  }, [organizations, query]);

  function select(organization: Organization) {
    setQuery(organization.name);
    committedValueRef.current = organization.id;
    onChange(organization.id);
    setOpen(false);
    setActiveIndex(-1);
  }

  function moveActive(direction: 1 | -1) {
    if (options.length === 0) return;
    setOpen(true);
    setActiveIndex((current) => {
      if (current < 0) return direction === 1 ? 0 : options.length - 1;
      return (current + direction + options.length) % options.length;
    });
  }

  useEffect(() => {
    if (activeIndex < 0) return;
    optionRefs.current[activeIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  return (
    <div
      className="er-selection-combobox"
      onBlur={(event: FocusEvent<HTMLDivElement>) => {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        ) {
          return;
        }
        setOpen(false);
        setActiveIndex(-1);
      }}
    >
      <label className="er-field">
        <span>{label}</span>
        <input
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={
            open && activeIndex >= 0
              ? `${listboxId}-option-${activeIndex}`
              : undefined
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
            committedValueRef.current = "";
            onChange("");
            setOpen(true);
            setActiveIndex(-1);
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
            if (event.key === "Enter" && open && options.length > 0) {
              event.preventDefault();
              select(options[activeIndex >= 0 ? activeIndex : 0]!);
            }
          }}
        />
      </label>
      {open ? (
        <div id={listboxId} className="er-combobox-list" role="listbox">
          {options.length === 0 ? (
            <p className="er-combobox-empty">일치하는 조직이 없습니다.</p>
          ) : (
            options.map((organization, index) => (
              <button
                key={organization.id}
                id={`${listboxId}-option-${index}`}
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                className="er-combobox-option"
                type="button"
                role="option"
                aria-selected={activeIndex === index}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(organization)}
              >
                {organization.name}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
