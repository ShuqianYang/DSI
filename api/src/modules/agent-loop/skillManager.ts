import { existsSync } from "node:fs";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { escapeRegExp, matchesGlobPattern, normalizeGlobPath } from "./globUtils.js";
import { callTool } from "./toolGateway.js";
import type { ToolRegistry } from "./toolRegistry.js";
import type {
  AgentLoopPrefetch,
  AgentLoopToolUseContext,
  AgentMessage,
  GatewayToolCall,
  PromptSection,
  ToolDefinition,
  ToolExecutionContext,
} from "./types.js";

const SKILL_LISTING_SECTION_ID = "skill.listing";
const MAX_LISTING_CHARS = 8_000;
const MAX_LISTING_DESCRIPTION_CHARS = 250;
const MAX_SKILL_CONTENT_CHARS = 100_000;
const MAX_EMBEDDED_SHELL_COMMANDS = 10;
const SKILL_FILE_NAME = "SKILL.md";
const ROOT_SKILLS_DIR_NAME = "skills";

type SkillLoadedFrom = "skills";
type SkillContext = "inline" | "fork";
type SkillShell = "bash" | "powershell";

interface ParsedSkillFrontmatter {
  name?: string;
  description?: string;
  whenToUse?: string;
  allowedTools: string[];
  argumentHint?: string;
  argumentNames: string[];
  paths?: string[];
  model?: string;
  effort?: string;
  context?: SkillContext;
  shell?: SkillShell;
  disableModelInvocation: boolean;
  userInvocable: boolean;
}

export interface SkillDefinition extends ParsedSkillFrontmatter {
  name: string;
  description: string;
  content: string;
  filePath: string;
  baseDir: string;
  sourceDir: string;
  loadedFrom: SkillLoadedFrom;
  contentLength: number;
}

interface SkillWithPath {
  skill: SkillDefinition;
  filePath: string;
  fileIdentity: string;
}

interface FrontmatterParseResult {
  frontmatter: Record<string, unknown>;
  content: string;
}

interface SkillToolInput {
  skill: string;
  args?: string;
}

const validatedSkillCache = new WeakMap<ToolExecutionContext, Map<string, SkillDefinition>>();

export interface SkillManager {
  /**
   * Return lightweight skill listing sections visible near the prompt/tool listing.
   * Do not inline full skill bodies here; expose names/descriptions/usage hints so
   * the model can choose a Skill-style tool later.
   *
   * Return format: PromptSection[] rendered every turn as skillSections.
   */
  getSkillListingSections(toolUseContext: AgentLoopToolUseContext): Promise<PromptSection[]>;

  /**
   * Start per-iteration skill discovery prefetch. `input` is null for the normal
   * tool-loop path, matching Claude Code's call shape; implementations can inspect
   * `messages` to find write pivots, touched files, or task intent.
   *
   * Return format:
   * - `undefined`: no discovery should run for this iteration.
   * - `AgentLoopPrefetch`: resolve `promise` to PromptSection[] consumed after tools.
   */
  startSkillDiscoveryPrefetch(
    input: string | null,
    messages: readonly AgentMessage[],
    toolUseContext: AgentLoopToolUseContext
  ): AgentLoopPrefetch | undefined;

  /**
   * Consume the discovery prefetch and convert results into prompt sections or
   * attachment-like sections for the next model turn.
   *
   * Return format: PromptSection[] appended to future skillSections.
   */
  collectSkillDiscoveryPrefetch(prefetch: AgentLoopPrefetch): Promise<PromptSection[]>;

  /**
   * Optional file-operation hook: discover nested skill directories near touched files.
   * Intended to be called by Read/Write/Edit-style tools after they know file paths.
   *
   * Return format: absolute or workspace-relative skill directory paths, as chosen
   * by the concrete implementation.
   */
  discoverSkillDirsForPaths?(filePaths: string[], cwd: string): Promise<string[]>;

  /**
   * Optional file-operation hook: activate conditional skills whose path globs match
   * touched files, making them available in later listing/discovery calls.
   *
   * Return format: names/ids of skills newly activated by this call.
   */
  activateConditionalSkillsForPaths?(filePaths: string[], cwd: string): string[];

  /** Resolve a skill for the Skill tool. */
  getSkill?(name: string, toolUseContext: AgentLoopToolUseContext): Promise<SkillDefinition | undefined>;
}

