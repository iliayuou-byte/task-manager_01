import { describe, expect, it } from 'bun:test';
import { Bot, session } from 'grammy';
import type { TaskData } from '../core/types.js';
import type { BotContext, SessionData } from '../middlewares/session.js';
import { createPersonalState, localDate } from '../services/personal.js';
import { PersonalStore } from '../services/personalStore.js';
import { createPersonalComposer } from './personal.js';

const fixture = (saveResult: boolean | Error = true) => {
  let state = createPersonalState(1);
  let tasks: TaskData = { completed: [], uncompleted: [] };
  let revision = 0;
  const messages: string[] = [];
  const documents: string[] = [];
  const store = new PersonalStore(1, {
    read: async () => ({
      state: structuredClone(state),
      revision: String(revision),
    }),
    write: async (next, expected) => {
      if (expected !== String(revision))
        throw Object.assign(new Error('Conflict'), { status: 409 });
      state = structuredClone(next);
      revision++;
    },
  });
  const bot = new Bot<BotContext>('123456:fake', {
    botInfo: {
      id: 123456,
      is_bot: true,
      first_name: 'Test',
      username: 'TestBot',
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
    },
    client: {
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        const method = String(url).split('/').pop();
        const payload =
          typeof init?.body === 'string'
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : {};
        if (method === 'sendMessage') messages.push(String(payload.text));
        if (method === 'sendDocument') documents.push(method);
        return new Response(
          JSON.stringify({
            ok: true,
            result:
              method === 'answerCallbackQuery'
                ? true
                : {
                    message_id: messages.length + documents.length,
                    date: 1,
                    chat: { id: 1, type: 'private' },
                    text: 'ok',
                  },
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      },
    },
  });
  bot.use(session<SessionData, BotContext>({ initial: () => ({}) }));
  bot.use(
    createPersonalComposer({
      ownerId: 1,
      store: async () => store,
      enabled: () => true,
      query: async () => ({
        metadata: { timezone: 'Europe/Berlin' },
        taskData: structuredClone(tasks),
      }),
      save: async (next) => {
        if (saveResult instanceof Error) throw saveResult;
        if (!saveResult) return false;
        tasks = structuredClone(next);
        return true;
      },
    }),
  );
  let updateId = 0;
  const message = (text: string, id = 1, group = false) =>
    bot.handleUpdate({
      update_id: ++updateId,
      message: {
        message_id: updateId,
        date: Math.floor(Date.now() / 1000),
        chat: group
          ? { id: -1, type: 'group', title: 'Group' }
          : { id, type: 'private', first_name: 'User' },
        from: { id, is_bot: false, first_name: 'User' },
        text,
        ...(text.startsWith('/')
          ? {
              entities: [
                {
                  type: 'bot_command' as const,
                  offset: 0,
                  length: text.split(' ')[0].length,
                },
              ],
            }
          : {}),
      },
    });
  const callback = (data: string, id = 1) =>
    bot.handleUpdate({
      update_id: ++updateId,
      callback_query: {
        id: String(updateId),
        from: { id, is_bot: false, first_name: 'User' },
        chat_instance: 'test',
        data,
        message: {
          message_id: 1,
          date: 1,
          chat: { id, type: 'private', first_name: 'User' },
        },
      },
    });
  return { store, messages, documents, message, callback, tasks: () => tasks };
};

describe('Personal Telegram workflow', () => {
  it('initializes legacy task IDs before enabling reminders', async () => {
    const f = fixture();
    f.tasks().uncompleted.push({
      name: 'Legacy meeting',
      completed: false,
      tags: [],
      date: '2026-10-25',
      time: '12:30',
    });
    await f.message('/reminders on');
    expect(f.tasks().uncompleted[0].id).toBeDefined();
    expect((await f.store.read()).reminders.enabled).toBe(true);
  });
  it('preserves both fallback uses when returning to normal', async () => {
    const f = fixture();
    await f.message('/late');
    await f.message('/lowenergy');
    await f.message('/normal');
    await f.message('/week');
    expect(f.messages[f.messages.length - 1]).toContain(
      'Режим «проспал»: 1 · «нет сил»: 1',
    );
  });
  it('does not confirm or enable reminders when saving legacy IDs fails', async () => {
    const f = fixture(false);
    f.tasks().uncompleted.push({ name: 'Legacy', completed: false, tags: [] });
    await f.message('/reminders on');
    expect((await f.store.read()).reminders.enabled).toBe(false);
    expect(f.tasks().uncompleted[0].id).toBeUndefined();
    await f.message('/inbox Failed');
    expect(f.tasks().uncompleted).toHaveLength(1);
    expect(f.messages.some((text) => text.startsWith('Записано'))).toBe(false);
  });
  it('captures a task without AI, plans it, switches modes and completes it', async () => {
    const f = fixture();
    await f.message('Открыть конспект #study');
    expect(f.tasks().uncompleted[0].name).toBe('Открыть конспект');
    expect(f.tasks().uncompleted[0].tags).toEqual(['study']);
    const id = f.tasks().uncompleted[0].id!;
    const date = localDate(new Date(), 'Europe/Berlin');
    await f.callback(`pf:${date}:${id}`);
    await f.message('/morning');
    await f.message('/late');
    expect((await f.store.read()).days[date].mode).toBe('late');
    await f.message('/lowenergy');
    expect((await f.store.read()).days[date].mode).toBe('low');
    await f.callback(`pd:${id}`);
    expect(f.tasks().uncompleted[0].completed).toBe(true);
    expect(f.tasks().uncompleted[0].completedAt).toBeDefined();
  });

  it('refuses another user and group chat, including export and consent callbacks', async () => {
    const f = fixture();
    await f.message('/inbox secret', 2);
    await f.message('/inbox secret', 1, true);
    await f.callback('pc:consent', 2);
    await f.message('/coaching export', 2);
    expect(f.tasks().uncompleted).toHaveLength(0);
    expect((await f.store.read()).coaching.enabled).toBe(false);
    expect(f.documents).toHaveLength(0);
  });

  it('saves a review, creates a 90-day goal and tracks its progress', async () => {
    const f = fixture();
    await f.message('/evening 2 | сделал шаг | отвлекался | открыть книгу');
    const date = localDate(new Date(), 'Europe/Berlin');
    expect((await f.store.read()).days[date].review?.energy).toBe(2);
    await f.message('/goals add study | 30 задач | 30 | три занятия');
    const goal = (await f.store.read()).goals[0];
    expect(goal.target).toBe(30);
    expect(
      (Date.parse(goal.deadline) - Date.parse(goal.start)) / 86400000,
    ).toBe(90);
    await f.message(`/goals progress ${goal.id} 4`);
    expect((await f.store.read()).goals[0].current).toBe(4);
    await f.message(`/inbox задача #study #goal-${goal.id}`);
    expect(f.tasks().uncompleted[0].tags).toContain(`goal-${goal.id}`);
  });

  it('requires explicit consent, exports on request, then blocks export after revocation', async () => {
    const f = fixture();
    await f.message('/coaching export');
    expect(f.documents).toHaveLength(0);
    await f.callback('pc:consent');
    await f.message('/coaching export');
    expect(f.documents).toHaveLength(1);
    await f.message('/coaching off');
    await f.message('/coaching export');
    expect(f.documents).toHaveLength(1);
    expect((await f.store.read()).coaching.consentedAt).toBeUndefined();
  });

  it('rejects old day buttons and invalid review/settings without changing state', async () => {
    const f = fixture();
    await f.message('/inbox Read #study');
    await f.callback(`pf:2020-01-01:${f.tasks().uncompleted[0].id}`);
    await f.message('/evening 9 | a | b | c');
    await f.message('/reminders 99:00 21:30 18:00');
    const state = await f.store.read();
    expect(state.days).toEqual({});
    expect(state.reminders.morning).toBe('09:00');
  });
});
