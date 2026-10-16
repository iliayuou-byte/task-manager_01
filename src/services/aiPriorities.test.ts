import { expect, test } from 'bun:test';
import type { Task } from '../core/types.js';
import { applyPriorityProposals, priorityPrompt } from './aiPriorities.js';
import {
  deserializeTaskMarkdown,
  serializeTaskMarkdown,
} from './markdownParser.js';

const task: Task = { name: 'A', completed: false, tags: [] };

test('rules, disabled auto and manual locks survive markdown roundtrip', () => {
  const rules =
    'Учёба важна.\nСрочно: дедлайн ≤ 2 дня. "Лекарства" важны | всегда.';
  const parsed = deserializeTaskMarkdown(
    serializeTaskMarkdown(
      { uncompleted: [{ ...task, priorityLocked: true }], completed: [] },
      { timezone: 'UTC', ai_priority_rules: rules, ai_auto_priority: 'off' },
    ),
  );
  expect(parsed.metadata.ai_priority_rules).toBe(rules);
  expect(parsed.metadata.ai_auto_priority).toBe('off');
  expect(parsed.taskData.uncompleted[0].priorityLocked).toBe(true);
  expect(priorityPrompt(parsed.metadata)).toContain(
    'Automatic inference is OFF',
  );
});

test('reclassification preserves text and dates, skips uncertain results and source mutation', () => {
  const first = { ...task, date: '2026-10-07' };
  const second = { ...task, name: 'B', important: true, urgent: true };
  const data = { uncompleted: [second, first], completed: [] };
  const result = applyPriorityProposals(data, [
    { task: first, quadrant: 3, reason: 'deadline' },
    { task: second, quadrant: null, reason: 'unknown' },
  ]);
  expect(result.uncompleted[1]).toEqual({
    ...first,
    important: false,
    urgent: true,
  });
  expect(result.uncompleted[0]).toEqual(second);
  expect(data.uncompleted[1].important).toBeUndefined();
});

test('changed or locked tasks and duplicate targets abort reclassification', () => {
  const proposal = { task, quadrant: 2, reason: 'goal' };
  expect(() =>
    applyPriorityProposals(
      { uncompleted: [{ ...task, name: 'changed' }], completed: [] },
      [proposal],
    ),
  ).toThrow();
  expect(() =>
    applyPriorityProposals(
      { uncompleted: [{ ...task, priorityLocked: true }], completed: [] },
      [{ ...proposal, task: { ...task, priorityLocked: true } }],
    ),
  ).toThrow();
  expect(() =>
    applyPriorityProposals({ uncompleted: [task], completed: [] }, [
      proposal,
      proposal,
    ]),
  ).toThrow();
});
