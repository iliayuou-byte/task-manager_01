export enum Priority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent',
}

export interface Task {
  name: string;
  completed: boolean;
  // formatted as "YYYY-MM-DD"
  date?: string;
  // formatted as "HH:MM"
  time?: string;
  // formatted as "HH:MM"
  duration?: string;
  priority?: Priority;
  priorityLocked?: boolean;
  important?: boolean;
  urgent?: boolean;
  tags: string[];
  description?: string;
  // External link related to the task
  link?: string;
  // Google Calendar event ID
  calendarEventId?: string;
  // log by bot
  log?: string;
  // RRULE recurrence string (RFC 5545 subset), e.g. "FREQ=WEEKLY;BYDAY=MO"
  recurrenceRule?: string;
}

export type TaskTypeToOp = 'completed' | 'uncompleted' | 'none';
export type TaskData = Record<Exclude<TaskTypeToOp, 'none'>, Task[]>;

export type Field = keyof Task;

export type EditableField = Exclude<
  Field,
  'completed' | 'calendarEventId' | 'important' | 'urgent' | 'priorityLocked'
>;

export interface Metadata {
  last_synced?: string;
  total_tasks?: number;
  tags?: string[];
  table_header?: string;
  timezone?: string;
  ai_auto_priority?: string;
  ai_priority_rules?: string;
  reminder_times?: string;
  reminder_saved_times?: string;
  reminder_last_sent?: string;
  calendar_events?: string;
  calendar_source_name?: string;
  calendar_imported_at?: string;
  calendar_timezone?: string;
}

// GitHub Webhook Types
export interface GitHubCommitAuthor {
  name: string;
  email: string;
  username?: string;
}

export interface GitHubCommit {
  id: string;
  tree_id: string;
  message: string;
  timestamp: string;
  author: GitHubCommitAuthor;
  committer: GitHubCommitAuthor;
  added: string[];
  removed: string[];
  modified: string[];
  url: string;
}

export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  owner: {
    name: string;
    login: string;
  };
  html_url: string;
  default_branch: string;
}

export interface GitHubPusher {
  name: string;
  email: string;
}

export interface GitHubPushPayload {
  ref: string;
  before: string;
  after: string;
  created: boolean;
  deleted: boolean;
  forced: boolean;
  commits: GitHubCommit[];
  head_commit: GitHubCommit | null;
  repository: GitHubRepository;
  pusher: GitHubPusher;
  compare: string;
}

// Task Diff Types for GitHub Sync Notifications
export interface TaskChange {
  before: Task;
  after: Task;
  changes: string[];
}

export interface TaskDiff {
  metadata?: {
    before: Metadata;
    after: Metadata;
    changes: string[];
  };
  added: Task[];
  removed: Task[];
  modified: TaskChange[];
  completed: Task[];
  uncompleted: Task[];
}

export interface CommitInfo {
  sha: string;
  message: string;
  author: string;
  url: string;
}

export interface CalendarOpSession {
  type: 'add' | 'remove' | 'update';
  taskName: string;
  calendarEventId?: string;
}
