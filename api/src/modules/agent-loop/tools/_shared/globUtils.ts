export function normalizeGlobPath(input: string): string {
  return input.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function matchesGlobPattern(relativePath: string, pattern: string): boolean {
  const pathParts = normalizeGlobPath(relativePath).split("/").filter(Boolean);
  const patternParts = normalizeGlobPath(pattern).split("/").filter(Boolean);
  return matchGlobSegments(patternParts, pathParts);
}

function matchGlobSegments(patternParts: string[], pathParts: string[]): boolean {
  if (patternParts.length === 0) return pathParts.length === 0;

  const [currentPattern, ...remainingPatterns] = patternParts;
  if (currentPattern === "**") {
    if (matchGlobSegments(remainingPatterns, pathParts)) return true;
    return pathParts.length > 0 && matchGlobSegments(patternParts, pathParts.slice(1));
  }

  if (pathParts.length === 0) return false;
  return (
    matchesGlobSegment(pathParts[0]!, currentPattern ?? "") &&
    matchGlobSegments(remainingPatterns, pathParts.slice(1))
  );
}

function matchesGlobSegment(value: string, pattern: string): boolean {
  const regex = new RegExp(
    `^${pattern
      .split("")
      .map((char) => {
        if (char === "*") return ".*";
        if (char === "?") return ".";
        return escapeRegExp(char);
      })
      .join("")}$`
  );
  return regex.test(value);
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
