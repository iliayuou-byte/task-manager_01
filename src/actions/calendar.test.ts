import { expect, spyOn, test } from 'bun:test';
import { Bot } from 'grammy';
import { googleCalendarService } from '../clients/google-calendar.js';
import logger from '../core/logger.js';
import type { TaskData } from '../core/types.js';
import {
  type BotContext,
  clearPendingCalendarOps,
  setPendingCalendarOps,
} from '../middlewares/session.js';
import { GitHubStorageProvider } from '../services/storage/GitHubStorageProvider.js';
import { registerCalendarAction } from './calendar.js';

test('calendar recovery details reach the private reply without entering diagnostic logs', async () => {
  const userId = 9899;
  const title = 'Private recovery meeting';
  const eventId = 'private-event-recovery-id';
  const originalProvider = process.env.STORAGE_PROVIDER;
  process.env.STORAGE_PROVIDER = 'github';
  const data: TaskData = {
    completed: [],
    uncompleted: [
      {
        id: 'task-recovery',
        name: title,
        date: '2026-10-25',
        time: '12:00',
        completed: false,
        tags: [],
      },
    ],
  };
  let reads = 0;
  const query = spyOn(
    GitHubStorageProvider.prototype,
    'queryTasks',
  ).mockImplementation(async () => ({
    metadata: { timezone: 'Europe/Berlin' },
    taskData:
      ++reads === 1
        ? structuredClone(data)
        : { uncompleted: [], completed: [] },
  }));
  const create = spyOn(googleCalendarService, 'createEvent').mockResolvedValue(
    eventId,
  );
  const logs: unknown[] = [];
  const log = spyOn(logger, 'errorWithContext').mockImplementation((entry) => {
    logs.push(entry);
  });
  const replies: string[] = [];
  const bot = new Bot<BotContext>('123:test', {
    botInfo: {
      id: 123,
      is_bot: true,
      first_name: 'Test',
      username: 'test_bot',
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
    },
  });
  bot.api.config.use(async (_prev, method, payload) => {
    if (
      method === 'sendMessage' &&
      'text' in payload &&
      typeof payload.text === 'string'
    )
      replies.push(payload.text);
    return {
      ok: true,
      result:
        method === 'sendMessage'
          ? {
              message_id: replies.length,
              date: 1,
              chat: { id: userId, type: 'private' },
              text: 'test',
            }
          : true,
    } as Awaited<ReturnType<typeof _prev>>;
  });
  registerCalendarAction(bot);
  setPendingCalendarOps(userId, [{ type: 'add', taskName: title }]);
  try {
    await bot.handleUpdate({
      update_id: 1,
      callback_query: {
        id: 'calendar-recovery',
        from: { id: userId, is_bot: false, first_name: 'User' },
        chat_instance: 'test',
        data: 'cal_yes',
        message: {
          message_id: 1,
          date: 1,
          chat: { id: userId, type: 'private', first_name: 'User' },
        },
      },
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(replies.join('\n')).toContain(title);
    expect(replies.join('\n')).toContain(eventId);
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toContain(title);
    expect(JSON.stringify(logs)).not.toContain(eventId);
  } finally {
    query.mockRestore();
    create.mockRestore();
    log.mockRestore();
    clearPendingCalendarOps(userId);
    if (originalProvider === undefined) delete process.env.STORAGE_PROVIDER;
    else process.env.STORAGE_PROVIDER = originalProvider;
  }
});
