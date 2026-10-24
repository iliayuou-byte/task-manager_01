import { describe, expect, it } from 'bun:test';
import {
  deserializeTaskMarkdown,
  serializeTaskMarkdown,
} from './markdownParser.js';

describe('Copilot and personal table integration', () => {
  it('reads appended columns by header across both branch formats', () => {
    const common = [
      'Completed',
      'Task',
      'Date',
      'Time',
      'Duration',
      'Priority',
      'Tags',
      'Description',
      'Link',
      'CalendarEventId',
      'Log',
      'RecurrenceRule',
    ];
    for (const extra of [
      ['Id', 'CompletedAt', 'Important', 'Urgent', 'PriorityLocked'],
      ['Important', 'Urgent', 'PriorityLocked', 'Id', 'CompletedAt'],
    ]) {
      const headers = [...common, ...extra];
      const values: Record<string, string> = {
        Completed: '[ ]',
        Task: 'Class',
        Id: 'stable-id',
        Important: 'true',
        Urgent: 'false',
        PriorityLocked: 'true',
        CompletedAt: '2026-10-24T10:00:00Z',
      };
      const markdown = `| ${headers.join(' | ')} |\n| ${headers.map(() => ':---').join(' | ')} |\n| ${headers.map((header) => values[header] ?? '').join(' | ')} |`;
      const parsed = deserializeTaskMarkdown(markdown);
      const task = parsed.taskData.uncompleted[0];
      expect(task.id).toBe('stable-id');
      expect(task.important).toBe(true);
      expect(task.urgent).toBe(false);
      expect(task.priorityLocked).toBe(true);
      expect(
        deserializeTaskMarkdown(
          serializeTaskMarkdown(parsed.taskData, { timezone: 'Europe/Berlin' }),
        ).taskData.uncompleted[0],
      ).toEqual(task);
    }
  });
});