export class LocalSkillManager implements SkillManager {
  private workspaceRoot: string | undefined;
  private baseLoaded = false;
  private readonly loadedSkillDirs = new Set<string>();
  private readonly skills = new Map<string, SkillDefinition>();
  private readonly conditionalSkills = new Map<string, SkillDefinition>();
  private readonly pendingActivatedSkillNames = new Set<string>();
  private readonly sentDynamicSkillNames = new Set<string>();

  async getSkillListingSections(toolUseContext: AgentLoopToolUseContext): Promise<PromptSection[]> {
    await this.ensureBaseSkillsLoaded(getWorkspaceRoot(), toolUseContext, { refreshRoot: true });
    const skills = this.listModelInvocableSkills();
    if (skills.length === 0) return [];

    return [
      {
        id: SKILL_LISTING_SECTION_ID,
        content: formatSkillListing(skills),
      },
    ];
  }

  startSkillDiscoveryPrefetch(
    _input: string | null,
    _messages: readonly AgentMessage[],
    toolUseContext: AgentLoopToolUseContext
  ): AgentLoopPrefetch | undefined {
    const dirs = Array.from(toolUseContext.dynamicSkillDirTriggers);
    const activatedNames = Array.from(this.pendingActivatedSkillNames);
    if (dirs.length === 0 && activatedNames.length === 0) return undefined;

    toolUseContext.dynamicSkillDirTriggers.clear();
    this.pendingActivatedSkillNames.clear();

    const prefetch: AgentLoopPrefetch = {
      settledAt: null,
      consumedOnIteration: -1,
      promise: Promise.resolve([]),
    };

    prefetch.promise = this.collectDiscoverySections(dirs, activatedNames, toolUseContext).finally(() => {
      prefetch.settledAt = Date.now();
    });

    return prefetch;
  }

  async collectSkillDiscoveryPrefetch(prefetch: AgentLoopPrefetch): Promise<PromptSection[]> {
    return prefetch.promise;
  }

  async discoverSkillDirsForPaths(filePaths: string[], cwd: string): Promise<string[]> {
    const root = getWorkspaceRoot(cwd);
    if (
      filePaths.some((filePath) => {
        const absolutePath = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(root, filePath);
        return isPathInsideRoot(absolutePath, root);
      })
    ) {
      const rootSkillsDir = path.join(root, ROOT_SKILLS_DIR_NAME);
      return (await isDirectory(rootSkillsDir)) ? [rootSkillsDir] : [];
    }
    return [];
  }

  activateConditionalSkillsForPaths(filePaths: string[], cwd: string): string[] {
    if (this.conditionalSkills.size === 0) return [];

    const root = getWorkspaceRoot(cwd);
    const activated: string[] = [];

    for (const [name, skill] of Array.from(this.conditionalSkills.entries())) {
      if (!skill.paths || skill.paths.length === 0) continue;

      const matched = filePaths.some((filePath) => {
        const absolutePath = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(root, filePath);
        if (!isPathInsideRoot(absolutePath, root)) return false;
        const relativePath = normalizeGlobPath(path.relative(root, absolutePath));
        return skill.paths!.some((pattern) => matchesGlobPattern(relativePath, pattern));
      });

      if (!matched) continue;

      this.conditionalSkills.delete(name);
      this.skills.set(name, skill);
      this.pendingActivatedSkillNames.add(name);
      activated.push(name);
    }

    return activated;
  }

  async getSkill(
    name: string,
    toolUseContext: AgentLoopToolUseContext
  ): Promise<SkillDefinition | undefined> {
    await this.ensureBaseSkillsLoaded(getWorkspaceRoot(), toolUseContext);
    const normalized = normalizeSkillName(name);
    const skill = this.skills.get(normalized);
    if (skill) return skill;

    const conditionalSkill = this.conditionalSkills.get(normalized);
    if (!conditionalSkill) return undefined;

    this.conditionalSkills.delete(normalized);
    this.skills.set(normalized, conditionalSkill);
    this.pendingActivatedSkillNames.add(normalized);
    return conditionalSkill;
  }

