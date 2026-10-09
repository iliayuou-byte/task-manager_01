import { TABLE_COLUMNS } from '../core/config.js';
import logger from '../core/logger.js';
import type { Metadata, Priority, Task, TaskData } from '../core/types.js';
import { escapeMarkdownTable, formatTags, parseTags } from '../utils/index.js';
import { validateTask } from '../utils/validators.js';

// Regex patterns for content parsing
export const FRONTMATTER_KEY_VALUE_PATTERN = /^(\w+):\s*(.+)$/;
export const FRONTMATTER_KEY_ONLY_PATTERN = /^\w+:$/;
export const TABLE_SEPARATOR_PATTERN = /^\|[\s:-]+\|/;

// Map column indices dynamically
export const getColIdx = (key: keyof Task): number =>
  TABLE_COLUMNS.findIndex((col) => col.key === key);

export const COL_IDX = {
  COMPLETED: getColIdx('completed'),
  NAME: getColIdx('name'),
  DATE: getColIdx('date'),
  TIME: getColIdx('time'),
  DURATION: getColIdx('duration'),
  PRIORITY: getColIdx('priority'),
  TAGS: getColIdx('tags'),
  DESCRIPTION: getColIdx('description'),
  LINK: getColIdx('link'),
  CALENDAR_EVENT_ID: getColIdx('calendarEventId'),
  RECURRENCE_RULE: getColIdx('recurrenceRule'),
  IMPORTANT: getColIdx('important'),
  URGENT: getColIdx('urgent'),
  LOCKED: getColIdx('priorityLocked'),
};

export interface ParseResult {
  metadata: Metadata;
  tasks: Task[];
  tableHeader?: string;
}

// Helper to get cell value or undefined if empty
const getCell = (cells: string[], index: number): string | undefined =>
  cells[index] && cells[index].length > 0 ? cells[index] : undefined;

export const parseMarkdown = (content: string): ParseResult => {
  if (!content || content.trim().length === 0) {
    return { metadata: {}, tasks: [] };
  }

  const lines = content.split('\n');
  const metadata: Metadata = {};
  const tasks: Task[] = [];

  let inFrontmatter = false;
  let inTable = false;
  let tableStartIndex = -1;
  let currentFrontmatterKey: string | null = null;
  let tableHeader: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Handle YAML frontmatter
    if (line === '---') {
      if (!inFrontmatter) {
        inFrontmatter = true;
      } else {
        inFrontmatter = false;
        currentFrontmatterKey = null;
      }
      continue;
    }

    if (inFrontmatter) {
      // Handle single-line key-value pairs
      const match = line.match(FRONTMATTER_KEY_VALUE_PATTERN);
      if (match) {
        const [, key, value] = match;
        if (
          key === 'reminder_times' ||
          key === 'reminder_last_sent' ||
          key === 'reminder_saved_times' ||
          key === 'planner_notify_times' ||
          key === 'planner_last_sent'
        ) {
          metadata[key] = value;
        } else if (key === 'planner_preferences') {
          try {
            const preferences: unknown = JSON.parse(value);
            if (typeof preferences === 'string')
              metadata.planner_preferences = preferences;
          } catch {
            /* Invalid configuration is not imported. */
          }
        } else if (key === 'ai_auto_priority') {
          metadata.ai_auto_priority = value;
        } else if (key === 'ai_priority_rules') {
          try {
            const rules: unknown = JSON.parse(value);
            if (typeof rules === 'string') metadata.ai_priority_rules = rules;
          } catch {
            metadata.ai_priority_rules = value;
          }
        } else if (key === 'last_synced') {
          metadata.last_synced = value;
        } else if (key === 'total_tasks') {
          const parsed = parseInt(value, 10);
          if (!Number.isNaN(parsed)) {
            metadata.total_tasks = parsed;
          }
        } else if (key === 'timezone') {
          metadata.timezone = value;
        } else if (key === 'tags') {
          currentFrontmatterKey = 'tags';
          metadata.tags = [];
        }
      } else if (line.startsWith('- ') && currentFrontmatterKey === 'tags') {
        // Handle array items
        const tag = line.substring(2).trim();
        if (tag && metadata.tags) {
          metadata.tags.push(tag);
        }
      } else if (line.match(FRONTMATTER_KEY_ONLY_PATTERN)) {
        // Handle key without value (for arrays)
        const key = line.replace(':', '').trim();
        if (key === 'tags') {
          currentFrontmatterKey = 'tags';
          metadata.tags = [];
        }
      }
      continue;
    }

    // Capture markdown header before table (e.g., # Task Tracker)
    if (!inTable && !inFrontmatter && !tableHeader && line.match(/^#+ /)) {
      tableHeader = line;
    }

    // Detect table start (header row with pipes)
    if (
      line.startsWith('|') &&
      line.includes('Completed') &&
      line.includes('Task')
    ) {
      inTable = true;
      tableStartIndex = i;
      continue;
    }

    // Skip separator row
    if (
      inTable &&
      tableStartIndex === i - 1 &&
      line.match(TABLE_SEPARATOR_PATTERN)
    ) {
      continue;
    }

    // Parse table rows
    if (inTable && line.startsWith('|')) {
      try {
        const cells = line
          .split('|')
          .slice(1, -1) // Remove artifacts before first | and after last |
          .map((cell) => cell.trim());

        if (cells.length >= 2) {
          const completed =
            cells[COL_IDX.COMPLETED].includes('[x]') ||
            cells[COL_IDX.COMPLETED].includes('[X]');
          const taskName = cells[COL_IDX.NAME];

          if (!taskName || taskName.length === 0) {
            logger.warnWithContext({
              op: 'PARSE_MARKDOWN',
              message: `Skipping row with empty task name at line ${i + 1}`,
            });
            continue;
          }

          const task: Task = {
            completed,
            priorityLocked:
              getCell(cells, COL_IDX.LOCKED) === undefined
                ? undefined
                : cells[COL_IDX.LOCKED] === 'true',
            important:
              getCell(cells, COL_IDX.IMPORTANT) === undefined
                ? undefined
                : cells[COL_IDX.IMPORTANT] === 'true',
            urgent:
              getCell(cells, COL_IDX.URGENT) === undefined
                ? undefined
                : cells[COL_IDX.URGENT] === 'true',
            name: taskName,
            date: getCell(cells, COL_IDX.DATE),
            time: getCell(cells, COL_IDX.TIME),
            duration: getCell(cells, COL_IDX.DURATION),
            priority: getCell(cells, COL_IDX.PRIORITY) as Priority | undefined,
            tags: parseTags(getCell(cells, COL_IDX.TAGS)),
            description: getCell(cells, COL_IDX.DESCRIPTION),
            link: getCell(cells, COL_IDX.LINK),
            calendarEventId: getCell(cells, COL_IDX.CALENDAR_EVENT_ID),
            recurrenceRule: getCell(cells, COL_IDX.RECURRENCE_RULE),
          };

          tasks.push(task);
        }
      } catch (rowError) {
        logger.warnWithContext({
          op: 'PARSE_MARKDOWN',
          error: rowError,
          message: `Error parsing row at line ${i + 1}`,
        });
      }
    } else if (inTable && !line.startsWith('|')) {
      // End of table
      break;
    }
  }

  if (tableHeader) {
    metadata.table_header = tableHeader;
  }

  return { metadata, tasks, tableHeader };
};

