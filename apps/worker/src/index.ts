import { createApp } from "./app";
import type { Env } from "./env";
import { closeExpiredProjects } from "./services/project-expiration";

const app = createApp();

export default {
  fetch: app.fetch,
  scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): void {
    ctx.waitUntil(closeExpiredProjects(env).then(() => undefined));
  },
};