  private async ensureBaseSkillsLoaded(
    cwd: string,
    toolUseContext?: AgentLoopToolUseContext,
    options?: { refreshRoot?: boolean }
  ): Promise<void> {
    const root = getWorkspaceRoot(cwd);
    if (this.workspaceRoot !== root) {
      this.workspaceRoot = root;
      this.baseLoaded = false;
      this.loadedSkillDirs.clear();
      this.skills.clear();
      this.conditionalSkills.clear();
      this.pendingActivatedSkillNames.clear();
      this.sentDynamicSkillNames.clear();
    }

    if (!this.baseLoaded || options?.refreshRoot) {
      const rootSkillsDir = path.join(root, ROOT_SKILLS_DIR_NAME);
      await this.addSkillDirectories([rootSkillsDir], toolUseContext, {
        dynamic: false,
        force: this.baseLoaded && options?.refreshRoot === true,
      });
    }
    this.baseLoaded = true;
  }

  private async collectDiscoverySections(
    dirs: string[],
    activatedNames: string[],
    toolUseContext: AgentLoopToolUseContext
  ): Promise<PromptSection[]> {
    await this.ensureBaseSkillsLoaded(getWorkspaceRoot(), toolUseContext);
    const beforeNames = new Set(this.skills.keys());
    await this.addSkillDirectories(dirs, toolUseContext, { dynamic: true });

    const discoveredNames = Array.from(this.skills.keys()).filter((name) => !beforeNames.has(name));
    const names = uniqueStrings([...activatedNames, ...discoveredNames]).filter((name) => {
      if (this.sentDynamicSkillNames.has(name)) return false;
      this.sentDynamicSkillNames.add(name);
      toolUseContext.discoveredSkillNames.add(name);
      return true;
    });

    if (names.length === 0) return [];

    const skills = names
      .map((name) => this.skills.get(name))
      .filter((skill): skill is SkillDefinition => Boolean(skill))
      .filter(isModelInvocableSkill);

    if (skills.length === 0) return [];

    return [
      {
        id: `skill.discovery.${Date.now()}`,
        content: [
          "Newly available skills:",
          ...skills.map(formatSkillListItem),
          "",
          'Use the Skill tool with {"skill":"<name>","args":"optional arguments"} to load the full skill instructions before acting on a matching task.',
        ].join("\n"),
      },
    ];
  }

  private async addSkillDirectories(
    dirs: string[],
    toolUseContext: AgentLoopToolUseContext | undefined,
    options: { dynamic: boolean; force?: boolean }
  ): Promise<void> {
    for (const dir of dirs) {
      const absoluteDir = path.resolve(dir);
      if (this.loadedSkillDirs.has(absoluteDir) && !options.force) continue;
      if (!(await isDirectory(absoluteDir))) continue;

      this.loadedSkillDirs.add(absoluteDir);
      const skills = await loadSkillsFromDirectory(absoluteDir);
      for (const { skill } of skills) {
        if (skill.paths && skill.paths.length > 0) {
          if (!this.skills.has(skill.name)) {
            this.conditionalSkills.set(skill.name, skill);
          }
          continue;
        }

        this.skills.set(skill.name, skill);
        if (options.dynamic) {
          toolUseContext?.discoveredSkillNames.add(skill.name);
        }
      }
    }
  }

  private listModelInvocableSkills(): SkillDefinition[] {
    return Array.from(this.skills.values())
      .filter(isModelInvocableSkill)
      .sort((left, right) => left.name.localeCompare(right.name));
  }
}

export const defaultSkillManager = new LocalSkillManager();

export const noopSkillManager: SkillManager = {
  async getSkillListingSections() {
    return [];
  },
  startSkillDiscoveryPrefetch() {
    return undefined;
  },
  async collectSkillDiscoveryPrefetch(prefetch) {
    return prefetch.promise;
  },
  async getSkill() {
    return undefined;
  },
};

export function registerSkillTool(registry: ToolRegistry, skillManager: SkillManager): void {
  if (registry.get("Skill")) return;
  registry.register(buildSkillTool(registry, skillManager));
}

