import path from "node:path";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(
    path.join(import.meta.dirname, "migrations"),
  );

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.test.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            APP_ORIGIN: "https://event-roster.test",
            JWT_SIGNING_KEY: "test-jwt-signing-key-at-least-32-bytes",
            DUMMY_BCRYPT_HASH:
              "$2b$12$9Q3XHF3Qx/OvVAnrL6l7wOZAVVfZWxT0gEEn7MZQt/8V.KVl/6d5K",
            IP_HASH_KEY: "test-ip-hash-key-at-least-32-bytes",
            RECOVERY_CODE_PEPPER: "test-recovery-pepper-at-least-32-bytes",
            BOOTSTRAP_TOKEN: "local-bootstrap-token",
          },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/setup-d1.ts"],
    },
  };
});
