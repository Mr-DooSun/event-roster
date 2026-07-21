import { Hono } from "hono";
import type { Env } from "./env";
import { healthRoutes } from "./routes/health";

export function createApp() {
  const app = new Hono<{ Bindings: Env }>();

  app.route("/api/v1/health", healthRoutes);
  app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

  return app;
}