function buildSkillTool(registry: ToolRegistry, skillManager: SkillManager): ToolDefinition {
  return {
    name: "Skill",
    description:
      'Load a local markdown skill by name. Input: {"skill":"review","args":"task-specific arguments"}. If the skill listing shows an args hint, pass the matching value in args; otherwise omit args.',
    kind: "skill",
    inputSchema: z.strictObject({
      skill: z.string().min(1).describe("Name of the local skill to load."),
      args: z
        .string()
        .describe("Task-specific arguments. Required when the selected skill listing shows an args hint or the skill uses argument placeholders.")
        .optional(),
    }),
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => false,
    riskLevel: "low",
    maxResultSizeChars: MAX_SKILL_CONTENT_CHARS,
    async validateInput(input, context) {
      const parsed = input as SkillToolInput;
      const skill = await skillManager.getSkill?.(parsed.skill, requireToolUseContext(context));
      if (!skill) {
        throw new Error(`Unknown skill: ${normalizeSkillName(parsed.skill)}`);
      }
      if (skill.disableModelInvocation) {
        throw new Error(`Skill cannot be invoked by the model: ${skill.name}`);
      }
      if (!skill.userInvocable) {
        throw new Error(`Skill is not user-invocable: ${skill.name}`);
      }
      validateSkillArguments(parsed, skill);
      cacheValidatedSkill(context, parsed.skill, skill);
    },
    checkPermissions(input) {
      return { behavior: "allow", updatedInput: input };
    },
    async execute(input, context) {
      const parsed = input as SkillToolInput;
      const toolUseContext = requireToolUseContext(context);
      const skill =
        getCachedValidatedSkill(context, parsed.skill) ??
        await skillManager.getSkill?.(parsed.skill, toolUseContext);
      if (!skill) {
        throw new Error(`Unknown skill: ${normalizeSkillName(parsed.skill)}`);
      }
      validateSkillArguments(parsed, skill);

      const content = await renderSkillContent({
        skill,
        args: parsed.args,
        context,
        registry,
      });
      injectSkillContent(toolUseContext, skill, content);
      applySkillAllowedTools(toolUseContext, skill);

      return {
        success: true,
        commandName: skill.name,
        status: skill.context ?? "inline",
        loadedFrom: skill.loadedFrom,
        filePath: toWorkspaceRelative(skill.filePath),
        baseDir: toWorkspaceRelative(skill.baseDir),
        allowedTools: skill.allowedTools.length > 0 ? skill.allowedTools : undefined,
        model: skill.model,
        effort: skill.effort,
        inlineInjected: true,
        contentChars: content.length,
        contentPreview: truncate(content, 1_000),
        note:
          "Skill instructions were injected into the next model prompt as runtime context. Follow those instructions directly instead of calling Skill again for the same task.",
      };
    },
  };
}

function injectSkillContent(
  toolUseContext: AgentLoopToolUseContext,
  skill: SkillDefinition,
  content: string,
): void {
  const sectionId = `skill.invoked.${skill.name}`;
  const section: PromptSection = {
    id: sectionId,
    content: [
      `Loaded skill: ${skill.name}`,
      skill.description ? `Description: ${skill.description}` : "",
      skill.allowedTools.length > 0 ? `Allowed tools for this skill: ${skill.allowedTools.join(", ")}` : "",
      "",
      content,
    ]
      .filter((line) => line !== "")
      .join("\n"),
  };

  const existingIndex = toolUseContext.invokedSkillSections.findIndex((item) => item.id === sectionId);
  if (existingIndex >= 0) {
    toolUseContext.invokedSkillSections[existingIndex] = section;
    return;
  }
  toolUseContext.invokedSkillSections.push(section);
}

function applySkillAllowedTools(toolUseContext: AgentLoopToolUseContext, skill: SkillDefinition): void {
  if (skill.allowedTools.length === 0) return;

  const allowedToolNames = new Set<string>(["Skill"]);
  for (const allowedTool of skill.allowedTools) {
    const normalized = normalizeAllowedToolName(allowedTool);
    if (normalized) allowedToolNames.add(normalized);
  }
  toolUseContext.skillAllowedToolNames = allowedToolNames;
  toolUseContext.skillAllowedToolsExpiresOnTurn = inferCurrentTurn(toolUseContext) + 1;
}

