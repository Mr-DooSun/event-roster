import { randomBytes } from "node:crypto";
import { hash } from "bcryptjs";

export async function generateDummyBcryptHash() {
  return hash(randomBytes(32).toString("base64url"), 12);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await generateDummyBcryptHash();
  process.stdout.write("Dummy bcrypt hash generated without printing it.\n");
}
