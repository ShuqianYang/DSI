export function safeJsonStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    const serialized = JSON.stringify(value, (_key, current) => {
      if (typeof current === "bigint") {
        return `${current.toString()}n`;
      }
      if (typeof current === "function") {
        return `[Function ${current.name || "anonymous"}]`;
      }
      if (typeof current === "symbol") {
        return current.toString();
      }
      if (current && typeof current === "object") {
        if (seen.has(current)) {
          return "[Circular]";
        }
        seen.add(current);
      }
      return current;
    });
    return serialized ?? "null";
  } catch (error) {
    return JSON.stringify({
      unserializable: true,
      message: error instanceof Error ? error.message : String(error),
      preview: safeString(value),
    });
  }
}

export function sanitizeForJson(value: unknown): unknown {
  return JSON.parse(safeJsonStringify(value)) as unknown;
}

function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return "[Unstringifiable value]";
  }
}
