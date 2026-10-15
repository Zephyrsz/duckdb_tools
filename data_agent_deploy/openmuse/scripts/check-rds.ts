import assert from "node:assert/strict";
import { rdsTools } from "../apps/server/src/rds-tools.ts";

process.loadEnvFile(".env");
const tools = rdsTools({ rdsUrl: process.env.RDS_API_URL, rdsToken: process.env.RDS_API_TOKEN });
const tool = tools.find((item) => item.name === "query_semantic");
assert.ok(tool, "RDS tools must be configured");
const execute = tool.execute as (args: unknown) => Promise<unknown>;
const result = await execute({
  question: "订单数量是多少？",
  metrics: ["user_order_history_record_count"],
});
const value = result as {
  success: boolean;
  data: unknown;
  read_only: boolean;
  semantic_revision: number;
  error?: string;
};
assert.equal(value.success, true, value.error);
assert.equal(value.read_only, true);
console.log(JSON.stringify(value, null, 2));
