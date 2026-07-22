export function toKstDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function isProjectExpired(endDate: string | null, now: Date): boolean {
  return endDate !== null && endDate < toKstDate(now);
}
