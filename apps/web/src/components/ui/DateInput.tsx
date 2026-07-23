import {
  type InputHTMLAttributes,
  type MouseEvent,
  useId,
  useRef,
} from "react";

interface DateInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  hint?: string;
}

export function DateInput({
  label,
  hint,
  id,
  disabled,
  onClick,
  ...props
}: DateInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const labelId = `${inputId}-label`;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const inputRef = useRef<HTMLInputElement>(null);

  function handleClick(event: MouseEvent<HTMLInputElement>) {
    onClick?.(event);
    if (event.defaultPrevented || disabled) return;

    const input = inputRef.current;
    if (!input) return;

    input.focus();
    try {
      input.showPicker?.();
    } catch {
      // The focused native date input remains usable when picker access is blocked.
    }
  }

  return (
    <label className="er-field" htmlFor={inputId}>
      <span id={labelId}>{label}</span>
      <input
        {...props}
        ref={inputRef}
        id={inputId}
        type="date"
        disabled={disabled}
        aria-labelledby={labelId}
        aria-describedby={hintId}
        onClick={handleClick}
      />
      {hint ? <small id={hintId}>{hint}</small> : null}
    </label>
  );
}
