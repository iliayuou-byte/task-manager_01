import { expect, test } from 'bun:test';
import { plannerPreferences } from './dayPlanner.js';
import { parseRoutineBlocks, starterTemplates } from './routineTemplates.js';

test('template input validates time, overnight overlaps and bounded block counts', () => {
  expect(
    parseRoutineBlocks('23:00-07:00 Сон\n07:00-07:30 Завтрак'),
  ).toHaveLength(2);
  for (const input of [
    '',
    '08:00-08:00 Сон',
    '25:00-26:00 Сон',
    '23:00-07:00 Сон\n06:30-07:30 Завтрак',
    '09:00-11:00 Работа\n10:00-12:00 Учёба',
    Array(25).fill('08:00-08:30 Блок').join('\n'),
  ])
    expect(() => parseRoutineBlocks(input)).toThrow();
  expect(starterTemplates()).toHaveLength(3);
});
test('legacy preferences remain valid while dangling weekday assignments are rejected', () => {
  expect(
    plannerPreferences({
      planner_preferences: '{"start":"09:00","end":"22:00","busy":[]}',
    }).templates,
  ).toBeUndefined();
  for (const weekTemplates of [{ '1': 'missing' }, { '8': 'study' }, []])
    expect(() =>
      plannerPreferences({
        planner_preferences: JSON.stringify({
          start: '09:00',
          end: '22:00',
          busy: [],
          templates: starterTemplates(),
          weekTemplates,
        }),
      }),
    ).toThrow();
});
