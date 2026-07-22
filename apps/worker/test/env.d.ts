import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof import("../src/index");
    }

    interface Env {
      DB: D1Database;
      MIGRATION_DB: D1Database;
      TEST_MIGRATIONS: D1Migration[];
      APP_ORIGIN: string;
      JWT_SIGNING_KEY: string;
      DUMMY_BCRYPT_HASH: string;
      IP_HASH_KEY: string;
      RECOVERY_CODE_PEPPER: string;
      BOOTSTRAP_TOKEN: string;
    }
  }
}
