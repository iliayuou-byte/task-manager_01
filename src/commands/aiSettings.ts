import { randomUUID } from 'node:crypto';
import { type Composer, InlineKeyboard } from 'grammy';
import { classifyTaskPriorities } from '../clients/ai.js';
import type { Metadata } from '../core/types.js';
import type { BotContext } from '../middlewares/session.js';
import {
  applyPriorityProposals,
  type PriorityProposal,
  priorityRules,
} from '../services/aiPriorities.js';
import { eisenhowerSettingsKey } from '../services/aiSettingsKey.js';
import { queryTasks } from '../services/queryTasks.js';
import { saveTasks } from '../services/saveTasks.js';
import { logAndReplyError } from '../utils/index.js';
import { splitMessages } from '../views/eisenhowerView.js';
import { MENU } from '../views/menuView.js';
import { clearMenuInput } from './menu.js';

interface State {
  id: string;
  expires: number;
  rules?: boolean;
  proposals?: PriorityProposal[];
  settings: string;
  busy?: boolean;
}
const pending = new Map<string, State>();
const key = (ctx: BotContext) => `${ctx.from!.id}:${ctx.chat!.id}`;
const stateFor = (ctx: BotContext, metadata: Metadata): State => {
  for (const [id, state] of pending)
    if (state.expires < Date.now()) pending.delete(id);
  const state = {
    id: randomUUID().slice(0, 8),
    expires: Date.now() + 15 * 60_000,
    settings: eisenhowerSettingsKey(metadata),
  };
  pending.set(key(ctx), state);
  return state;
};
const showSettings = async (ctx: BotContext) => {
  const { metadata } = await queryTasks();
  const state = stateFor(ctx, metadata);
  await ctx.reply(
    `🧠 Приоритеты ИИ\nАвтораспределение новых дел: ${metadata.ai_auto_priority === 'off' ? 'выключено' : 'включено'}\n\nМои правила:\n${priorityRules(metadata)}\n\nРучной выбор раздела защищён от перераспределения. При нехватке информации ИИ оставит раздел как есть и укажет, чего не хватает.`,
    {
      reply_markup: new InlineKeyboard()
        .text(
          metadata.ai_auto_priority === 'off'
            ? 'Включить автораспределение'
            : 'Выключить автораспределение',
          `ai:toggle:${state.id}`,
        )
        .row()
        .text('✏️ Мои правила', `ai:rules:${state.id}`)
        .row()
        .text('↩️ Стандартные правила', `ai:reset:${state.id}`)
        .row()
        .text('🗂 Разобрать текущие дела', `ai:classify:${state.id}`)
        .row()
        .text('Назад', 'menu:settings'),
    },
  );
};