function normalizeAllowedToolName(value: string): string {
  return value.trim().replace(/\(.+$/, "").replace(/^\/+/, "");
}

function inferCurrentTurn(toolUseContext: AgentLoopToolUseContext): number {
  return toolUseContext.messages.filter((message) => message.role === "assistant").length + 1;
}

async function renderSkillContent(input: {
  skill: SkillDefinition;
  args: string | undefined;
  context: ToolExecutionContext;
  registry: ToolRegistry;
}): Promise<string> {
  const { skill } = input;
  let content = [
    `Base directory for this skill: ${skill.baseDir}`,
    skill.argumentHint ? `Argument hint: ${skill.argumentHint}` : "",
    input.args !== undefined ? `Provided args: ${input.args}` : "",
    "",
    skill.content,
  ].filter((line, index) => index >= 3 || line).join("\n");

  content = substituteArguments(content, input.args, skill.argumentNames);
  content = content.replace(/\$\{CLAUDE_SKILL_DIR\}/g, normalizePathForPrompt(skill.baseDir));
  content = content.replace(/\$\{SKILL_DIR\}/g, normalizePathForPrompt(skill.baseDir));
  content = content.replace(/\$\{CLAUDE_SESSION_ID\}/g, input.context.taskId);
  content = content.replace(/\$\{SESSION_ID\}/g, input.context.taskId);

  if (content.includes("!`") || content.includes("```!")) {
    content = await executeEmbeddedShellCommands(content, input.context, input.registry, skill.name);
  }

  return truncate(content, MAX_SKILL_CONTENT_CHARS);
}

async function executeEmbeddedShellCommands(
  text: string,
  context: ToolExecutionContext,
  registry: ToolRegistry,
  skillName: string
): Promise<string> {
  const matches = collectEmbeddedShellMatches(text);
  if (matches.length === 0) return text;
  if (matches.length > MAX_EMBEDDED_SHELL_COMMANDS) {
    throw new Error(
      `Skill ${skillName} contains ${matches.length} embedded shell commands; max is ${MAX_EMBEDDED_SHELL_COMMANDS}.`
    );
  }

  let result = text;
  for (const match of matches) {
    const toolCall: GatewayToolCall = {
      id: `skill-${skillName}-${hashString(match.command)}`,
      toolName: "Bash",
      input: {
        command: match.command,
        description: `Embedded shell command from skill ${skillName}`,
      },
    };
    const observation = await callTool(registry, toolCall, context);
    if (!observation.ok) {
      throw new Error(
        `Embedded shell command in skill ${skillName} failed: ${observation.error?.message ?? "unknown error"}`
      );
    }
    result = result.replace(match.raw, () => formatEmbeddedShellObservation(observation.output));
  }

  return result;
}

function collectEmbeddedShellMatches(text: string): Array<{ raw: string; command: string }> {
  const matches: Array<{ raw: string; command: string }> = [];
  const blockPattern = /```!\s*\n?([\s\S]*?)\n?```/g;
  const inlinePattern = /(^|\s)!`([^`]+)`/gm;

  for (const match of text.matchAll(blockPattern)) {
    const raw = match[0];
    const command = match[1]?.trim();
    if (command) matches.push({ raw, command });
  }

  if (text.includes("!`")) {
    for (const match of text.matchAll(inlinePattern)) {
      const prefix = match[1] ?? "";
      const raw = match[0];
      const command = match[2]?.trim();
      if (command) matches.push({ raw, command: command.startsWith(prefix) ? command.slice(prefix.length) : command });
    }
  }

  return matches;
}

function formatEmbeddedShellObservation(output: unknown): string {
  if (output && typeof output === "object") {
    const record = output as Record<string, unknown>;
    const stdout = typeof record.stdout === "string" ? record.stdout.trim() : "";
    const stderr = typeof record.stderr === "string" ? record.stderr.trim() : "";
    return [stdout, stderr ? `[stderr]\n${stderr}` : ""].filter(Boolean).join("\n");
  }
  return typeof output === "string" ? output : JSON.stringify(output);
}

