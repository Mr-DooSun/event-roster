export function canonicalizeOrganizationInput(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}