export const registerAiSettings = (composer: Composer<BotContext>) => {
  composer.on('message:text', async (ctx, next) => {
    if (ctx.chat.type !== 'private') return next();
    const state = pending.get(key(ctx));
    const text = ctx.message.text.trim();
    if (
      text.startsWith('/') ||
      Object.values(MENU).some((label) => label === text)
    ) {
      pending.delete(key(ctx));
      return next();
    }
    if (!state?.rules || state.expires < Date.now()) return next();
    if (text.length > 2000)
      return await ctx.reply('Сократи правила до 2000 символов.');
    try {
      const { taskData, metadata } = await queryTasks();
      if (eisenhowerSettingsKey(metadata) !== state.settings)
        throw new Error('Settings changed');
      metadata.ai_priority_rules = text;
      if (!(await saveTasks(taskData, metadata)))
        throw new Error('Save not confirmed');
      await ctx.reply(
        '✅ Правила сохранены. Они применятся к новым делам; для старых нажми «Разобрать текущие дела».',
      );
      await showSettings(ctx);
    } catch (error) {
      logAndReplyError(
        ctx,
        'AI_SETTINGS',
        error,
        'Не удалось сохранить правила. Открой настройки заново.',
      );
    }
  });
  composer.callbackQuery(/^menu:/, async (ctx, next) => {
    pending.delete(key(ctx));
    return next();
  });
  composer.on('message:voice', async (ctx, next) => {
    const state = pending.get(key(ctx));
    if (state?.rules && state.expires >= Date.now())
      return await ctx.reply(
        'Пришли правила текстом или нажми «🏠 Меню» для отмены.',
      );
    return next();
  });
  composer.callbackQuery(/^ai:(.+)$/, async (ctx) => {
    if (ctx.chat?.type !== 'private')
      return await ctx.answerCallbackQuery({ text: 'Открой личный чат.' });
    const [action, id] = ctx.match[1].split(':');
    const state = pending.get(key(ctx));
    if (
      action !== 'open' &&
      (!state || state.id !== id || state.expires < Date.now())
    )
      return await ctx.answerCallbackQuery({
        text: 'Настройки устарели. Открой их заново.',
      });
    if (state?.busy)
      return await ctx.answerCallbackQuery({ text: 'Обрабатываю…' });
    if (state) state.busy = true;
    try {
      await ctx.answerCallbackQuery();
      clearMenuInput(ctx);
      ctx.session.awaitingAdd = undefined;
      ctx.session.editScene = undefined;
      if (action === 'open' || action === 'cancel')
        return await showSettings(ctx);
      if (!state) return;
      const { taskData, metadata } = await queryTasks();
      if (state.settings !== eisenhowerSettingsKey(metadata))
        throw new Error('Settings changed');
      if (action === 'rules') {
        state.rules = true;
        return await ctx.reply(
          'Напиши свои правила одним текстовым сообщением (до 2000 символов). Например: «Учёба и работа важные. Срочно — реальный дедлайн в ближайшие два дня. Покупки обычно менее важные, кроме лекарств. Не придумывай сроки».',
          {
            reply_markup: new InlineKeyboard().text(
              'Отмена',
              `ai:cancel:${state.id}`,
            ),
          },
        );
      }
      state.rules = false;
      if (action === 'toggle' || action === 'reset') {
        if (action === 'toggle')
          metadata.ai_auto_priority =
            metadata.ai_auto_priority === 'off' ? 'on' : 'off';
        else delete metadata.ai_priority_rules;
        if (!(await saveTasks(taskData, metadata)))
          throw new Error('Save not confirmed');
        return await showSettings(ctx);
      }
      if (action === 'classify') {
        const tasks = taskData.uncompleted.filter(
          (task) => !task.completed && !task.priorityLocked,
        );
        if (!tasks.length)
          return await ctx.reply(
            'Нет дел для распределения. Ручные разделы защищены; в карточке дела можно снова разрешить ИИ менять раздел.',
          );
        if (tasks.length > 30)
          return await ctx.reply(
            'За один раз можно разобрать до 30 дел. Сначала заверши или убери лишние.',
          );
        await ctx.reply(
          '🧠 Предлагаю распределение… Это может занять немного времени.',
        );
        const proposals = await classifyTaskPriorities(tasks, metadata);
        if (pending.get(key(ctx)) !== state) return;
        state.id = randomUUID().slice(0, 8);
        state.expires = Date.now() + 15 * 60_000;
        state.proposals = proposals;
        for (const message of splitMessages([
          '🗂 Предлагаемое распределение',
          'Разделы: 1 — важно и срочно; 2 — важно, не срочно; 3 — не важно, срочно; 4 — не важно и не срочно.',
          '',
          ...proposals.map(
            (item, index) =>
              `${index + 1}. ${item.task.name.replace(/\s+/g, ' ')} → ${item.quadrant === null ? 'оставить как есть' : `раздел ${item.quadrant}`}\n${item.reason}`,
          ),
        ]))
          await ctx.reply(message);
        return await ctx.reply(
          'Сохранить предложенные разделы? Ручные разделы останутся как есть.',
          {
            reply_markup: new InlineKeyboard()
              .text('✅ Сохранить', `ai:save:${state.id}`)
              .text('Отмена', `ai:cancel:${state.id}`),
          },
        );
      }
      if (action === 'save' && state.proposals) {
        const updated = applyPriorityProposals(taskData, state.proposals);
        if (!(await saveTasks(updated, metadata)))
          throw new Error('Save not confirmed');
        pending.delete(key(ctx));
        await ctx.reply(
          '✅ Разделы сохранены. Открой «📚 Все дела», чтобы увидеть новый список.',
        );
        return await showSettings(ctx);
      }
    } catch (error) {
      logAndReplyError(
        ctx,
        'AI_SETTINGS',
        error,
        'Не удалось выполнить действие. Список или настройки могли измениться; открой настройки и попробуй снова.',
      );
    } finally {
      if (state) state.busy = false;
    }
  });
};
