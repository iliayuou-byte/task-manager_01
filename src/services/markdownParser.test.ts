import { describe, expect, it } from 'bun:test';
import {
  deserializeTaskMarkdown,
  serializeTaskMarkdown,
} from './markdownParser.js';

describe('Personal fields in Markdown', () => {
  it('reads a legacy table and preserves log, ID and completion timestamp on roundtrip', () => {
    const legacy =
      '| Completed | Task | Date | Time | Duration | Priority | Tags | Description | Link | CalendarEventId | Log | RecurrenceRule |\n| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n| [x] | Read | 2026-10-01 | | | | #study | | | | Completed 2026-10-24 12:00:00 (Europe/Berlin) | |';
    const parsed = deserializeTaskMarkdown(legacy);
    expect(parsed.taskData.completed[0].log).toContain('2026-10-24');
    parsed.taskData.completed[0].id = 'a';
    parsed.taskData.completed[0].completedAt = '2026-10-24T10:00:00Z';
    const result = deserializeTaskMarkdown(
      serializeTaskMarkdown(parsed.taskData, parsed.metadata),
    );
    expect(result.taskData.completed[0].id).toBe('a');
    expect(result.taskData.completed[0].completedAt).toBe(
      '2026-10-24T10:00:00Z',
    );
    expect(result.taskData.completed[0].log).toBe(
      parsed.taskData.completed[0].log,
    );
  });
});
