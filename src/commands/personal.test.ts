import { describe, expect, it, setSystemTime } from 'bun:test';
import { Bot, session } from 'grammy';
import type { Metadata, TaskData } from '../core/types.js';
import type { BotContext, SessionData } from '../middlewares/session.js';
import { registerContextKeyboard } from '../services/contextKeyboard.js';
import {
  createDayPlan,
  createPersonalState,
  dayFor,
  localDate,
  MORNING_START_ITEMS,
} from '../services/personal.js';
import { PersonalStore } from '../services/personalStore.js';
import { createPersonalComposer } from './personal.js';

const fixture = (
  saveResult: boolean | Error = true,
  capturePlainText = true,
) => {
  let state = createPersonalState(1);
  let tasks: TaskData = { completed: [], uncompleted: [] };
  let revision = 0;
  let nextQuery: (() => Promise<void>) | undefined;
  let nextSave: (() => Promise<void>) | undefined;
  const nextApi = new Map<string, () => Promise<void>>();
  const messages: string[] = [];
  const panels: Array<Record<string, unknown>> = [];
  const documents: string[] = [];
  const passed: string[] = [];
  const passedCallbacks: string[] = [];
  const metadata: Metadata = { timezone: 'Europe/Berlin' };
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
        const waiting = nextApi.get(method ?? '');
        nextApi.delete(method ?? '');
        await waiting?.();
        const payload =
          typeof init?.body === 'string'
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : {};
        if (method === 'sendMessage' || method === 'editMessageText')
          messages.push(String(payload.text));
        if (method === 'sendMessage' || method === 'editMessageText')
          panels.push(payload);
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
      capturePlainText,
      query: async () => {
        const wait = nextQuery;
        nextQuery = undefined;
        await wait?.();
        return { metadata, taskData: structuredClone(tasks) };
      },
      save: async (next) => {
        const waiting = nextSave;
        nextSave = undefined;
        await waiting?.();
        if (saveResult instanceof Error) throw saveResult;
        if (!saveResult) return false;
        tasks = structuredClone(next);
        return true;
      },
    }),
  );
  registerContextKeyboard(bot);
  bot.on('message:text', (ctx) => {
    passed.push(ctx.message.text);
  });
  bot.on('callback_query:data', (ctx) => {
    passedCallbacks.push(ctx.callbackQuery.data);
  });
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
  const buttons = () => {
    const panel = [...panels]
      .reverse()
      .find(
        (panel) =>
          (panel.reply_markup as { inline_keyboard?: unknown })
            ?.inline_keyboard,
      );
    return (
      (
        panel?.reply_markup as {
          inline_keyboard?: Array<
            Array<{ text: string; callback_data?: string }>
          >;
        }
      )?.inline_keyboard ?? []
    ).flat();
  };
  const tap = async (text: string) => {
    const button = buttons().find((button) => button.text.includes(text));
    if (!button?.callback_data) throw new Error(`Missing button: ${text}`);
    await callback(button.callback_data);
  };
  return {
    store,
    messages,
    documents,
    passed,
    passedCallbacks,
    metadata,
    message,
    callback,
    buttons,
    tap,
    panels,
    pauseNextSave: () => {
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      nextSave = async () => {
        enter();
        await waiting;
      };
      return { entered, release };
    },
    pauseNextApi: (method: 'answerCallbackQuery' | 'sendMessage') => {
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      nextApi.set(method, async () => {
        enter();
        await waiting;
      });
      return { entered, release };
    },
    pauseNextQuery: () => {
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      nextQuery = async () => {
        enter();
        await waiting;
      };
      return { entered, release };
    },
    tasks: () => tasks,
  };
};

