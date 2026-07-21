export function requireWorkersDevOrigin(input: string) {
  const trimmed = input.trim().replace(/\/$/, "");
  const url = new URL(trimmed);
  const labels = url.hostname.split(".");
  const validHostname =
    labels.length >= 4 &&
    labels.at(-2) === "workers" &&
    labels.at(-1) === "dev" &&
    labels
      .slice(0, -2)
      .every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
  if (
    url.protocol !== "https:" ||
    !validHostname ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    trimmed !== url.origin
  ) {
    throw new Error("URL must be an exact HTTPS workers.dev origin.");
  }
  return url.origin;
}
