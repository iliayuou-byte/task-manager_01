import { Composer, InlineKeyboard, InputFile } from 'grammy';
import logger from '../core/logger.js';
import type { Metadata, TaskData } from '../core/types.js';
import type { BotContext } from '../middlewares/session.js';
import { panelReply } from '../services/chatPanel.js';
import {
  AREAS,
  type Area,
  buildCoachingExport,
  type DayPlan,
  dayFor,
  localDate,
  setPriorities,
  shiftDate,
} from '../services/personal.js';
import { personalCalendarTasks } from '../services/personalCalendar.js';
import type { PersonalStore } from '../services/personalStore.js';
import { markTaskCompleted, parseUserText } from '../utils/index.js';
import {
  AREA_LABELS,
  COACHING_INFO,
  EVENING_HELP,
  PERSONAL_HELP,
  personalNavigation,
  personalPlanKeyboard,
  planMessage,
  weekMessage,
} from '../views/personalView.js';
import { cancelAiSettings } from './aiSettings.js';
import { openTaskById } from './menu.js';
import { createPersonalButtons } from './personalButtons.js';

export interface PersonalDependencies {
  ownerId: number;
  store(): Promise<PersonalStore>;
  query(): Promise<{ metadata: Metadata; taskData: TaskData }>;
  save(tasks: TaskData, metadata: Metadata): Promise<boolean>;
  enabled(): boolean;
  capturePlainText?: boolean;
}

const arg = (ctx: BotContext) =>
  ctx.message?.text?.replace(/^\/\w+(?:@\w+)?\s*/, '').trim() ?? '';
const allTasks = (data: TaskData) => [...data.uncompleted, ...data.completed];
const reply = async (
  ctx: BotContext,
  text: string,
  keyboard = personalNavigation(),
) => {
  for (let offset = 0; offset < text.length; offset += 3500)
    await panelReply(
      ctx,
      text.slice(offset, offset + 3500),
      { reply_markup: offset + 3500 >= text.length ? keyboard : undefined },
      { navigation: false },
    );
};

