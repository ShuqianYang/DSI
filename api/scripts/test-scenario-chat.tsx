import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { isValidElement } from "react";
import { getScenarioProfile } from "@datasourceintelligence/shared";

function unwrapDefault(moduleValue: unknown) {
  return (moduleValue as { default?: unknown }).default ?? moduleValue;
}

const ScenarioSwitcher = unwrapDefault(await import("../../src/components/chat/ScenarioSwitcher.tsx"));
const ChatHeader = unwrapDefault(await import("../../src/components/chat/ChatHeader.tsx"));
const ChatInput = unwrapDefault(await import("../../src/components/chat/ChatInput.tsx"));
const ChatPanel = unwrapDefault(await import("../../src/components/ChatPanel.tsx"));

const scenario = getScenarioProfile("marine");

const switcher = ScenarioSwitcher({
  scenario,
  onScenarioChange: () => undefined,
});
const header = ChatHeader({
  title: scenario.chatTitle,
  subtitle: scenario.chatSubtitle,
  onHistoryToggle: () => undefined,
});
const input = ChatInput({
  inputValue: "",
  isLoading: false,
  inputRef: { current: null },
  placeholder: scenario.inputPlaceholder,
  onChange: () => undefined,
  onSend: () => undefined,
});

assert.ok(isValidElement(switcher), "ScenarioSwitcher should render a React element");
assert.ok(isValidElement(header), "ChatHeader should render with scenario copy");
assert.ok(isValidElement(input), "ChatInput should render with scenario placeholder");
assert.equal(typeof ChatPanel, "function", "ChatPanel should export a component");

const chatPanelSource = await readFile("src/components/ChatPanel.tsx", "utf8");
const messageListSource = await readFile("src/components/chat/ChatMessageList.tsx", "utf8");
const useTaskChatSource = await readFile("src/hooks/useTaskChat.ts", "utf8");
const prdTypesSource = await readFile("src/types/prd.ts", "utf8");

assert.ok(chatPanelSource.includes("scenario?: ScenarioProfile"), "ChatPanel should accept a scenario profile");
assert.ok(chatPanelSource.includes("onScenarioChange"), "ChatPanel should expose a scenario change callback");
assert.ok(chatPanelSource.includes("addSystemMessage(scenario.switchMessage)"), "ChatPanel should add a separator when scenario changes");
assert.ok(messageListSource.includes("msg.role === 'system'"), "ChatMessageList should render system messages separately");
assert.ok(messageListSource.includes("nonSystemMessages.length === 0"), "ChatMessageList should keep scenario quick actions visible when only system separators exist");
assert.ok(useTaskChatSource.includes("addSystemMessage"), "useTaskChat should expose addSystemMessage");
assert.ok(prdTypesSource.includes("'system'"), "ChatMessage role should include system");

console.log("PASS scenario chat smoke test");
