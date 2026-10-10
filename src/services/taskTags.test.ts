import { expect, test } from 'bun:test';
import { normalizeTaskTags, taskTagPrompt } from './taskTags.js';

test('keeps valid domain tags and rejects invented AI labels', () => {
  expect(
    normalizeTaskTags(['#дом', 'дом', 'срочно', 'здоровье', 'ошибка']),
  ).toEqual(['дом', 'здоровье']);
  expect(normalizeTaskTags(['покупки', 'важно'])).toEqual(['покупки']);
});

test('supports explicit custom tags while not attaching unrelated user tags', () => {
  expect(
    normalizeTaskTags(['Кюр', 'проекты', 'чужой'], ['Кюр', 'работа']),
  ).toEqual(['Кюр', 'проекты']);
  expect(normalizeTaskTags([], ['Кюр'])).toEqual([]);
  expect(taskTagPrompt()).toContain('never importance or urgency');
});
