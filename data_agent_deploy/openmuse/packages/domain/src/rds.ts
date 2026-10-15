import { z } from "zod";

const identifier = z.string().trim().min(1).max(128);
const scalar = z.union([z.string(), z.number().finite(), z.boolean()]);
export const semanticQuerySchema = z
  .object({
    question: z.string().trim().max(4000).default(""),
    metrics: z.array(identifier).min(1).max(20),
    dimensions: z.array(identifier).max(10).default([]),
    filters: z.record(identifier, z.union([scalar, z.array(scalar)])).default({}),
    semantic_filters: z.array(identifier).max(20).default([]),
    time_range: z.string().max(100).optional(),
    order_by: z
      .object({ field: identifier, direction: z.enum(["asc", "desc"]) })
      .strict()
      .optional(),
    limit: z.number().int().min(1).max(1000).default(100),
  })
  .strict();

export const semanticResultSchema = z.object({
  success: z.boolean(),
  question: z.string(),
  sql: z.string().nullable().optional(),
  data: z.array(z.record(z.string(), z.unknown())).nullable(),
  columns: z.array(z.string()),
  row_count: z.number().int().nonnegative(),
  execution_time: z.number().nonnegative(),
  error: z.string().nullable().optional(),
  warnings: z.array(z.string()),
  read_only: z.literal(true),
  semantic_revision: z.number().int().positive(),
});

export const semanticCatalogSchema = z.object({
  tables: z.array(z.object({ name: z.string(), description: z.string() })),
  metrics: z.array(
    z.object({
      name: z.string(),
      display_name: z.string(),
      description: z.string(),
      expression: z.string(),
      tables: z.array(z.string()),
      time_column: z.string().nullable(),
    }),
  ),
  dimensions: z.array(
    z.object({
      name: z.string(),
      display_name: z.string(),
      table: z.string(),
      column: z.string(),
    }),
  ),
  read_only: z.literal(true),
  semantic_revision: z.number().int().positive(),
});

export type SemanticQueryInput = z.input<typeof semanticQuerySchema>;
export type SemanticResult = z.infer<typeof semanticResultSchema>;