export const createPersonalComposer = (
  deps: PersonalDependencies,
): Composer<BotContext> => {
  const composer = new Composer<BotContext>();
  const guard =
    (handler: (ctx: BotContext) => Promise<unknown>) =>
    async (ctx: BotContext) => {
      if (
        ctx.from?.id !== deps.ownerId ||
        ctx.chat?.type !== 'private' ||
        ctx.chat.id !== deps.ownerId
      ) {
        if (ctx.callbackQuery)
          await ctx.answerCallbackQuery({
            text: 'Только для владельца в личном чате.',
          });
        else
          await ctx.reply(
            'Личная система доступна только владельцу в личном чате.',
          );
        return;
      }
      cancelAiSettings(ctx);
      try {
        await handler(ctx);
      } catch (error) {
        // External API errors may include request data; log the operation only.
        logger.errorWithContext({
          op: 'PERSONAL',
          message: 'Personal operation failed',
        });
        const message =
          error instanceof PersonalInputError
            ? error.message
            : 'Не удалось выполнить действие. Проверь настройки личной системы и доступ к приватному хранилищу; затем повтори.';
        await ctx.reply(message);
      }
    };
  const command = (
    name: string,
    handler: (ctx: BotContext, text: string) => Promise<unknown>,
  ) => {
    composer.command(
      name,
      guard((ctx) => handler(ctx, arg(ctx))),
    );
  };
  const save = async (tasks: TaskData, metadata: Metadata) => {
    if (!(await deps.save(tasks, metadata)))
      throw new PersonalInputError('Изменения не сохранены. Повтори действие.');
  };
  const load = async (ids = false) => {
    const store = await deps.store();
    const state = await store.read();
    const data = await deps.query();
    const timezone = data.metadata.timezone;
    if (!timezone)
      throw new PersonalInputError(
        'Сначала укажи часовой пояс: /settimezone Europe/Berlin',
      );
    const now = new Date();
    const date = localDate(now, timezone);
    if (ids && allTasks(data.taskData).some((task) => !task.id)) {
      for (const task of allTasks(data.taskData))
        task.id ||= crypto.randomUUID();
      await save(data.taskData, data.metadata);
    }
    return { store, state, ...data, timezone, date, now };
  };
  const capture = async (
    ctx: BotContext,
    text: string,
    options?: { area?: Area; active?: () => boolean },
  ) => {
    if (!text || text.length > 500)
      throw new PersonalInputError(
        'Напиши дело длиной до 500 символов: /inbox открыть конспект #study',
      );
    const { tags, text: title } = parseUserText(text);
    if (options?.area && !tags.includes(options.area)) tags.push(options.area);
    const name = title;
    if (!name)
      throw new PersonalInputError('Добавь название дела перед тегами.');
    const data = await load();
    if (options?.active && !options.active()) return;
    const existing = allTasks(data.taskData);
    let unique = name;
    let suffix = 2;
    while (existing.some((task) => task.name === unique))
      unique = `${name} (${suffix++})`;
    data.taskData.uncompleted.unshift({
      id: crypto.randomUUID(),
      name: unique,
      tags,
      completed: false,
    });
    await save(data.taskData, data.metadata);
    if (options?.active && !options.active()) return;
    await reply(
      ctx,
      `Записано во входящие: ${unique}`,
      new InlineKeyboard()
        .text('🎯 Выбрать на сегодня', 'pui:focus')
        .row()
        .text('📥 Входящие', 'pui:inbox')
        .text('🧭 Мой день', 'pui:home'),
    );
  };

  command('system', async (ctx) => {
    await deps.store().then((store) => store.read());
    await reply(ctx, PERSONAL_HELP);
  });
  command('inbox', async (ctx, text) => {
    if (text) return capture(ctx, text);
    const { taskData } = await load();
    const inbox = taskData.uncompleted.filter(
      (task) => !task.completed && !task.date,
    );
    await reply(
      ctx,
      inbox.length
        ? `Входящие (${inbox.length}):\n${inbox.map((task, i) => `${i + 1}. ${task.name}`).join('\n')}\n\n/focus — выбрать на сегодня; /edit — назначить дату.`
        : 'Входящие пусты. Запиши дело: /inbox текст #study',
    );
  });

  const showPlan = async (
    ctx: BotContext,
    mode?: DayPlan['mode'],
    morning = false,
  ) => {
    const data = await load(true);
    const state = await data.store.update((state) => {
      const day = dayFor(state, data.date);
      if (mode) day.mode = mode;
      if (mode === 'late') day.usedLate = true;
      if (mode === 'low') day.usedLow = true;
      if (morning) {
        day.morningAt = data.now.toISOString();
        const yesterday = state.days[shiftDate(data.date, -1)];
        if (!day.firstStep && yesterday?.review?.next)
          day.firstStep = yesterday.review.next;
      }
    });
    const day = dayFor(state, data.date);
    const selected = day.priorities.flatMap((id) =>
      data.taskData.uncompleted.filter(
        (task) => task.id === id && !task.completed,
      ),
    );
    const visible = day.mode === 'normal' ? selected : selected.slice(0, 1);
    await reply(
      ctx,
      planMessage(
        state,
        [
          ...allTasks(data.taskData),
          ...personalCalendarTasks(data.metadata, data.timezone),
        ],
        data.timezone,
        data.now,
      ),
      personalPlanKeyboard(visible),
    );
  };
  command('morning', (ctx) => showPlan(ctx, undefined, true));
  command('late', (ctx) => showPlan(ctx, 'late'));
  command('lowenergy', (ctx) => showPlan(ctx, 'low'));
  command('normal', (ctx) => showPlan(ctx, 'normal'));
  command('step', async (ctx, text) => {
    if (!text || text.length > 400)
      throw new PersonalInputError(
        'Напиши первый шаг до 400 символов: /step открыть конспект на странице 10',
      );
    const { store, date } = await load();
    await store.update((state) => {
      dayFor(state, date).firstStep = text;
    });
    await ctx.reply(`Первый шаг: ${text}`);
  });

  const focusView = async (ctx: BotContext, offset = 0, edit = false) => {
    const data = await load(true);
    const selected = data.state.days[data.date]?.priorities ?? [];
    const tasks = data.taskData.uncompleted.filter((task) => !task.completed);
    tasks.sort(
      (a, b) =>
        Number(selected.includes(b.id!)) - Number(selected.includes(a.id!)),
    );
    const keyboard = new InlineKeyboard();
    for (const task of tasks.slice(offset, offset + 6)) {
      keyboard
        .text(
          `${selected.includes(task.id!) ? '✓ ' : '○ '}${task.name.slice(0, 45)}`,
          `pf:${data.date}:${task.id}`,
        )
        .row();
    }
    if (offset > 0) keyboard.text('←', `pp:${Math.max(0, offset - 6)}`);
    if (offset + 6 < tasks.length) keyboard.text('→', `pp:${offset + 6}`);
    const names = selected.map(
      (id) =>
        allTasks(data.taskData).find((task) => task.id === id)?.name ??
        'Задача удалена',
    );
    keyboard
      .row()
      .text('📋 План дня', 'pui:plan')
      .row()
      .text('⬅️ Назад', 'pui:home')
      .text('🏠 Меню', 'menu:home');
    const text = `Три результата дня · ${data.date}\n${names.length ? names.map((name, i) => `${i + 1}. ${name.slice(0, 150)}`).join('\n') : 'Пока не выбраны.'}\n\nНажми, чтобы выбрать или убрать. Остальное останется во входящих.\n${tasks.length ? '/morning — посмотреть план.' : '/inbox текст — записать дело.'}`;
    if (edit) await ctx.editMessageText(text, { reply_markup: keyboard });
    else await reply(ctx, text, keyboard);
  };
  command('focus', (ctx) => focusView(ctx));
  composer.callbackQuery(
    /^pf:(\d{4}-\d{2}-\d{2}):([a-zA-Z0-9-]{1,64})$/,
    guard(async (ctx) => {
      const [, date, id] = ctx.callbackQuery!.data!.match(/^pf:([^:]+):(.+)$/)!;
      const data = await load();
      await ctx.answerCallbackQuery();
      if (date !== data.date)
        throw new PersonalInputError(
          'Это план другого дня. Открой /focus заново.',
        );
      await data.store.update((state) => {
        const day = dayFor(state, date);
        const ids = day.priorities.filter((key) =>
          data.taskData.uncompleted.some(
            (task) => task.id === key && !task.completed,
          ),
        );
        const next = ids.includes(id)
          ? ids.filter((key) => key !== id)
          : [...ids, id];
        try {
          setPriorities(day, next, data.taskData.uncompleted);
        } catch (error) {
          throw new PersonalInputError(
            error instanceof Error ? error.message : 'Обнови /focus.',
          );
        }
      });
      await focusView(ctx, 0, true);
    }),
  );
  composer.callbackQuery(
    /^pp:(\d+)$/,
    guard(async (ctx) => {
      await ctx.answerCallbackQuery();
      await focusView(ctx, Number(ctx.callbackQuery!.data!.slice(3)), true);
    }),
  );
  composer.callbackQuery(
    /^pd:([a-zA-Z0-9-]{1,64})$/,
    guard(async (ctx) => {
      await ctx.answerCallbackQuery();
      const { taskData, metadata } = await load();
      const task = taskData.uncompleted.find(
        (task) => task.id === ctx.callbackQuery!.data!.slice(3),
      );
      if (!task || task.completed)
        return ctx.reply('Уже завершено или удалено. Обнови /morning.');
      markTaskCompleted(task, metadata.timezone);
      await save(taskData, metadata);
      await ctx.reply(`Готово: ${task.name}`);
    }),
  );

  command('evening', async (ctx, text) => {
    if (!text) return reply(ctx, EVENING_HELP);
    const parts = text.split('|').map((part) => part.trim());
    const energy = Number(parts[0]);
    if (
      parts.length !== 4 ||
      !Number.isInteger(energy) ||
      energy < 1 ||
      energy > 5 ||
      parts.slice(1).some((part) => !part || part.length > 400)
    )
      throw new PersonalInputError(EVENING_HELP);
    const { store, date } = await load();
    await store.update((state) => {
      dayFor(state, date).review = {
        energy,
        win: parts[1],
        blocker: parts[2],
        next: parts[3],
      };
    });
    await ctx.reply(
      'Обзор сохранён. Первый шаг появится в завтрашнем /morning. Незавершённые дела можно выбрать заново — они не становятся долгом.',
    );
  });
  const showWeek = async (ctx: BotContext) => {
    const data = await load();
    await reply(
      ctx,
      weekMessage(data.state, allTasks(data.taskData), data.timezone, data.now),
    );
  };
  command('week', showWeek);

  command('goals', async (ctx, text) => {
    const data = await load();
    if (text.startsWith('add ')) {
      const [area, title, targetText, weeklyAction, ...rest] = text
        .slice(4)
        .split('|')
        .map((part) => part.trim());
      const target = Number(targetText);
      if (
        !AREAS.includes(area as Area) ||
        !title ||
        title.length > 400 ||
        !Number.isFinite(target) ||
        target <= 0 ||
        !weeklyAction ||
        weeklyAction.length > 400 ||
        rest.length
      )
        throw new PersonalInputError(
          'Формат: /goals add study | решить 30 задач | 30 | 3 занятия по 25 минут в неделю\nНаправления: study, gym, project, social, life.',
        );
      const id = crypto.randomUUID().slice(0, 8);
      await data.store.update((state) => {
        state.goals.push({
          id,
          area: area as Area,
          title,
          target,
          current: 0,
          start: data.date,
          deadline: shiftDate(data.date, 90),
          weeklyAction,
        });
      });
      await ctx.reply(
        `Цель сохранена на 90 дней. Связать дело: добавь к задаче #goal-${id}.\nПрогресс: /goals progress ${id} 1`,
      );
      return;
    }
    const progress = text.match(/^progress ([a-zA-Z0-9-]+) (\d+(?:\.\d+)?)$/);
    const remove = text.match(/^remove ([a-zA-Z0-9-]+)$/);
    if (progress || remove) {
      const id = (progress ?? remove)![1];
      await data.store.update((state) => {
        const goal = state.goals.find((goal) => goal.id === id);
        if (!goal)
          throw new PersonalInputError('Цель не найдена. Посмотри /goals.');
        if (progress) {
          const current = Number(progress[2]);
          if (!Number.isFinite(current))
            throw new PersonalInputError(
              'Прогресс должен быть конечным числом.',
            );
          goal.current = current;
        } else state.goals = state.goals.filter((goal) => goal.id !== id);
      });
      await ctx.reply(progress ? 'Прогресс обновлён.' : 'Цель удалена.');
      return;
    }
    if (text) throw new PersonalInputError('Посмотри формат в /goals.');
    const lines = data.state.goals.map((goal) => {
      const linked = allTasks(data.taskData).filter((task) =>
        task.tags.includes(`goal-${goal.id}`),
      );
      return `${goal.id} · ${AREA_LABELS[goal.area]} · ${goal.title}\n${goal.current}/${goal.target} · до ${goal.deadline}\nНа неделю: ${goal.weeklyAction}\nСвязанных дел: ${linked.length}, завершено: ${linked.filter((task) => task.completed).length}`;
    });
    await reply(
      ctx,
      `${lines.join('\n\n') || 'Пока нет целей.'}\n\n/goals add study | решить 30 задач | 30 | три занятия в неделю\n/goals progress ID число — текущее значение\n/goals remove ID — удалить\nНаправления: study, gym, project, social, life.`,
    );
  });

  command('personalreminders', async (ctx, text) => {
    const { store } = await load(text === 'on');
    const state = await store.update((state) => {
      const settings = state.reminders;
      if (text === 'on' || text === 'off') settings.enabled = text === 'on';
      else if (
        /^([01]\d|2[0-3]):[0-5]\d ([01]\d|2[0-3]):[0-5]\d ([01]\d|2[0-3]):[0-5]\d$/.test(
          text,
        )
      ) {
        [settings.morning, settings.evening, settings.weekly] = text.split(' ');
      } else if (
        /^quiet ([01]\d|2[0-3]):[0-5]\d ([01]\d|2[0-3]):[0-5]\d$/.test(text)
      ) {
        [, settings.quietStart, settings.quietEnd] = text.split(' ');
      } else if (
        /^lead \d+$/.test(text) &&
        Number(text.split(' ')[1]) >= 1 &&
        Number(text.split(' ')[1]) <= 180
      )
        settings.leadMinutes = Number(text.split(' ')[1]);
      else if (/^weekday [0-6]$/.test(text))
        settings.weeklyDay = Number(text.slice(-1));
      else if (text)
        throw new PersonalInputError(
          'Неверный формат. Посмотри /personalreminders.',
        );
    });
    const s = state.reminders;
    await ctx.reply(
      `Напоминания: ${s.enabled ? 'включены' : 'выключены'}\nУтро ${s.morning} · вечер ${s.evening} · неделя ${s.weekly}, день ${s.weeklyDay} (0 — воскресенье)\nТихие часы ${s.quietStart}–${s.quietEnd}\nДо события: ${s.leadMinutes} мин.\nВремя в часовом поясе /mytimezone.\n\n/personalreminders on или /personalreminders off\n/personalreminders 09:00 21:30 18:00\n/personalreminders quiet 22:00 08:00\n/personalreminders lead 30\n/personalreminders weekday 0\nДля доставки бот должен работать, а планировщик — вызываться каждую минуту.`,
    );
  });

  command('coaching', async (ctx, text) => {
    const data = await load();
    if (text === 'off') {
      await data.store.update((state) => {
        state.coaching = { enabled: false };
      });
      return ctx.reply(
        'Согласие отозвано. Новый экспорт недоступен до повторного согласия. Уже выданные файлы удали отдельно при необходимости.',
      );
    }
    if (text === 'export') {
      const fresh = await data.store.read();
      if (!fresh.coaching.enabled || !fresh.coaching.consentedAt)
        throw new PersonalInputError(
          'Сначала прочитай /coaching и подтверди согласие кнопкой.',
        );
      const exported = buildCoachingExport(
        fresh,
        allTasks(data.taskData),
        data.timezone,
        data.now,
      );
      return ctx.replyWithDocument(
        new InputFile(
          Buffer.from(JSON.stringify(exported, null, 2)),
          `coaching-${data.date}.json`,
        ),
        {
          caption:
            'Сводка без текстов задач и обзоров. Перед загрузкой в другой чат можно открыть и проверить файл.',
        },
      );
    }
    if (text)
      throw new PersonalInputError(
        'Используй /coaching, /coaching export или /coaching off.',
      );
    await ctx.reply(
      `${COACHING_INFO}\n\nСогласие: ${data.state.coaching.enabled ? 'дано' : 'не дано'}.`,
      {
        reply_markup: new InlineKeyboard().text(
          'Согласен на такой экспорт',
          'pc:consent',
        ),
      },
    );
  });
  composer.callbackQuery(
    'pc:consent',
    guard(async (ctx) => {
      await ctx.answerCallbackQuery();
      const store = await deps.store();
      await store.update((state) => {
        state.coaching = {
          enabled: true,
          consentedAt: new Date().toISOString(),
        };
      });
      await ctx.reply(
        'Согласие сохранено. Выдать сводку: /coaching export. Отключить: /coaching off. Автоматическая передача не включена.',
      );
    }),
  );
  command('cancel', async (ctx) => {
    ctx.session.awaitingAdd = undefined;
    ctx.session.editScene = undefined;
    await ctx.reply('Диалог закрыт. /system — команды личной системы.');
  });
  composer.on('message:text', async (ctx, next) => {
    if (
      deps.capturePlainText === false ||
      !deps.enabled() ||
      ctx.message.text.startsWith('/') ||
      ctx.session.awaitingAdd ||
      ctx.session.editScene?.active
    )
      return next();
    await guard((ctx) => capture(ctx, ctx.message!.text!))(ctx);
  });
  const buttons = createPersonalButtons({
    guard,
    save,
    canManage: (ctx) =>
      deps.enabled() &&
      ctx.from?.id === deps.ownerId &&
      ctx.chat?.type === 'private' &&
      ctx.chat.id === deps.ownerId,
    load,
    capture,
    showPlan,
    showFocus: (ctx) => focusView(ctx),
    openTask: openTaskById,
    showWeek,
  });
  const combined = new Composer<BotContext>();
  combined.use(buttons);
  combined.use(composer);
  return combined;
};

class PersonalInputError extends Error {}
