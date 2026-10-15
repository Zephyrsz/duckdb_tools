import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { lastValueFrom, toArray } from "rxjs";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore } from "../apps/server/src/db.ts";
import { ConversationAgent } from "../apps/server/src/engine/conversation.ts";
import { rdsRoutes } from "../apps/server/src/rds-routes.ts";
import { rdsTools } from "../apps/server/src/rds-tools.ts";
import { RdsClient } from "../packages/integrations/src/rds.ts";
import { modelFixture } from "./helpers/model.ts";

const result = {
  success: true,
  question: "订单数量",
  sql: "SELECT COUNT(*) AS orders FROM orders LIMIT 100",
  data: [{ orders: 416 }],
  columns: ["orders"],
  row_count: 1,
  execution_time: 0.01,
  warnings: [],
  error: null,
  read_only: true,
  semantic_revision: 1,
};

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const requests: { path: string; token?: string; body: unknown }[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    requests.push({ path: req.url ?? "/", token: req.headers.authorization, body });
    res.setHeader("Content-Type", "application/json");
    if (body?.metrics?.[0] === "busy") {
      res.writeHead(503).end(JSON.stringify({ detail: "Disconnect duckdb_tools before querying" }));
    } else if (body?.metrics?.[0] === "malformed") {
      res.end(JSON.stringify({ success: true, data: "invalid" }));
    } else if (req.url === "/api/v1/catalog") {
      res.end(
        JSON.stringify({
          tables: [{ name: "orders", description: "Orders" }],
          metrics: [
            {
              name: "orders",
              display_name: "订单数量",
              description: "Order count",
              expression: "COUNT(*)",
              tables: ["orders"],
              time_column: null,
            },
          ],
          dimensions: [],
          read_only: true,
          semantic_revision: 1,
        }),
      );
    } else res.end(JSON.stringify(result));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests };
}

test("RDS client sends structured semantics and server authorization", async (t) => {
  const { url, requests } = await fixture(t);
  const client = new RdsClient(url, "server-secret");
  const catalog = await client.catalog();
  assert.equal(catalog.metrics[0].display_name, "订单数量");
  assert.deepEqual(await client.query({ question: "订单数量", metrics: ["orders"] }), result);
  assert.equal(requests[1].token, "Bearer server-secret");
  assert.equal(requests[1].path, "/api/v1/query");
  assert.deepEqual(requests[1].body, {
    question: "订单数量",
    metrics: ["orders"],
    dimensions: [],
    filters: {},
    semantic_filters: [],
    limit: 100,
  });
});

test("RDS client reports upstream failures and invalid successful payloads", async (t) => {
  const { url } = await fixture(t);
  const client = new RdsClient(url, "secret");
  await assert.rejects(client.query({ metrics: ["busy"] }), /Disconnect duckdb_tools/);
  await assert.rejects(client.query({ metrics: ["malformed"] }), /Invalid RDS response/);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(client.query({ metrics: ["orders"] }, abort.signal), /abort/i);
});

test("semantic tools execute real HTTP queries and return useful error results", async (t) => {
  const { url } = await fixture(t);
  const tools = rdsTools({ rdsUrl: url, rdsToken: "secret" });
  const query = tools.find((tool) => tool.name === "query_semantic");
  assert.ok(query);
  const execute = query.execute as (args: unknown) => Promise<unknown>;
  const value = await execute({ metrics: ["orders"] });
  assert.deepEqual(value, result);
  assert.match(JSON.stringify(await execute({ metrics: ["busy"] })), /Disconnect duckdb_tools/);
  assert.deepEqual(rdsTools({}), []);
});

test("data proxy validates input and forwards the server token", async (t) => {
  const { url, requests } = await fixture(t);
  const routes = rdsRoutes({ rdsUrl: url, rdsToken: "private-server-token" });
  const response = await routes.request("/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ metrics: ["orders"], sql: "DROP TABLE orders" }),
  });
  assert.equal(response.status, 422);
  assert.equal(requests.length, 0);
  const catalog = await routes.request("/catalog");
  assert.equal(catalog.status, 200);
  assert.equal(requests[0].token, "Bearer private-server-token");
});

test("conversation emits semantic result events and data routes enforce the OpenMuse session", async (t) => {
  const { url } = await fixture(t);
  await modelFixture(
    t,
    (index) =>
      [
        { name: "get_semantic_catalog", arguments: {} },
        { name: "query_semantic", arguments: { metrics: ["orders"] } },
      ][index],
  );
  const directory = await mkdtemp(join(tmpdir(), "openmuse-rds-"));
  const db = await createStore();
  t.after(async () => {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  });
  const config: Config = {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "model",
    model: "openai/fixture",
    intelligenceApiKey: "test-project-key-never-sent",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: [],
    webSearchEnabled: false,
    rdsUrl: url,
    rdsToken: "private-server-token",
  };
  const server = await createApp(db, config);
  t.after(() => server.agent.stop());
  assert.equal((await server.app.request("/api/data/catalog")).status, 401);
  assert.equal(
    (
      await server.app.request("/api/data/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metrics: ["orders"] }),
      })
    ).status,
    401,
  );
  const session = await server.app.request("/api/session", {
    method: "POST",
    body: "{}",
    headers: { "Content-Type": "application/json" },
  });
  const { token } = await session.json();
  const response = await server.app.request("/api/data/catalog", {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 200);
  const conversation = new ConversationAgent(config, server.agent, "local-user");
  const events = await lastValueFrom(
    conversation
      .run({
        threadId: "rds-conversation",
        runId: "rds-run",
        messages: [{ id: "rds-user", role: "user", content: "订单数量是多少？" }],
        tools: [],
        context: [],
        state: {},
      })
      .pipe(toArray()),
  );
  const results = events.filter((event) => event.type === "TOOL_CALL_RESULT");
  assert.equal(results.length, 2);
  assert.deepEqual(JSON.parse(String(results[1].content)).data, [{ orders: 416 }]);
});
