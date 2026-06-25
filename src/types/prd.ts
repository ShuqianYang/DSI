// PRD 应用类型定义

import type {
  Entity,
  Trajectory,
  Region,
  GisData,
  AgentLoopEventType,
} from "@datasourceintelligence/shared";
import type { AgentLoopTaskView } from "@/lib/agentLoopTaskView";

export type { Entity, Trajectory, Region, GisData };

export interface User {
  id: string;
  name: string;
  phone: string;
  email: string;
  organization: string;
  role: string;
  avatar?: string;
}

export interface ThinkingStep {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  detail?: string;
  duration?: number; // ms
  category?: 'agent' | 'tool' | 'gis' | 'result';
  eventType?: AgentLoopEventType;
  toolName?: string;
  toolCallId?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  hasGisData?: boolean;
  gisData?: GisData;
  taskId?: string;            // 关联的后端 Agent 任务 ID
  thinking?: string;          // 智能体思考过程文本
  thinkingSteps?: ThinkingStep[]; // 分步思考/规划步骤
  isThinkingExpanded?: boolean;   // 思考过程是否展开（UI状态）
  agentLoopLogFilePath?: string;
}

export interface Alert {
  id: string;
  title: string;
  level: 'high' | 'medium' | 'low';
  timestamp: number;
  entityId?: string;
  regionId?: string;
  description: string;
  isRead: boolean;
}

export interface Notification {
  id: string;
  type: 'tip' | 'system';
  title: string;
  timestamp: number;
  taskId?: string;
  status?: string;
  content: string;
}

export interface SubTask {
  id: string;
  name: string;
  description?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  order: number;
}

export interface Task {
  id: string;
  name: string;
  type: 'daily' | 'weekly' | 'realtime';
  executeTime: number;
  status: 'running' | 'completed' | 'partial' | 'failed';
  dataCount: number;
  subTasks?: SubTask[];
  agentLoop?: AgentLoopTaskView;
}

export interface TaskEvent {
  id: string;
  taskId?: string;
  taskName?: string;
  title: string;
  content: string;
  status: 'success' | 'partial' | 'failed';
  timestamp: number;
  read?: boolean;
  gisData?: GisData;
}

export interface Subscription {
  id: string;
  name: string;
  type: string;
  schedule: string;
  nextExecuteTime: number;
  status: 'running' | 'paused';
  entityId?: string;
  regionId?: string;
}

export interface Insight {
  id: string;
  category: 'geopolitics' | 'military' | 'industry';
  title: string;
  summary: string;
  timestamp: number;
  riskLevel: 'high' | 'medium' | 'low' | 'safe';
  entityId?: string;
  regionId?: string;
  content: string;
  sources?: string[];
}

export interface UnfinishedRequirement {
  id: string;
  userId: string;
  timestamp: number;
  description: string;
  chatId: string;
  status: 'pending' | 'processing' | 'rejected';
  requirementId?: string;
}