async function loadSkillsFromDirectory(sourceDir: string): Promise<SkillWithPath[]> {
  let entries;
  try {
    entries = await readdir(sourceDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const loaded: SkillWithPath[] = [];
  for (const entry of entries) {
    const entryPath = path.join(sourceDir, entry.name);
    const entryStat = entry.isSymbolicLink()
      ? await stat(entryPath).catch(() => undefined)
      : undefined;
    const isDirectoryEntry = entry.isDirectory() || entryStat?.isDirectory() === true;
    const isFileEntry = entry.isFile() || entryStat?.isFile() === true;

    if (isDirectoryEntry) {
      const skillPath = path.join(entryPath, SKILL_FILE_NAME);
      const skill = await loadSkillFile({
        skillName: entry.name,
        filePath: skillPath,
        baseDir: entryPath,
        sourceDir,
      });
      if (skill) loaded.push(skill);
      continue;
    }

    if (isFileEntry && /\.md$/i.test(entry.name) && entry.name.toLowerCase() !== SKILL_FILE_NAME.toLowerCase()) {
      const skillName = entry.name.replace(/\.md$/i, "");
      const skill = await loadSkillFile({
        skillName,
        filePath: entryPath,
        baseDir: path.dirname(entryPath),
        sourceDir,
      });
      if (skill) loaded.push(skill);
    }
  }

  return deduplicateSkillFiles(warnOnDuplicateSkillNames(loaded));
}

async function loadSkillFile(input: {
  skillName: string;
  filePath: string;
  baseDir: string;
  sourceDir: string;
}): Promise<SkillWithPath | null> {
  let content: string;
  try {
    content = await readFile(input.filePath, "utf8");
  } catch {
    return null;
  }

  const parsedMarkdown = parseFrontmatter(content);
  const frontmatter = parseSkillFrontmatter(parsedMarkdown.frontmatter, parsedMarkdown.content);
  const name = normalizeSkillName(frontmatter.name ?? input.skillName);
  const description = frontmatter.description ?? extractDescriptionFromMarkdown(parsedMarkdown.content, name);
  const fileIdentity = await getFileIdentity(input.filePath);

  return {
    filePath: input.filePath,
    fileIdentity,
    skill: {
      ...frontmatter,
      name,
      description,
      content: parsedMarkdown.content,
      filePath: input.filePath,
      baseDir: input.baseDir,
      sourceDir: input.sourceDir,
      loadedFrom: "skills",
      contentLength: parsedMarkdown.content.length,
    },
  };
}

function parseSkillFrontmatter(frontmatter: Record<string, unknown>, content: string): ParsedSkillFrontmatter {
  const paths = parsePathPatterns(frontmatter.paths);
  return {
    name: optionalString(frontmatter.name),
    description: optionalString(frontmatter.description),
    whenToUse: optionalString(frontmatter.when_to_use ?? frontmatter.whenToUse),
    allowedTools: parseToolNameList(frontmatter["allowed-tools"] ?? frontmatter.allowed_tools),
    argumentHint: optionalString(frontmatter["argument-hint"] ?? frontmatter.argument_hint),
    argumentNames: parseStringList(frontmatter.arguments),
    paths,
    model: optionalString(frontmatter.model),
    effort: optionalString(frontmatter.effort),
    context: parseContext(frontmatter.context),
    shell: parseShell(frontmatter.shell),
    disableModelInvocation: parseBoolean(frontmatter["disable-model-invocation"]),
    userInvocable:
      frontmatter["user-invocable"] === undefined ? true : parseBoolean(frontmatter["user-invocable"]),
  };
}

function parseFrontmatter(markdown: string): FrontmatterParseResult {
  const match = markdown.match(/^---\s*\n([\s\S]*?)---\s*\n?/);
  if (!match) {
    return { frontmatter: {}, content: markdown };
  }

  return {
    frontmatter: parseSimpleYaml(match[1] ?? ""),
    content: markdown.slice(match[0].length),
  };
}

function parseSimpleYaml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = text.split(/\r?\n/);
  let currentListKey: string | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim() || line.trimStart().startsWith("#")) continue;

    const listMatch = line.match(/^\s*-\s+(.+)$/);
    if (listMatch && currentListKey) {
      const existing = result[currentListKey];
      const list = Array.isArray(existing) ? existing : [];
      list.push(parseYamlValue(listMatch[1] ?? ""));
      result[currentListKey] = list;
      continue;
    }

    currentListKey = undefined;
    const match = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!match) continue;

    const key = match[1]!;
    const rawValue = match[2] ?? "";
    if (rawValue.trim() === "") {
      result[key] = [];
      currentListKey = key;
      continue;
    }

    result[key] = parseYamlValue(rawValue);
  }

  return result;
}

