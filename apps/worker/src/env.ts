export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_ORIGIN: string;
  JWT_SIGNING_KEY: string;
  DUMMY_BCRYPT_HASH: string;
  IP_HASH_KEY: string;
  RECOVERY_CODE_PEPPER: string;
  BOOTSTRAP_TOKEN?: string;
}
