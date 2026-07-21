import { type InputHTMLAttributes, useId } from "react";

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
}

export function TextInput({ label, hint, id, ...props }: TextInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  return (
    <label className="er-field" htmlFor={inputId}>
      <span>{label}</span>
      <input id={inputId} aria-describedby={hintId} {...props} />
      {hint ? <small id={hintId}>{hint}</small> : null}
    </label>
  );
}
