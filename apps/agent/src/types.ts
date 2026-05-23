export interface CallSession {
  id: string;
  providerCallId?: string;
  orgId?: string;
  contactName: string;
  phone: string;
  direction: 'inbound' | 'outbound';
  status: 'active' | 'completed' | 'missed' | 'blocked' | 'transferred';
  startedAt: Date;
  endedAt?: Date;
  duration: number;
  transcript: TranscriptLine[];
  actions: CallActionRecord[];
  summary?: string;
  outcome?: string;
}

export interface TranscriptLine {
  speaker: 'agent' | 'human';
  text: string;
  timestamp: string;
}

export interface CallActionRecord {
  type: string;
  description: string;
  timestamp: string;
}

export interface ContactMemory {
  id: string;
  contactId: string;
  text: string;
  source: string;
  createdAt: string;
}

export interface Contact {
  id: string;
  name: string;
  phone: string;
  category: string;
  starred: boolean;
  doNotCall: boolean;
  memories: ContactMemory[];
}

export interface AgentInstructions {
  systemPrompt: string;
  greeting: string;
  transferRules: string[];
  approvalRequired: string[];
}

export interface ToolResult {
  success: boolean;
  message: string;
  data?: unknown;
}

export type WSMessage =
  | { type: 'state'; activeCalls: CallSession[] }
  | { type: 'call_started'; call: CallSession }
  | { type: 'call_ended'; call: CallSession }
  | { type: 'call_transcript'; callId: string; line: TranscriptLine }
  | { type: 'call_action'; callId: string; action: CallActionRecord }
  | { type: 'approval_created'; approval: unknown }
  | { type: 'cost_update'; cost: unknown }
  | { type: 'error'; error: string };