describe('Personal Telegram workflow', () => {
  it('keeps a newer review open when an already-started completion save succeeds', async () => {
    const f = fixture(true, false);
    f.tasks().uncompleted.push({
      id: 'task',
      name: 'Конспект',
      completed: false,
      tags: [],
    });
    const date = localDate(new Date(), 'Europe/Berlin');
    await f.store.update((state) => {
      dayFor(state, date).priorities = ['task'];
    });
    await f.callback('pui:home');
    const done = f.buttons().find((b) => b.text.includes('Готово'))!
      .callback_data!;
    const pending = f.pauseNextSave();
    const completion = f.callback(done);
    await pending.entered;
    try {
      await f.callback('pui:evening');
    } finally {
      pending.release();
      await completion;
    }
    expect(f.tasks().uncompleted[0].completed).toBe(true);
    expect(f.buttons().some((b) => b.text === '3')).toBe(true);
  });
  it('cancels dashboard completion before a newer or older callback acknowledgement returns', async () => {
    for (const delayed of ['newer', 'older']) {
      const f = fixture(true, false);
      f.tasks().uncompleted.push({
        id: 'task',
        name: 'Конспект',
        completed: false,
        tags: [],
      });
      const date = localDate(new Date(), 'Europe/Berlin');
      await f.store.update((state) => {
        dayFor(state, date).priorities = ['task'];
      });
      await f.callback('pui:home');
      const done = f.buttons().find((b) => b.text.includes('Готово'))!
        .callback_data!;
      if (delayed === 'newer') {
        const query = f.pauseNextQuery();
        const completion = f.callback(done);
        await query.entered;
        const ack = f.pauseNextApi('answerCallbackQuery');
        const review = f.callback('pui:evening');
        await ack.entered;
        try {
          query.release();
          await completion;
          expect(f.tasks().uncompleted[0].completed).toBe(false);
        } finally {
          ack.release();
          await review;
        }
      } else {
        const ack = f.pauseNextApi('answerCallbackQuery');
        const completion = f.callback(done);
        await ack.entered;
        try {
          await f.callback('pui:evening');
        } finally {
          ack.release();
          await completion;
        }
        expect(f.tasks().uncompleted[0].completed).toBe(false);
      }
      expect(f.buttons().some((b) => b.text === '3')).toBe(true);
    }
  });

  it('keeps evening input after a delayed stale-action warning', async () => {
    const f = fixture(true, false);
    f.tasks().uncompleted.push({
      id: 'task',
      name: 'Конспект',
      completed: false,
      tags: [],
    });
    const date = localDate(new Date(), 'Europe/Berlin');
    await f.store.update((state) => {
      dayFor(state, date).priorities = ['task'];
    });
    await f.callback('pui:home');
    const done = f.buttons().find((b) => b.text.includes('Готово'))!
      .callback_data!;
    f.tasks().uncompleted[0].name = 'Изменённое дело';
    const warning = f.pauseNextApi('sendMessage');
    const request = f.callback(done);
    await warning.entered;
    try {
      await f.callback('pui:evening');
    } finally {
      warning.release();
      await request;
    }
    expect(f.buttons().some((b) => b.text === '3')).toBe(true);
    await f.tap('3');
    await f.message('Написал конспект');
    expect(f.messages[f.messages.length - 1]).toContain('Что мешало');
    expect(f.tasks().uncompleted[0].completed).toBe(false);
  });
  it('opens a read-only working day and refreshes progress after completing the next priority', async () => {
    setSystemTime(new Date('2026-10-26T09:15:00+01:00'));
    try {
      const f = fixture(true, false);
      await f.message('/inbox Разобрать конспект');
      await f.message('/inbox Решить задачу');
      const [first, second] = f.tasks().uncompleted;
      await f.store.update((state) => {
        dayFor(state, '2026-10-26').priorities = [first.id!, second.id!];
      });
      f.metadata.calendar_timezone = 'UTC';
      f.metadata.calendar_events = JSON.stringify([
        {
          uid: 'math',
          date: '2026-10-26',
          start: '09:00',
          end: '10:30',
          title: 'Математика',
          location: 'Аудитория 12',
        },
      ]);
      const before = await f.store.read();
      await f.callback('pui:home');
      expect(f.messages[f.messages.length - 1]).toContain('Приоритеты: 0 из 2');
      expect(f.messages[f.messages.length - 1]).toContain(
        '10:00–11:30 · Математика',
      );
      expect(f.messages[f.messages.length - 1]).toContain(first.name);
      expect(
        f.buttons().filter((button) => button.callback_data !== 'menu:home'),
      ).toHaveLength(4);
      expect(await f.store.read()).toEqual(before);
      const done = f.buttons().find((button) => button.text.includes('Готово'))!
        .callback_data!;
      expect(Buffer.byteLength(done)).toBeLessThanOrEqual(64);
      await f.callback(done);
      expect(f.messages[f.messages.length - 1]).toContain('Приоритеты: 1 из 2');
      expect(
        f.tasks().uncompleted.find((task) => task.id === first.id)?.completed,
      ).toBe(true);
      const last = f.buttons().find((button) => button.text.includes('Готово'))!
        .callback_data!;
      await f.callback(done);
      expect(
        f.tasks().uncompleted.find((task) => task.id === second.id)?.completed,
      ).toBe(false);
      await f.callback(last);
      expect(f.messages[f.messages.length - 1]).toContain('Приоритеты: 2 из 2');
      expect(f.buttons().some((button) => button.text.includes('обзор'))).toBe(
        true,
      );
    } finally {
      setSystemTime();
    }
  });

  it('rejects another day and guest completion buttons and keeps an empty day actionable', async () => {
    setSystemTime(new Date('2026-10-26T12:00:00+01:00'));
    try {
      const f = fixture(true, false);
      await f.callback('pui:home');
      expect(f.messages[f.messages.length - 1]).toContain(
        'Приоритеты пока не выбраны',
      );
      await f.tap('Ещё');
      await f.tap('Учёба');
      await f.tap('Добавить');
      await f.message('Первая задача');
      const task = f.tasks().uncompleted[0];
      await f.store.update((state) => {
        dayFor(state, '2026-10-26').priorities = [task.id!];
      });
      await f.callback('pui:home');
      const done = f.buttons().find((button) => button.text.includes('Готово'))!
        .callback_data!;
      await f.callback(done, 2);
      expect(f.tasks().uncompleted[0].completed).toBe(false);
      setSystemTime(new Date('2026-10-27T12:00:00+01:00'));
      await f.callback(done);
      expect(f.tasks().uncompleted[0].completed).toBe(false);
      expect(f.messages.join('\n')).toContain('Открой «Мой день» заново');
    } finally {
      setSystemTime();
    }
  });

  it('does not complete a changed priority or display success after a failed save', async () => {
    const f = fixture(false, false);
    f.tasks().uncompleted.push({
      id: 'task',
      name: 'Конспект',
      completed: false,
      tags: [],
    });
    const date = localDate(new Date(), 'Europe/Berlin');
    await f.store.update((state) => {
      dayFor(state, date).priorities = ['task'];
    });
    await f.callback('pui:home');
    const old = f.buttons().find((button) => button.text.includes('Готово'))!
      .callback_data!;
    f.tasks().uncompleted[0].name = 'Изменённый конспект';
    await f.callback(old);
    expect(f.tasks().uncompleted[0].completed).toBe(false);
    const current = f
      .buttons()
      .find((button) => button.text.includes('Готово'))!.callback_data!;
    await f.callback(current);
    expect(f.tasks().uncompleted[0].completed).toBe(false);
    expect(f.messages.join('\n')).not.toContain('Приоритеты: 1 из 1');
    expect(f.messages[f.messages.length - 1]).toContain(
      'Изменения не сохранены',
    );
  });

  it('keeps a newer review open when dashboard loading or completion is cancelled', async () => {
    const f = fixture(true, false);
    f.tasks().uncompleted.push({
      id: 'task',
      name: 'Конспект',
      completed: false,
      tags: [],
    });
    const date = localDate(new Date(), 'Europe/Berlin');
    await f.store.update((state) => {
      dayFor(state, date).priorities = ['task'];
    });
    await f.callback('pui:home');
    const done = f.buttons().find((button) => button.text.includes('Готово'))!
      .callback_data!;
    for (const action of ['pui:home', done]) {
      const pending = f.pauseNextQuery();
      const request = f.callback(action);
      await pending.entered;
      await f.callback('pui:evening');
      pending.release();
      await request;
      expect(f.messages[f.messages.length - 1]).toContain(
        'Сколько сил было сегодня',
      );
      expect(f.tasks().uncompleted[0].completed).toBe(false);
    }
  });
  it('redirects retired morning settings only for the owner with a managed routine', async () => {
    const f = fixture(true, false);
    await f.callback('menu:wake');
    expect(f.passedCallbacks).toEqual(['menu:wake']);
    await f.store.update((state) => {
      state.reminders.routine = true;
      state.reminders.morning = '07:00';
    });
    const before = await f.store.read();
    for (const action of [
      'menu:wake',
      'menu:morning',
      'menu:wakeinput:old:weekday',
      'menu:morningdelete:old:0',
    ]) {
      await f.callback(action);
      expect(f.messages[f.messages.length - 1]).toContain(
        'Подъём и план: 07:00',
      );
    }
    expect(await f.store.read()).toEqual(before);
    expect(f.metadata.morning_items).toBeUndefined();
    await f.callback('menu:morning', 2);
    expect(f.passedCallbacks).toEqual(['menu:wake', 'menu:morning']);
    await f.callback('pui:items');
    await f.callback('menu:morning');
    await f.message('обычный текст после старой кнопки');
    expect(f.passed).toContain('обычный текст после старой кнопки');
    expect((await f.store.read()).morningItems).toEqual(before.morningItems);
  });
  it('removes shortcut controls and returns retired buttons to the day menu without changing settings', async () => {
    const f = fixture(true, false);
    const before = await f.store.read();
    await f.callback('pui:settings');
    await f.tap('▶️');
    const settingsPanels = f.panels.filter((panel) => panel.reply_markup);
    expect(JSON.stringify(settingsPanels)).not.toContain('pui:iphone');
    await f.callback('pui:iphone');
    expect(f.messages[f.messages.length - 1]).toContain('🧭 Мой день');
    expect(
      f.buttons().some((button) => Object.hasOwn(button, 'copy_text')),
    ).toBe(false);
    expect(await f.store.read()).toEqual(before);
    expect(f.tasks().uncompleted).toHaveLength(0);
  });
  it('cancels a task while its read is pending without writing or replacing Home', async () => {
    const f = fixture(true, false);
    await f.callback('pui:add:study');
    const back = f.buttons().find((b) => b.text.includes('Назад'))!
      .callback_data!;
    const gate = f.pauseNextQuery();
    const pending = f.message('Отменённая задача');
    await gate.entered;
    await f.callback(back);
    gate.release();
    await pending;
    expect(f.tasks().uncompleted).toHaveLength(0);
    expect(f.messages[f.messages.length - 1]).toContain('Мой день');
  });
  it('rejects a first-step reply after owner-local midnight without replacing either day', async () => {
    setSystemTime(new Date('2026-10-26T23:59:00+01:00'));
    try {
      const f = fixture(true, false);
      await f.store.update((state) => {
        state.days['2026-10-26'] = {
          ...createDayPlan(),
          firstStep: 'Шаг вчерашнего дня',
        };
        state.days['2026-10-27'] = {
          ...createDayPlan(),
          firstStep: 'Шаг нового дня',
        };
      });
      const before = await f.store.read();
      await f.callback('pui:step');
      setSystemTime(new Date('2026-10-27T00:01:00+01:00'));
      await f.message('Ответ на вчерашний вопрос');
      expect(await f.store.read()).toEqual(before);
      expect(f.messages[f.messages.length - 1]).toContain(
        'Наступил другой день. Начни первый шаг заново.',
      );
      await f.message('обычный текст после отмены');
      expect(f.passed).toEqual(['обычный текст после отмены']);
    } finally {
      setSystemTime();
    }
  });
  it('ignores first-step input while its date is loading, then saves a fresh reply', async () => {
    const f = fixture(true, false);
    const gate = f.pauseNextQuery();
    const pending = f.callback('pui:step');
    await gate.entered;
    await f.message('Слишком ранний ответ');
    expect((await f.store.read()).days).toEqual({});
    gate.release();
    await pending;
    expect(f.messages[f.messages.length - 1]).toContain('Какой первый шаг');
    await f.message('Открыть конспект');
    const date = localDate(new Date(), 'Europe/Berlin');
    expect((await f.store.read()).days[date].firstStep).toBe(
      'Открыть конспект',
    );
  });
  it('does not resurrect a first-step prompt after Home cancels its pending load', async () => {
    const f = fixture(true, false);
    const gate = f.pauseNextQuery();
    const pending = f.callback('pui:step');
    await gate.entered;
    await f.callback('pui:home');
    const homeMessageCount = f.messages.length;
    gate.release();
    await pending;
    expect(f.messages).toHaveLength(homeMessageCount);
    expect(f.messages[f.messages.length - 1]).toContain('Мой день');
    await f.message('обычный текст после Home');
    expect(f.passed).toEqual(['обычный текст после Home']);
    expect((await f.store.read()).days).toEqual({});
  });
  for (const openPlan of [false, true]) {
    it(`applies edited morning items tomorrow when today's plan is ${openPlan ? 'already open' : 'unopened'}`, async () => {
      setSystemTime(new Date('2026-10-26T12:00:00+01:00'));
      try {
        const f = fixture(true, false);
        const previousItems = ['Вода', 'Книга'];
        const nextItems = ['Новые пункты', 'Прогулка'];
        await f.store.update((state) => {
          state.morningItems = previousItems;
        });
        if (openPlan) await f.callback('pui:plan');
        await f.callback('pui:items');
        await f.message(nextItems.join('\n'));
        const edited = await f.store.read();
        expect(edited.morningItems).toEqual(nextItems);
        expect(edited.days['2026-10-26'].morningItems).toEqual(previousItems);
        await f.callback('pui:checklist');
        expect(f.messages[f.messages.length - 1]).toContain('▫️ Книга');
        expect(f.messages[f.messages.length - 1]).not.toContain('Прогулка');
        setSystemTime(new Date('2026-10-27T08:00:00+01:00'));
        await f.callback('pui:checklist');
        const tomorrow = await f.store.read();
        expect(tomorrow.days['2026-10-27'].morningItems).toEqual(nextItems);
        expect(tomorrow.days['2026-10-26'].morningItems).toEqual(previousItems);
      } finally {
        setSystemTime();
      }
    });
  }
  it('preserves an existing morning snapshot and progress through edits and preset confirmation', async () => {
    setSystemTime(new Date('2026-10-26T12:00:00+01:00'));
    try {
      const f = fixture(true, false);
      const previousItems = ['Мой пункт', 'Второй пункт'];
      await f.store.update((state) => {
        state.morningItems = previousItems;
      });
      await f.callback('pui:checklist');
      await f.callback('pui:check:2026-10-26:0');
      await f.callback('pui:items');
      await f.message('Завтрашний пункт');
      expect((await f.store.read()).days['2026-10-26']).toMatchObject({
        morningItems: previousItems,
        morningDone: [0],
      });
      await f.callback('pui:preset');
      await f.tap('Применить');
      const preset = await f.store.read();
      expect(preset.morningItems).toEqual(MORNING_START_ITEMS);
      expect(preset.days['2026-10-26']).toMatchObject({
        morningItems: previousItems,
        morningDone: [0],
      });
      setSystemTime(new Date('2026-10-27T08:00:00+01:00'));
      await f.callback('pui:checklist');
      expect((await f.store.read()).days['2026-10-27'].morningItems).toEqual(
        MORNING_START_ITEMS,
      );
    } finally {
      setSystemTime();
    }
  });
  it('keeps a customized template for today when a preset is applied before the first checklist', async () => {
    setSystemTime(new Date('2026-10-26T12:00:00+01:00'));
    try {
      const f = fixture(true, false);
      const previousItems = ['Своё утро'];
      await f.store.update((state) => {
        state.morningItems = previousItems;
      });
      await f.callback('pui:preset');
      await f.tap('Применить');
      await f.callback('pui:checklist');
      const state = await f.store.read();
      expect(state.morningItems).toEqual(MORNING_START_ITEMS);
      expect(state.days['2026-10-26'].morningItems).toEqual(previousItems);
      expect(f.messages[f.messages.length - 1]).toContain('▫️ Своё утро');
    } finally {
      setSystemTime();
    }
  });
  it('applies the routine only after confirmation and preserves calendar and tasks', async () => {
    const f = fixture(true, false);
    f.metadata.calendar_events = '[{"uid":"kept"}]';
    f.tasks().uncompleted.push({
      id: 'kept-task',
      name: 'Existing',
      completed: false,
      tags: ['gym'],
    });
    await f.callback('pui:preset');
    expect((await f.store.read()).reminders.enabled).toBe(false);
    await f.tap('Применить');
    expect((await f.store.read()).reminders).toMatchObject({
      enabled: true,
      morning: '08:00',
      wakeRepeats: true,
      routine: true,
      evening: '21:30',
      bedtime: '00:45',
      quietStart: '01:00',
      quietEnd: '08:00',
    });
    expect((await f.store.read()).morningItems).toHaveLength(6);
    expect(f.metadata.calendar_events).toBe('[{"uid":"kept"}]');
    expect(f.tasks().uncompleted.map((t) => t.id)).toEqual(['kept-task']);
  });
  it('supports time selection through keyboard pages and morning checklist progress', async () => {
    const f = fixture(true, false);
    await f.callback('pui:timefield:morning');
    await f.tap('▶️');
    await f.tap('08');
    await f.tap('08:30');
    expect((await f.store.read()).reminders.morning).toBe('08:30');
    await f.callback('pui:checklist');
    const first = f
      .buttons()
      .find((b) => b.callback_data?.startsWith('pui:check:'))!;
    await f.callback(first.callback_data!);
    const date = localDate(new Date(), 'Europe/Berlin');
    expect((await f.store.read()).days[date].morningDone).toEqual([0]);
    await f.callback(`pui:awake:${date}`);
    expect((await f.store.read()).days[date].awakeAt).toBeDefined();
  });
  it('cancels an unsaved review and refuses old or guest buttons', async () => {
    const f = fixture(true, false);
    await f.callback('pui:evening');
    await f.tap('3');
    await f.message('Шаг');
    await f.message('Телефон');
    await f.message('Книга');
    const save = f.buttons().find((b) => b.text.includes('Сохранить'))!
      .callback_data!;
    await f.callback('pui:home');
    await f.callback(save);
    await f.message('обычный текст');
    await f.callback('pui:preset', 2);
    await f.callback('pui:enabled:on', 2);
    const date = localDate(new Date(), 'Europe/Berlin');
    expect((await f.store.read()).days[date]?.review).toBeUndefined();
    expect((await f.store.read()).reminders.enabled).toBe(false);
    expect(f.passed).toContain('обычный текст');
    expect(f.tasks().uncompleted).toHaveLength(0);
  });

  it('runs the owner day menu, study inbox and focus through buttons', async () => {
    const f = fixture(true, false);
    await f.callback('pui:home');
    await f.tap('Ещё');
    await f.tap('Учёба');
    await f.tap('Добавить');
    await f.message('Решить три задачи');
    expect(f.tasks().uncompleted[0].tags).toContain('study');
    await f.callback('pui:focus');
    await f.tap('Решить три задачи');
    await f.callback('pui:plan');
    const date = localDate(new Date(), 'Europe/Berlin');
    expect((await f.store.read()).days[date].priorities).toEqual([
      f.tasks().uncompleted[0].id!,
    ]);
    expect((await f.store.read()).days[date].morningAt).toBeDefined();
  });
  it('collects an evening review step by step and saves only on confirmation', async () => {
    const f = fixture(true, false);
    await f.callback('pui:evening');
    await f.tap('3');
    await f.message('Сделал задачу | и пошёл гулять');
    await f.message('Телефон');
    await f.message('Открыть конспект');
    const date = localDate(new Date(), 'Europe/Berlin');
    expect((await f.store.read()).days[date]?.review).toBeUndefined();
    await f.tap('Сохранить');
    expect((await f.store.read()).days[date].review).toEqual({
      energy: 3,
      win: 'Сделал задачу | и пошёл гулять',
      blocker: 'Телефон',
      next: 'Открыть конспект',
    });
  });
  it('preserves existing text and reminder routing when integrated with Copilot', async () => {
    const f = fixture(true, false);
    await f.message('Обсудить проект');
    await f.message('/reminders');
    expect(f.passed).toEqual(['Обсудить проект', '/reminders']);
    expect(f.tasks().uncompleted).toHaveLength(0);
    await f.message('/inbox Открыть конспект #study');
    await f.message('/personalreminders on');
    expect(f.tasks().uncompleted[0].name).toBe('Открыть конспект');
    expect((await f.store.read()).reminders.enabled).toBe(true);
    expect(f.passed).toHaveLength(2);
  });
  it('includes imported classes in the morning plan without saving them as tasks', async () => {
    const f = fixture(true, false);
    f.metadata.calendar_timezone = 'Europe/Berlin';
    f.metadata.calendar_events = JSON.stringify([
      {
        uid: 'class-1',
        date: localDate(new Date(), 'Europe/Berlin'),
        start: '23:59',
        end: '23:59',
        title: 'Physics class',
      },
    ]);
    await f.message('/morning');
    expect(f.messages[f.messages.length - 1]).toContain('Physics class');
    expect(f.tasks().uncompleted).toHaveLength(0);
    expect(f.metadata.calendar_events).toContain('class-1');
  });
  it('initializes legacy task IDs before enabling reminders', async () => {
    const f = fixture();
    f.tasks().uncompleted.push({
      name: 'Legacy meeting',
      completed: false,
      tags: [],
      date: '2026-10-25',
      time: '12:30',
    });
    await f.message('/personalreminders on');
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
    await f.message('/personalreminders on');
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
    await f.message('/personalreminders 99:00 21:30 18:00');
    const state = await f.store.read();
    expect(state.days).toEqual({});
    expect(state.reminders.morning).toBe('09:00');
  });
});