export const TABLE_HEADER = `| ${TABLE_COLUMNS.map((col) => col.header).join(' | ')} |`;
export const TABLE_SEPARATOR = `| ${TABLE_COLUMNS.map(() => ':--------').join(' | ')} |`;

export const deserializeTaskMarkdown = (
  content: string,
): {
  metadata: Metadata;
  taskData: TaskData;
} => {
  try {
    const { metadata, tasks } = parseMarkdown(content);

    const completedTasks: Task[] = [];
    const uncompletedTasks: Task[] = [];

    tasks.forEach((task, index) => {
      const result = validateTask(task);
      if (!result.valid) {
        logger.warnWithContext({
          op: 'VALIDATE_TASKS',
          message: `Task at index ${index} ("${task.name}") has validation warnings: ${result.errors.join(', ')}`,
        });
      }

      if (task.completed) {
        completedTasks.push(task);
      } else {
        uncompletedTasks.push(task);
      }
    });

    return {
      metadata,
      taskData: {
        completed: completedTasks,
        uncompleted: uncompletedTasks,
      },
    };
  } catch (error) {
    throw new Error(
      `Failed to parse md tasks: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
};

export const serializeTaskMarkdown = (
  tasks: TaskData,
  metadata: Metadata,
): string => {
  const lines: string[] = [];

  lines.push('---');
  if (metadata.planner_preferences)
    lines.push(
      `planner_preferences: ${JSON.stringify(metadata.planner_preferences)}`,
    );
  if (metadata.planner_notify_times)
    lines.push(`planner_notify_times: ${metadata.planner_notify_times}`);
  if (metadata.planner_last_sent)
    lines.push(`planner_last_sent: ${metadata.planner_last_sent}`);
  if (metadata.ai_auto_priority)
    lines.push(`ai_auto_priority: ${metadata.ai_auto_priority}`);
  if (metadata.ai_priority_rules)
    lines.push(
      `ai_priority_rules: ${JSON.stringify(metadata.ai_priority_rules)}`,
    );
  if (metadata.reminder_saved_times)
    lines.push(`reminder_saved_times: ${metadata.reminder_saved_times}`);
  if (metadata.reminder_times)
    lines.push(`reminder_times: ${metadata.reminder_times}`);
  if (metadata.reminder_last_sent)
    lines.push(`reminder_last_sent: ${metadata.reminder_last_sent}`);
  if (metadata.last_synced) {
    lines.push(`last_synced: ${metadata.last_synced}`);
  }
  lines.push(`total_tasks: ${tasks.uncompleted.length}`);
  if (metadata.timezone) {
    lines.push(`timezone: ${metadata.timezone}`);
  }
  if (metadata.tags && metadata.tags.length > 0) {
    lines.push('tags:');
    for (const tag of metadata.tags) {
      lines.push(`  - ${tag}`);
    }
  }
  lines.push('---');
  lines.push('');

  lines.push(metadata.table_header || '# Task Table');
  lines.push('');
  lines.push(TABLE_HEADER);
  lines.push(TABLE_SEPARATOR);

  tasks.uncompleted.concat(tasks.completed).forEach((task) => {
    const row = TABLE_COLUMNS.map((col) => {
      const value = task[col.key];

      if (col.key === 'completed') {
        return task.completed ? '[x]' : '[ ]';
      }

      if (col.key === 'tags') {
        return formatTags(task.tags);
      }

      return escapeMarkdownTable(
        value === undefined ? undefined : String(value),
      );
    });

    lines.push(`| ${row.join(' | ')} |`);
  });

  return lines.join('\n');
};
