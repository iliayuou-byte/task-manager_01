import type { EditableField, Field } from './types.js';

export const IS_PROD = process.env.NODE_ENV === 'production';

export const ALLOWED_USERS = process.env.TELEGRAM_BOT_ALLOWLIST
  ? process.env.TELEGRAM_BOT_ALLOWLIST.split(',').map((id) =>
      parseInt(id.trim(), 10),
    )
  : [];

// Table column configuration - type-safe with Task interface
export const TABLE_COLUMNS: ReadonlyArray<{
  key: Field;
  header: string;
}> = [
  { key: 'completed', header: 'Completed' },
  { key: 'name', header: 'Task' },
  { key: 'date', header: 'Date' },
  { key: 'time', header: 'Time' },
  { key: 'duration', header: 'Duration' },
  { key: 'priority', header: 'Priority' },
  { key: 'tags', header: 'Tags' },
  { key: 'description', header: 'Description' },
  { key: 'link', header: 'Link' },
  { key: 'calendarEventId', header: 'CalendarEventId' },
  { key: 'log', header: 'Log' },
  { key: 'recurrenceRule', header: 'RecurrenceRule' },
  { key: 'important', header: 'Important' },
  { key: 'urgent', header: 'Urgent' },
  { key: 'priorityLocked', header: 'PriorityLocked' },
] as const;

export const getInitialContent = (date: Date) => `---
last_synced: ${date.toISOString()}
total_tasks: 0
timezone: UTC
tags: []
---

# Task Table

| Completed | Task | Date | Time | Duration | Priority | Tags | Description | Link | CalendarEventId | Log | RecurrenceRule |
| :-------- | :--- | :--- | :--- | :------- | :------- | :--- | :---------- | :--- | :-------------- | :-- | :------------- |
`;

export enum Command {
  SETTIMEZONE = 'settimezone',
  MYTIMEZONE = 'mytimezone',
  TODAY = 'today',
  NOW = 'now',
  START = 'start',
  MENU = 'menu',
  BRAIN = 'brain',
  QUADRANT = 'quadrant',
  REMINDERS = 'reminders',
  LIST = 'list',
  ADD = 'add',
  COMPLETE = 'complete',
  EDIT = 'edit',
  REMOVE = 'remove',
  CLEARCOMPLETED = 'clearcompleted',
  ABOUT = 'about',
  SORT = 'sort',
  SEARCH = 'search',
  UNDO = 'undo',
  WHATSNEW = 'whatsnew',
}
type CommandCategory =
  | 'calendar-operation'
  | 'task-operation'
  | 'info'
  | 'config';
interface CommandType {
  desc: string;
  category: CommandCategory;
}
export const COMMANDS: Record<Command, CommandType> = {
  [Command.SETTIMEZONE]: {
    desc: 'set your timezone',
    category: 'config',
  },
  [Command.MYTIMEZONE]: {
    desc: 'show your current timezone',
    category: 'config',
  },
  [Command.QUADRANT]: {
    desc: 'set quadrant: /quadrant 1 task name',
    category: 'task-operation',
  },
  [Command.REMINDERS]: {
    desc: 'reminders: /reminders 09:00 19:00 or off',
    category: 'config',
  },
  [Command.START]: { desc: 'open the main menu', category: 'info' },
  [Command.MENU]: { desc: 'open the main menu', category: 'info' },
  [Command.BRAIN]: {
    desc: 'turn a brain dump into tasks for review',
    category: 'task-operation',
  },
  [Command.NOW]: {
    desc: 'choose the next task (optional: minutes available)',
    category: 'info',
  },
  [Command.TODAY]: {
    desc: "show today's tasks",
    category: 'info',
  },
  [Command.LIST]: {
    desc: 'list tasks (use: all, #tag)',
    category: 'info',
  },
  [Command.ADD]: {
    desc: 'add a new task',
    category: 'calendar-operation',
  },
  [Command.COMPLETE]: {
    desc: 'mark a task as complete by task name',
    category: 'task-operation',
  },
  [Command.EDIT]: {
    desc: 'edit a task by task name',
    category: 'task-operation',
  },
  [Command.REMOVE]: {
    desc: 'remove a task by task name',
    category: 'calendar-operation',
  },
  [Command.CLEARCOMPLETED]: {
    desc: 'clear all completed tasks',
    category: 'task-operation',
  },
  [Command.ABOUT]: {
    desc: 'show bot information and repository',
    category: 'info',
  },
  [Command.SORT]: {
    desc: 'sort tasks by priority or time',
    category: 'task-operation',
  },
  [Command.SEARCH]: {
    desc: 'search tasks by keyword',
    category: 'info',
  },
  [Command.UNDO]: {
    desc: 'undo last task action',
    category: 'task-operation',
  },
  [Command.WHATSNEW]: {
    desc: "see what's new in this version",
    category: 'info',
  },
} as const;

// Common timezones for quick selection
export const COMMON_TIMEZONES = [
  { name: '(UTC+0) London, Lisbon', value: 'Europe/London' },
  { name: '(UTC+1) Paris, Berlin, Lagos', value: 'Europe/Paris' },
  { name: '(UTC+2) Cairo, Athens', value: 'Europe/Athens' },
  { name: '(UTC+3) Moscow, Riyadh', value: 'Europe/Moscow' },
  { name: '(UTC+4) Dubai', value: 'Asia/Dubai' },
  { name: '(UTC+5:30) Mumbai, Delhi', value: 'Asia/Kolkata' },
  { name: '(UTC+7) Bangkok, Jakarta', value: 'Asia/Bangkok' },
  {
    name: '(UTC+8) Beijing, Singapore, Hong Kong, Taipei',
    value: 'Asia/Singapore',
  },
  { name: '(UTC+9) Tokyo, Seoul', value: 'Asia/Tokyo' },
  { name: '(UTC+10) Sydney', value: 'Australia/Sydney' },
  { name: '(UTC-8) Los Angeles', value: 'America/Los_Angeles' },
  { name: '(UTC-7) Denver', value: 'America/Denver' },
  { name: '(UTC-6) Chicago, Mexico City', value: 'America/Chicago' },
  { name: '(UTC-5) New York, Toronto', value: 'America/New_York' },
  { name: '(UTC-3) São Paulo, Buenos Aires', value: 'America/Sao_Paulo' },
] as const;

// Editable fields for tasks
export const EDITABLE_FIELDS: EditableField[] = [
  'name',
  'date',
  'time',
  'duration',
  'priority',
  'tags',
  'description',
  'link',
  'recurrenceRule',
] as const;
