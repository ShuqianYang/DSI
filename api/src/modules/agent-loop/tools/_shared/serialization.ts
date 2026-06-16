export function safeJsonStringify(value: unknown): string {
  try {
    const serialized = JSON.stringify(normalizeForJson(value, new WeakSet<object>()));
    return serialized ?? "null";
  } catch (error) {
    return JSON.stringify({
      unserializable: true,
      message: error instanceof Error ? error.message : String(error),
      preview: safeString(value),
    });
  }
}

function normalizeForJson(value: unknown, stack: WeakSet<object>): unknown {
  if (typeof value === "bigint") {
    return `${value.toString()}n`;
  }
  if (typeof value === "function") {
    return `[Function ${value.name || "anonymous"}]`;
  }
  if (typeof value === "symbol") {
    return value.toString();
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (stack.has(value)) {
    return "[Circular]";
  }

  stack.add(value);
  try {
    if (value instanceof Date) {
      return value.toJSON();
    }
    if (Array.isArray(value)) {
      return value.map((item) => normalizeForJson(item, stack));
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, child]) => [key, normalizeForJson(child, stack)] as const)
        .filter(([, child]) => child !== undefined)
    );
  } finally {
    stack.delete(value);
  }
}

export function sanitizeForJson(value: unknown): unknown {
  return JSON.parse(safeJsonStringify(value)) as unknown;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortForStableJson(value));
}

export function sortForStableJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForStableJson);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortForStableJson(child)])
  );
}

export function truncateText(value: unknown, maxChars: number): string {
  const text = typeof value === "string" ? value : "";
  if (maxChars <= 0) return "";
  if (text.length <= maxChars) return text;
  if (maxChars < 3) return text.slice(0, maxChars);
  return `${text.slice(0, maxChars - 3)}...`;
}

function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return "[Unstringifiable value]";
  }
}
