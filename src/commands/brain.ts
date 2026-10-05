import { randomUUID } from 'node:crypto';
import { type Composer, InlineKeyboard } from 'grammy';
import { generateBrainTasks } from '../clients/ai.js';
import { Command } from '../core/config.js';
import type { Task } from '../core/types.js';
import type { BotContext } from '../middlewares/session.js';
import { uniqueBrainTasks } from '../services/brainDraft.js';
import {
  beginPanel,
  panelReply,
  removeVoiceInput,
} from '../services/chatPanel.js';
import { getQuadrant, QUADRANTS, setQuadrant } from '../services/eisenhower.js';
import { pausePendingInputs, recoverInput } from '../services/pendingInputs.js';
import { queryTasks } from '../services/queryTasks.js';
import { saveTasks } from '../services/saveTasks.js';
import { displayTaskTags } from '../services/taskTags.js';
import { extractArg, logAndReplyError } from '../utils/index.js';
import { splitMessages } from '../views/eisenhowerView.js';

interface Draft {
  owner: number;
  chat: number;
  tasks: Task[];
  expires: number;
  saving: boolean;
  reviewed: Set<number>;
}
const drafts = new Map<string, Draft>();
export const cancelBrainDrafts = (ctx: BotContext) => {
  pausePendingInputs(ctx);
  for (const [id, draft] of drafts)
    if (
      draft.owner === ctx.from?.id &&
      draft.chat === ctx.chat?.id &&
      !draft.saving
    )
      drafts.delete(id);
};

export const brainCommand = async (ctx: BotContext) => {
  const input = extractArg(ctx.message?.text ?? '', Command.BRAIN).trim();
  return processBrainInput(ctx, input);
};

export const processBrainInput = async (
  ctx: BotContext,
  input: string,
  retrying = false,
  shouldContinue = () => true,
) => {
  try {
    if (ctx.chat?.type !== 'private') {
      return await panelReply(ctx, 'Используй /brain в личном чате с ботом.');
    }
    if (!input) {
      return await panelReply(
        ctx,
        '/brain надо сопромат 40 минут, купить продукты, завтра проверить 1С',
      );
    }
    if (input.length > 6000)
      return await panelReply(
        ctx,
        'Раздели текст на сообщения до 6000 символов.',
      );
    ctx.chatAction = 'typing';
    const { taskData, metadata } = await queryTasks();
    if (!metadata.timezone)
      return await panelReply(ctx, 'Сначала /settimezone Europe/Berlin');
    const tasks = uniqueBrainTasks(
      await generateBrainTasks(input, metadata.timezone, metadata),
      taskData.uncompleted,
    );
    if (!shouldContinue()) return;
    if (!tasks.length)
      return await panelReply(
        ctx,
        'Новых задач не найдено: список пуст или задачи уже есть.',
      );
    for (const [key, draft] of drafts) {
      if (
        draft.expires < Date.now() ||
        (draft.owner === ctx.from!.id && !draft.saving)
      )
        drafts.delete(key);
    }
    const id = randomUUID();
    const draft: Draft = {
      owner: ctx.from!.id,
      chat: ctx.chat.id,
      tasks,
      expires: Date.now() + 15 * 60_000,
      saving: false,
      reviewed: new Set(),
    };
    drafts.set(id, draft);
    await showDraft(ctx, id, draft);
    await removeVoiceInput(ctx);
  } catch (error) {
    if (retrying) throw error;
    await recoverInput(ctx, input, error, 'brain');
  }
};

const categoryButtons = [
  '🔴 Важно и срочно',
  '🟡 Важно, не срочно',
  '🔵 Неважно, но срочно',
  '⚪ Неважно и не срочно',
];

const showDraft = async (ctx: BotContext, id: string, draft: Draft) => {
  beginPanel(ctx);
  const lines = QUADRANTS.flatMap((title, quadrant) => [
    `-------- ${title} --------`,
    ...draft.tasks.flatMap((task, index) =>
      getQuadrant(task) === quadrant + 1
        ? [
            `${index + 1}. ${draft.reviewed.has(index) ? '✅' : '❓'} ${task.name.replace(/\s+/g, ' ').slice(0, 250)}${displayTaskTags(task.tags)}${task.date ? ` (${task.date}${task.time ? ` ${task.time}` : ''})` : ''}`,
          ]
        : [],
    ),
    '',
  ]);
  const messages = splitMessages([
    '🧠 Как распределим дела?',
    '❓ — предложение ИИ, ещё не проверено тобой. ✅ — твой выбор.',
    'Важность: влияет на цели или имеет серьёзные последствия. Срочность: есть близкий срок или последствия промедления.',
    '',
    ...lines,
    'Можно разобрать всё по одному или изменить отдельное дело. Номера сохраняются при переносе. До сохранения это только черновик (15 минут).',
  ]);
  for (let index = 0; index < messages.length; index++) {
    await panelReply(
      ctx,
      messages[index],
      index === messages.length - 1
        ? {
            reply_markup: new InlineKeyboard()
              .text('🧭 Разобрать по одному', `brain_review:${id}`)
              .row()
              .text('🔀 Изменить категорию', `brain_pick:${id}:0`)
              .row()
              .text('✅ Сохранить', `brain_yes:${id}`)
              .text('⬅️ Назад', `brain_no:${id}`),
          }
        : {},
    );
  }
};

