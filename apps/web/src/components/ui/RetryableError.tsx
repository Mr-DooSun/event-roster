import { Button } from "./Button";
import { StatusMessage } from "./StatusMessage";

export function RetryableError({
  message,
  onRetry,
  retrying = false,
}: {
  message: string;
  onRetry: () => unknown;
  retrying?: boolean;
}) {
  return (
    <div className="er-retryable-error">
      <StatusMessage tone="error">{message}</StatusMessage>
      <Button
        type="button"
        loading={retrying}
        loadingText="다시 시도 중…"
        onClick={() => void onRetry()}
      >
        다시 시도
      </Button>
    </div>
  );
}
