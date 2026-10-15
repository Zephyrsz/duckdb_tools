import { z } from "zod";
import {
  type SemanticQueryInput,
  semanticCatalogSchema,
  semanticQuerySchema,
  semanticResultSchema,
} from "../../domain/src/rds.ts";

export class RdsClient {
  private readonly url: string;
  constructor(
    url: string,
    private readonly token: string,
  ) {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol) || !token.trim())
      throw new Error("Configure RDS_API_URL and the server-only RDS_API_TOKEN");
    this.url = url.replace(/\/$/, "");
  }

  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const timeout = AbortSignal.timeout(75_000);
    const response = await fetch(`${this.url}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new Error(`Invalid RDS response (HTTP ${response.status})`);
    }
    if (!response.ok) {
      const detail = z.object({ detail: z.string() }).safeParse(value);
      throw new Error(
        detail.success ? detail.data.detail : `RDS request failed (HTTP ${response.status})`,
      );
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new Error("Invalid RDS response; check the semantic API contract");
    return parsed.data;
  }

  catalog(signal?: AbortSignal) {
    return this.request("/api/v1/catalog", semanticCatalogSchema, undefined, signal);
  }
  query(input: SemanticQueryInput, signal?: AbortSignal) {
    return this.request(
      "/api/v1/query",
      semanticResultSchema,
      semanticQuerySchema.parse(input),
      signal,
    );
  }
}
