// Shared types for the Plan Reviewer.

export interface Comment {
  id: string;
  anchor: string;
  anchorStart: number;
  anchorEnd: number;
  note: string;
  resolved: boolean;
}

export interface PlanVersion {
  version: number;
  text: string;
  timestamp: string;
  comments: Comment[];
}

export type ConversationRole = 'claude' | 'user';
export type ConversationType = 'plan' | 'feedback' | 'approval' | 'clarification';

export interface ConversationEntry {
  role: ConversationRole;
  type: ConversationType;
  content: string;
  timestamp: string;
  planVersion?: number;
}

export type SessionStatus = 'active' | 'approved' | 'interrupted';

export interface SessionApproval {
  type: 'approved' | 'approved_with_notes';
  notes?: string;
}

export interface Session {
  id: string;
  createdAt: string;
  updatedAt: string;
  planVersions: PlanVersion[];
  conversation: ConversationEntry[];
  status: SessionStatus;
  approval?: SessionApproval;
}
