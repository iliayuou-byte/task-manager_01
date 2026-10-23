import { afterEach, expect, spyOn, test } from 'bun:test';
import type { Bot } from 'grammy';
import type { Metadata, TaskData } from '../core/types.js';
import type { BotContext } from '../middlewares/session.js';
import {
  deserializeTaskMarkdown,
  serializeTaskMarkdown,
} from './markdownParser.js';
import { checkReminders } from './reminders.js';
import { GitHubStorageProvider } from './storage/GitHubStorageProvider.js';

const originalAllowlist = process.env.TELEGRAM_BOT_ALLOWLIST;
const originalOwner = process.env.BOT_OWNER_ID;
afterEach(() => {
  if (originalAllowlist === undefined)
    delete process.env.TELEGRAM_BOT_ALLOWLIST;
  else process.env.TELEGRAM_BOT_ALLOWLIST = originalAllowlist;
  if (originalOwner === undefined) delete process.env.BOT_OWNER_ID;
  else process.env.BOT_OWNER_ID = originalOwner;
});

test('weekday checklist opens at configured wake and is removed one hour later', async () => {
  process.env.TELEGRAM_BOT_ALLOWLIST = '111';
  delete process.env.BOT_OWNER_ID;
  let data: { taskData: TaskData; metadata: Metadata } = {
    taskData: { completed: [], uncompleted: [] },
    metadata: {
      timezone: 'Europe/Berlin',
      wake_weekday_time: '08:00',
      morning_items: JSON.stringify(['Завтрак', 'Зарядка']),
    },
  };
  const query = spyOn(
    GitHubStorageProvider.prototype,
    'queryTasks',
  ).mockImplementation(async () => structuredClone(data));
  const save = spyOn(
    GitHubStorageProvider.prototype,
    'saveTasks',
  ).mockImplementation(async (taskData, metadata) => {
    data = structuredClone({ taskData, metadata });
    return true;
  });
  const sent: string[] = [];
  const deleted: number[] = [];
  const bot = {
    api: {
      sendMessage: async (_id: number, text: string) => {
        sent.push(text);
        return { message_id: sent.length };
      },
      deleteMessage: async (_id: number, messageId: number) => {
        deleted.push(messageId);
        return true;
      },
    },
  } as unknown as Bot<BotContext>;
  try {
    await checkReminders(bot, new Date('2026-10-12T06:02:00Z'));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('08:00–09:00');
    expect(sent[0]).toContain('Завтрак');
    expect(data.metadata.morning_expires_at).toBe('2026-10-12T07:00:00.000Z');
    await checkReminders(bot, new Date('2026-10-12T06:59:00Z'));
    expect(deleted).toHaveLength(0);
    await checkReminders(bot, new Date('2026-10-12T07:00:00Z'));
    expect(deleted).toEqual([1]);
    expect(data.metadata.morning_message_id).toBeUndefined();
    await checkReminders(bot, new Date('2026-10-12T07:01:00Z'));
    expect(sent).toHaveLength(1);
    await checkReminders(bot, new Date('2026-10-13T06:02:00Z'));
    expect(sent).toHaveLength(2);
    await checkReminders(bot, new Date('2026-10-17T08:02:00Z'));
    expect(sent).toHaveLength(3);
    expect(sent[2]).not.toContain('Завтрак');
  } finally {
    query.mockRestore();
    save.mockRestore();
  }
});

test('checklist settings and active message survive Markdown storage', () => {
  const metadata: Metadata = {
    morning_enabled: 'true',
    morning_items: JSON.stringify(['Гигиена', 'План на день']),
    morning_active_items: JSON.stringify(['Завтрак']),
    morning_done: '[0]',
    morning_active_date: '2026-10-12',
    morning_message_id: '432',
    morning_expires_at: '2026-10-12T07:00:00.000Z',
    morning_wake_time: '08:00',
  };
  const { metadata: restored } = deserializeTaskMarkdown(
    serializeTaskMarkdown({ uncompleted: [], completed: [] }, metadata),
  );
  for (const key of Object.keys(metadata) as Array<keyof Metadata>)
    expect(restored[key]).toBe(metadata[key]);
});
