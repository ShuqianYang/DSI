import { z } from "zod";

// ============================================================
// Zod → JSON Schema 转换器
// ============================================================
//
// Zod v4 内置 z.toJSONSchema()，直接包装使用。
// 输出格式兼容 Anthropic / OpenAI function calling。

export type JsonSchema = Record<string, unknown>;

/**
 * 将 Zod schema 转换为 JSON Schema 对象。
 *
 * 基于 Zod v4 内置的 z.toJSONSchema()，支持：
 * - string, number, boolean, null, date
 * - array, tuple (prefixItems)
 * - object (properties, required, additionalProperties)
 * - record (propertyNames, additionalProperties)
 * - optional, nullable, default
 * - union, discriminatedUnion, enum, literal
 * - describe (→ description)
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  // Zod v4 原生支持，输出标准 JSON Schema Draft 2020-12
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;

  // 精简：去掉 $schema 头，减少 prompt 长度
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(jsonSchema)) {
    if (key !== "$schema") {
      result[key] = value;
    }
  }

  return result;
}

/**
 * 批量转换 registry 中所有 contract 的 inputSchema。
 */
export function convertRegistrySchemas(
  schemas: Map<string, z.ZodTypeAny>
): Map<string, JsonSchema> {
  const result = new Map<string, JsonSchema>();

  for (const [name, schema] of schemas.entries()) {
    result.set(name, zodToJsonSchema(schema));
  }

  return result;
}
