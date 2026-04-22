export type ClaudeLikeHookEvent =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PreCompact'
  | 'SessionEnd';

export type HeartbeatState = {
  lastHeartbeatAt?: number;
};

export type EditBlock = {
  oldText?: string;
  newText?: string;
};

export type FileHeartbeatRequest = {
  type: 'file';
  entity: string;
  projectFolder?: string;
  category?: string;
  isWrite?: boolean;
  lineChanges?: number;
  sourceEvent?: ClaudeLikeHookEvent;
};

export type SessionHeartbeatRequest = {
  type: 'session';
  entity: string;
  projectFolder?: string;
  category?: string;
  stateKey: string;
  sourceEvent?: ClaudeLikeHookEvent;
};

export type HeartbeatRequest = FileHeartbeatRequest | SessionHeartbeatRequest;