function parseYamlValue(rawValue: string): unknown {
  const value = rawValue.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    return splitCommaOutsideBraces(value.slice(1, -1)).map(parseYamlValue);
  }
  return value;
}

function parsePathPatterns(value: unknown): string[] | undefined {
  const patterns = parseStringList(value)
    .flatMap(expandBraces)
    .map((pattern) => pattern.trim())
    .map((pattern) => (pattern.endsWith("/**") ? pattern.slice(0, -3) : pattern))
    .filter(Boolean);

  if (patterns.length === 0 || patterns.every((pattern) => pattern === "**")) {
    return undefined;
  }

  return patterns;
}

function parseStringList(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    return value.flatMap(parseStringList);
  }
  if (typeof value === "string") {
    return splitCommaOutsideBraces(value)
      .map((part) => stripQuotes(part.trim()))
      .filter(Boolean);
  }
  return [String(value)];
}

function parseToolNameList(value: unknown): string[] {
  return parseStringList(value).flatMap((item) =>
    item
      .split(/\s+/)
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

function splitCommaOutsideBraces(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let braceDepth = 0;

  for (const char of value) {
    if (char === "{") braceDepth += 1;
    if (char === "}") braceDepth = Math.max(0, braceDepth - 1);
    if (char === "," && braceDepth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function expandBraces(pattern: string): string[] {
  const match = pattern.match(/^([^{]*)\{([^}]+)\}(.*)$/);
  if (!match) return [pattern];

  const prefix = match[1] ?? "";
  const alternatives = (match[2] ?? "").split(",").map((part) => part.trim());
  const suffix = match[3] ?? "";
  return alternatives.flatMap((alternative) => expandBraces(`${prefix}${alternative}${suffix}`));
}

function parseContext(value: unknown): SkillContext | undefined {
  return value === "fork" || value === "inline" ? value : undefined;
}

function parseShell(value: unknown): SkillShell | undefined {
  return value === "bash" || value === "powershell" ? value : undefined;
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return false;
  return ["true", "yes", "y", "on", "1"].includes(value.trim().toLowerCase());
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const stringValue = String(value).trim();
  return stringValue || undefined;
}

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function extractDescriptionFromMarkdown(content: string, skillName: string): string {
  const firstLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return `Local skill ${skillName}`;
  return firstLine
    .replace(/^#{1,6}\s+/, "")
    .replace(/[*_`]/g, "")
    .slice(0, MAX_LISTING_DESCRIPTION_CHARS);
}

function substituteArguments(content: string, args: string | undefined, argumentNames: string[]): string {
  if (args === undefined) return content;
  const parsedArgs = parseArguments(args);
  const original = content;

  for (let index = 0; index < argumentNames.length; index += 1) {
    const name = argumentNames[index];
    if (!name) continue;
    content = content.replace(new RegExp(`\\$${escapeRegExp(name)}(?![\\[\\w])`, "g"), parsedArgs[index] ?? "");
  }

  content = content.replace(/\$ARGUMENTS\[(\d+)\]/g, (_match, indexText: string) => {
    return parsedArgs[Number.parseInt(indexText, 10)] ?? "";
  });
  content = content.replace(/\$(\d+)(?!\w)/g, (_match, indexText: string) => {
    return parsedArgs[Number.parseInt(indexText, 10)] ?? "";
  });
  content = content.replaceAll("$ARGUMENTS", args);

  if (content === original && args.trim()) {
    return `${content}\n\nARGUMENTS: ${args}`;
  }
  return content;
}

function validateSkillArguments(input: SkillToolInput, skill: SkillDefinition): void {
  const requiresArgs = skill.argumentHint || skillUsesArgumentPlaceholders(skill);
  if (!requiresArgs) return;
  if (input.args !== undefined && input.args.trim() !== "") return;

  const hint = skill.argumentHint ?? "the required task-specific arguments";
  throw new Error(
    `Skill ${skill.name} requires args matching ${hint}. Call Skill with {"skill":"${skill.name}","args":"${hint}"}.`
  );
}

function skillUsesArgumentPlaceholders(skill: SkillDefinition): boolean {
  if (skill.content.includes("$ARGUMENTS")) return true;
  if (/\$\d+(?!\w)/.test(skill.content)) return true;
  return skill.argumentNames.some((name) =>
    new RegExp(`\\$${escapeRegExp(name)}(?![\\[\\w])`).test(skill.content)
  );
}

function parseArguments(args: string): string[] {
  if (!args.trim()) return [];
  const matches = args.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g);
  return Array.from(matches).map((match) => match[1] ?? match[2] ?? match[3] ?? "");
}

function formatSkillListing(skills: SkillDefinition[]): string {
  const lines = [
    "Available local skills from the repository root skills directory:",
    ...skills.map(formatSkillListItem),
    "",
    'When a skill matches the user task, call the Skill tool first. If the listing includes args, pass the concrete user-provided value in the Skill tool args field before doing any work.',
  ];

  return truncate(lines.join("\n"), MAX_LISTING_CHARS);
}

function formatSkillListItem(skill: SkillDefinition): string {
  const invocation = skill.argumentHint
    ? `call: {"skill":"${skill.name}","args":"${skill.argumentHint}"}`
    : `call: {"skill":"${skill.name}"}`;
  const details = [
    truncate(skill.description, MAX_LISTING_DESCRIPTION_CHARS),
    skill.whenToUse ? `when: ${truncate(skill.whenToUse, MAX_LISTING_DESCRIPTION_CHARS)}` : "",
    invocation,
    skill.paths?.length ? `paths: ${skill.paths.join(", ")}` : "",
  ].filter(Boolean);

  return `- ${skill.name}: ${details.join(" | ")}`;
}

function isModelInvocableSkill(skill: SkillDefinition): boolean {
  return !skill.disableModelInvocation && skill.userInvocable;
}

function normalizeSkillName(name: string): string {
  return name.trim().replace(/^\/+/, "");
}

function requireToolUseContext(context: ToolExecutionContext): AgentLoopToolUseContext {
  if (!context.toolUseContext) {
    throw new Error("Skill tool requires AgentLoopToolUseContext.");
  }
  return context.toolUseContext;
}

function cacheValidatedSkill(
  context: ToolExecutionContext,
  skillName: string,
  skill: SkillDefinition,
): void {
  const key = normalizeSkillName(skillName);
  const cache = validatedSkillCache.get(context) ?? new Map<string, SkillDefinition>();
  cache.set(key, skill);
  validatedSkillCache.set(context, cache);
}

function getCachedValidatedSkill(
  context: ToolExecutionContext,
  skillName: string,
): SkillDefinition | undefined {
  return validatedSkillCache.get(context)?.get(normalizeSkillName(skillName));
}

function getWorkspaceRoot(cwd = process.cwd()): string {
  const configured = process.env.AGENT_WORKSPACE_ROOT;
  if (configured) return path.resolve(configured);

  let current = path.resolve(cwd);
  while (true) {
    if (existsSync(path.join(current, "pnpm-workspace.yaml")) || existsSync(path.join(current, ".git"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(cwd);
    current = parent;
  }
}

async function getFileIdentity(filePath: string): Promise<string> {
  try {
    return await realpath(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function deduplicateSkillFiles(skills: SkillWithPath[]): SkillWithPath[] {
  const seen = new Set<string>();
  const result: SkillWithPath[] = [];
  for (const skill of skills) {
    if (seen.has(skill.fileIdentity)) continue;
    seen.add(skill.fileIdentity);
    result.push(skill);
  }
  return result;
}

function warnOnDuplicateSkillNames(skills: SkillWithPath[]): SkillWithPath[] {
  const firstByName = new Map<string, SkillWithPath>();
  for (const skill of skills) {
    const existing = firstByName.get(skill.skill.name);
    if (existing) {
      console.warn(
        `[skills] Duplicate skill name "${skill.skill.name}" from ${skill.filePath}; keeping later definition and overriding ${existing.filePath}.`,
      );
    }
    firstByName.set(skill.skill.name, skill);
  }
  return Array.from(firstByName.values());
}

async function isDirectory(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isDirectory();
  } catch {
    return false;
  }
}

function isPathInsideRoot(targetPath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function toWorkspaceRelative(filePath: string): string {
  const root = getWorkspaceRoot();
  const relative = path.relative(root, filePath);
  return relative || ".";
}

function normalizePathForPrompt(filePath: string): string {
  return process.platform === "win32" ? filePath.replace(/\\/g, "/") : filePath;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function hashString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} chars]`;
}
