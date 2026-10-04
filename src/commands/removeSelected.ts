import { randomUUID } from 'node:crypto';
import { type Composer, InlineKeyboard } from 'grammy';
import { generateVoiceRemoval } from '../clients/ai.js';
import type { Task } from '../core/types.js';
import type { BotContext } from '../middlewares/session.js';
import {
  beginPanel,
  panelReply,
  removeVoiceInput,
} from '../services/chatPanel.js';
import { queryTasks } from '../services/queryTasks.js';
import { saveTasks } from '../services/saveTasks.js';
import {
  getNumberedTasks,
  numberedTasks,
  parseTaskNumbers,
  removeSelectedTasks,
} from '../services/taskNumbers.js';
import { logAndReplyError, promptCalendarAction } from '../utils/index.js';
import { splitMessages } from '../views/eisenhowerView.js';

const pending = new Map<
  string,
  {
    owner: number;
    chat: number;
    tasks: Task[];
    expires: number;
    saving: boolean;
  }
>();

export const previewRemoval = async (ctx: BotContext, tasks: Task[]) => {
  if (!tasks.length)
    return await panelReply(
      ctx,
      'Не нашёл однозначно выбранных задач. Используй /list, затем /remove 1 3.',
    );
  const { taskData } = await queryTasks();
  removeSelectedTasks(taskData, tasks); // Reject stale list before asking for confirmation.
  for (const [key, draft] of pending)
    if (
      draft.expires < Date.now() ||
      (draft.owner === ctx.from!.id && !draft.saving)
    )
      pending.delete(key);
  const id = randomUUID();
  pending.set(id, {
    owner: ctx.from!.id,
    chat: ctx.chat!.id,
    tasks,
    expires: Date.now() + 15 * 60_000,
    saving: false,
  });
  beginPanel(ctx);
  const messages = splitMessages([
    '🗑️ Удалить эти дела?',
    ...tasks.map((task) => `• ${task.name.slice(0, 250)}`),
    '',
    'Удаление произойдёт только после подтверждения.',
  ]);
  for (let index = 0; index < messages.length; index++) {
    await panelReply(
      ctx,
      messages[index],
      index === messages.length - 1
        ? {
            reply_markup: new InlineKeyboard()
              .text('🗑️ Удалить', `del_yes:${id}`)
              .text('Отмена', `del_no:${id}`),
          }
        : {},
    );
  }
  await removeVoiceInput(ctx);
};

export const removeByNumbers = async (ctx: BotContext, input: string) => {
  try {
    if (ctx.chat?.type !== 'private')
      return await panelReply(ctx, 'Удаляй по номерам в личном чате.');
    const tasks = getNumberedTasks(ctx.from!.id, ctx.chat.id);
    if (!tasks)
      return await panelReply(
        ctx,
        'Сначала открой /list или /today — номера относятся к последнему показанному списку.',
      );
    const numbers = parseTaskNumbers(input);
    if (numbers.some((number) => number > tasks.length))
      return await panelReply(
        ctx,
        'Такого номера нет в последнем списке. Проверь /list.',
      );
    await previewRemoval(
      ctx,
      numbers.map((number) => tasks[number - 1]),
    );
  } catch (error) {
    logAndReplyError(
      ctx,
      'REMOVE_NUMBERS',
      error,
      'Не удалось выбрать дела. Обнови /list и используй /remove 1 3.',
    );
  }
};

export const removeByVoice = async (ctx: BotContext, transcript: string) => {
  try {
    const { taskData } = await queryTasks();
    const snapshot = getNumberedTasks(ctx.from!.id, ctx.chat!.id);
    const tasks =
      snapshot ??
      numberedTasks([...taskData.uncompleted, ...taskData.completed]);
    const selection = await generateVoiceRemoval(transcript, tasks);
    if (selection.mode !== 'delete')
      return await panelReply(
        ctx,
        'Скажи отдельно, какие дела удалить, без добавления новых: «удали дело про продукты» или «удали первое и третье».',
      );
    if (selection.byNumber && !snapshot)
      return await panelReply(
        ctx,
        'Для удаления по номерам сначала открой /list.',
      );
    if (selection.numbers.some((number) => number > tasks.length))
      return await panelReply(
        ctx,
        'Не распознал номера. Обнови /list и попробуй ещё раз.',
      );
    await previewRemoval(
      ctx,
      selection.numbers.map((number) => tasks[number - 1]),
    );
  } catch (error) {
    logAndReplyError(
      ctx,
      'REMOVE_VOICE',
      error,
      '❌ Не удалось разобрать удаление. Ничего не удалено. Можно использовать /remove 1 3 после /list.',
    );
  }
};

export const registerSelectedRemoval = (composer: Composer<BotContext>) => {
  composer.callbackQuery(/^del_(yes|no):(.+)$/, async (ctx) => {
    const id = ctx.match[2];
    const draft = pending.get(id);
    if (
      !draft ||
      draft.owner !== ctx.from.id ||
      draft.chat !== ctx.chat?.id ||
      draft.expires < Date.now()
    ) {
      await ctx.answerCallbackQuery({
        text: 'Подтверждение устарело. Выбери дела заново.',
      });
      return;
    }
    if (draft.saving) {
      await ctx.answerCallbackQuery({ text: 'Уже удаляю…' });
      return;
    }
    if (ctx.match[1] === 'yes') draft.saving = true;
    await ctx.answerCallbackQuery();
    if (ctx.match[1] === 'no') {
      pending.delete(id);
      await panelReply(ctx, 'Отменено. Дела сохранены.');
      return;
    }
    draft.saving = true;
    try {
      const { taskData, metadata } = await queryTasks();
      const updated = removeSelectedTasks(taskData, draft.tasks);
      if (!(await saveTasks(updated, metadata)))
        throw new Error('Save not confirmed');
      pending.delete(id);
      await panelReply(
        ctx,
        `✅ Удалено дел: ${draft.tasks.length}.\nОткрой /list для новых номеров.`,
      );
      const ops = draft.tasks
        .filter((task) => task.calendarEventId)
        .map((task) => ({
          type: 'remove' as const,
          taskName: task.name,
          calendarEventId: task.calendarEventId,
        }));
      if (ops.length)
        await promptCalendarAction(
          ctx,
          'Удалить связанные события Google Calendar?',
          ops,
        );
    } catch (error) {
      draft.saving = false;
      logAndReplyError(
        ctx,
        'REMOVE_CONFIRM',
        error,
        '❌ Не удалось подтвердить удаление: список мог измениться. Проверь /list и выбери дела заново.',
      );
    }
  });
};
