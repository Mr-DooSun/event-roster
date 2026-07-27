import type { Organization } from "@event-roster/contracts";
import {
  type FocusEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { canonicalizeOrganizationInput } from "../../lib/organization-name";
import { orderOrganizationsByRecent } from "../../lib/recent-organizations";
import { useOrganizationPopover } from "./useOrganizationPopover";

const EMPTY_RECENT_ORGANIZATION_IDS: readonly string[] = [];

export interface OrganizationSelectComboboxProps {
  label: string;
  organizations: Organization[];
  value: string;
  recentOrganizationIds?: readonly string[];
  disabled?: boolean;
  onChange(organizationId: string): void;
}

export function OrganizationSelectCombobox({
  label,
  organizations,
  value,
  recentOrganizationIds = EMPTY_RECENT_ORGANIZATION_IDS,
  disabled = false,
  onChange,
}: OrganizationSelectComboboxProps) {
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const committedValueRef = useRef<string | null>(value || null);
  const observedValueRef = useRef(value);
  const selected = organizations.find(
    (organization) => organization.isActive && organization.id === value,
  );
  const [query, setQuery] = useState(selected?.name ?? "");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const closePopover = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);
  const { listboxRef, popoverStyle, placement } = useOrganizationPopover({
    open,
    anchorRef,
    containerRef,
    onRequestClose: closePopover,
  });

  useEffect(() => {
    const valueChanged = observedValueRef.current !== value;
    observedValueRef.current = value;

    if (!value) {
      if (valueChanged && committedValueRef.current !== null) {
        setQuery("");
      }
      committedValueRef.current = null;
      return;
    }
    if (!selected) {
      committedValueRef.current = null;
      setQuery("");
      onChange("");
      return;
    }
    if (valueChanged || committedValueRef.current === value) {
      committedValueRef.current = value;
      setQuery(selected.name);
    }
  }, [onChange, selected, value]);

  const options = useMemo(() => {
    const key =
      committedValueRef.current === value
        ? ""
        : canonicalizeOrganizationInput(query);
    const filtered = organizations.filter(
      (organization) =>
        organization.isActive &&
        (!key ||
          canonicalizeOrganizationInput(organization.name).includes(key)),
    );
    return orderOrganizationsByRecent(filtered, recentOrganizationIds);
  }, [organizations, query, recentOrganizationIds, value]);
  const optionIdSequence = options
    .map((organization) => organization.id)
    .join("\u0000");
  const observedOptionIdSequenceRef = useRef(optionIdSequence);

  useEffect(() => {
    if (observedOptionIdSequenceRef.current === optionIdSequence) return;
    observedOptionIdSequenceRef.current = optionIdSequence;
    setActiveIndex(-1);
  }, [optionIdSequence]);

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

  function closeWhenFocusLeaves(event: FocusEvent<HTMLInputElement>) {
    if (
      event.relatedTarget instanceof Node &&
      (containerRef.current?.contains(event.relatedTarget) ||
        listboxRef.current?.contains(event.relatedTarget))
    ) {
      return;
    }
    closePopover();
  }

  return (
    <div ref={containerRef} className="er-selection-combobox">
      <label className="er-field">
        <span>{label}</span>
        <input
          ref={anchorRef}
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
          onBlur={closeWhenFocusLeaves}
          onFocus={() => {
            setOpen(true);
            setActiveIndex(-1);
          }}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            committedValueRef.current = null;
            onChange("");
            setOpen(true);
            setActiveIndex(-1);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && open) {
              event.preventDefault();
              event.stopPropagation();
              closePopover();
              return;
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              moveActive(event.key === "ArrowDown" ? 1 : -1);
              return;
            }
            if (event.key === "Enter" && open && options.length > 0) {
              event.preventDefault();
              const option = options[activeIndex >= 0 ? activeIndex : 0];
              if (option) select(option);
            }
          }}
        />
      </label>
      {open && popoverStyle && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={listboxRef}
              id={listboxId}
              className="er-combobox-list er-combobox-list--portal"
              role="listbox"
              data-placement={placement}
              style={popoverStyle}
            >
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
                    tabIndex={-1}
                    aria-selected={organization.id === value}
                    data-active={activeIndex === index || undefined}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => select(organization)}
                  >
                    {organization.name}
                  </button>
                ))
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
