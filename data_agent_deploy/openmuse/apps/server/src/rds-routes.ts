import { Hono } from "hono";
import { z } from "zod";
import { semanticQuerySchema } from "../../../packages/domain/src/rds.ts";
import { RdsClient } from "../../../packages/integrations/src/rds.ts";
import type { Config } from "./config.ts";

/** Mount after the app's session middleware. The private RDS token never reaches clients. */
export function rdsRoutes(config: Pick<Config, "rdsUrl" | "rdsToken">) {
  const app = new Hono();
  app.onError((error, c) =>
    c.json(
      { error: error.message },
      error instanceof z.ZodError || error instanceof SyntaxError ? 422 : 503,
    ),
  );
  const client = () => {
    if (!config.rdsUrl || !config.rdsToken)
      throw new Error("RDS semantic service is not configured");
    return new RdsClient(config.rdsUrl, config.rdsToken);
  };
  app.get("/catalog", async (c) => c.json(await client().catalog(c.req.raw.signal)));
  app.post("/query", async (c) => {
    const input = semanticQuerySchema.parse(await c.req.json());
    return c.json(await client().query(input, c.req.raw.signal));
  });
  return app;
}
