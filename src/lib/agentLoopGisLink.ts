export function buildAgentLoopGisLinkId(taskId: string, gisOutputId: string): string {
  return `agent-loop:${taskId}:${gisOutputId}`;
}

export interface AgentLoopGisOutputLinkInput {
  taskId: string;
  toolCallId?: string;
  index: number;
}

export function buildAgentLoopGisOutputLinkId({
  taskId,
  toolCallId,
  index,
}: AgentLoopGisOutputLinkInput): string {
  return buildAgentLoopGisLinkId(taskId, toolCallId || `idx-${index}`);
}