const showDraftTask = async (
  ctx: BotContext,
  id: string,
  draft: Draft,
  index: number,
  mode: string,
) => {
  const task = draft.tasks[index];
  const keyboard = new InlineKeyboard();
  categoryButtons.forEach((label, quadrant) => {
    keyboard
      .text(label, `brain_set:${id}:${index}:${quadrant + 1}:${mode}`)
      .row();
  });
  if (mode === 'all')
    keyboard
      .text(
        'Оставить предложение ИИ',
        `brain_set:${id}:${index}:${getQuadrant(task)}:all`,
      )
      .row();
  keyboard.text('⬅️ Назад', `brain_pick:${id}:${Math.floor(index / 6)}`);
  await panelReply(
    ctx,
    `Дело ${index + 1} из ${draft.tasks.length}: ${task.name}\n\nПредложенная категория: ${QUADRANTS[getQuadrant(task) - 1]}\n\nВажно ли это для твоих целей? Что случится, если отложить? Есть ли срок — например, до выхода из дома? Выбери категорию.`,
    { reply_markup: keyboard },
  );
};

const showDraftPicker = async (
  ctx: BotContext,
  id: string,
  draft: Draft,
  page: number,
) => {
  const keyboard = new InlineKeyboard();
  const start = page * 6;
  draft.tasks.slice(start, start + 6).forEach((task, offset) => {
    keyboard
      .text(
        `${start + offset + 1}. ${task.name.slice(0, 45)}`,
        `brain_task:${id}:${start + offset}`,
      )
      .row();
  });
  if (page > 0) keyboard.text('◀️ Ранее', `brain_pick:${id}:${page - 1}`);
  if (start + 6 < draft.tasks.length)
    keyboard.text('Далее ▶️', `brain_pick:${id}:${page + 1}`);
  keyboard.row().text('⬅️ Назад', `brain_preview:${id}`);
  await panelReply(ctx, 'Выбери дело, которому нужно изменить категорию.', {
    reply_markup: keyboard,
  });
};

export const registerBrainActions = (composer: Composer<BotContext>) => {
  composer.callbackQuery(
    /^brain_(review|pick|task|set|preview):([^:]+)(?::(\d+))?(?::([1-4]))?(?::(all|one))?$/,
    async (ctx) => {
      const [, action, id, rawIndex, rawQuadrant, mode] = ctx.match;
      const draft = drafts.get(id);
      if (
        !draft ||
        draft.owner !== ctx.from.id ||
        draft.chat !== ctx.chat?.id ||
        draft.expires < Date.now() ||
        draft.saving
      ) {
        await ctx.answerCallbackQuery({
          text: 'Черновик недоступен или уже сохраняется.',
        });
        return;
      }
      const index = Number(rawIndex ?? 0);
      if ((action === 'task' || action === 'set') && !draft.tasks[index]) {
        await ctx.answerCallbackQuery({ text: 'Дело недоступно.' });
        return;
      }
      if (action === 'pick' && index * 6 >= draft.tasks.length) {
        await ctx.answerCallbackQuery({ text: 'Страница недоступна.' });
        return;
      }
      if (action === 'set' && (!rawQuadrant || !mode)) {
        await ctx.answerCallbackQuery({ text: 'Категория недоступна.' });
        return;
      }
      await ctx.answerCallbackQuery();
      if (action === 'preview') await showDraft(ctx, id, draft);
      else if (action === 'pick') await showDraftPicker(ctx, id, draft, index);
      else if (action === 'review' || action === 'task')
        await showDraftTask(
          ctx,
          id,
          draft,
          action === 'review' ? 0 : index,
          action === 'review' ? 'all' : 'one',
        );
      else {
        draft.tasks[index] = setQuadrant(
          draft.tasks[index],
          Number(rawQuadrant),
        );
        draft.reviewed.add(index);
        if (mode === 'all' && index + 1 < draft.tasks.length)
          await showDraftTask(ctx, id, draft, index + 1, mode);
        else await showDraft(ctx, id, draft);
      }
    },
  );
  composer.callbackQuery(/^brain_(yes|no):(.+)$/, async (ctx) => {
    const id = ctx.match[2];
    const draft = drafts.get(id);
    if (
      !draft ||
      draft.owner !== ctx.from.id ||
      draft.chat !== ctx.chat?.id ||
      draft.expires < Date.now()
    ) {
      await ctx.answerCallbackQuery({
        text: 'Черновик недоступен. Отправь /brain заново.',
      });
      return;
    }
    if (draft.saving) {
      await ctx.answerCallbackQuery({ text: 'Уже сохраняю…' });
      return;
    }
    await ctx.answerCallbackQuery();
    if (ctx.match[1] === 'no') {
      drafts.delete(id);
      const { showAddPrompt } = await import('./menu.js');
      await showAddPrompt(ctx);
      return;
    }
    draft.saving = true;
    try {
      const { taskData, metadata } = await queryTasks();
      const additions = uniqueBrainTasks(draft.tasks, taskData.uncompleted);
      if (additions.length) {
        taskData.uncompleted.unshift(...additions);
        if (!(await saveTasks(taskData, metadata)))
          throw new Error('Storage did not confirm save');
      }
      drafts.delete(id);
      await panelReply(
        ctx,
        `✅ Добавлено задач: ${additions.length}.\n\n${additions.map((task) => `• ${task.name}`).join('\n')}\n\n/now — следующий шаг\n/list — весь список`,
      );
    } catch (error) {
      draft.saving = false;
      await logAndReplyError(
        ctx,
        Command.BRAIN,
        error,
        '❌ Не удалось подтвердить сохранение. Можно повторить кнопку; совпадающие названия будут пропущены.',
      );
    }
  });
};
