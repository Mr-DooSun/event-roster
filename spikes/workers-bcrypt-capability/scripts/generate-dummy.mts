import bcrypt from "bcryptjs";

const passwordHash = await bcrypt.hash("event-roster-dummy-account-v1", 12);
if (!/^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/.test(passwordHash)) {
  throw new Error("bcrypt dummy hash does not satisfy cost-12 policy");
}
process.stdout.write(`${passwordHash}\n`);
