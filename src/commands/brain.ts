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
import { queryTasks } from '../services/queryTasks.js';
import { saveTasks } from '../services/saveTasks.js';
import { extractArg, logAndReplyError } from '../utils/index.js';
import { matrixLines, splitMessages } from '../views/eisenhowerView.js';

interface Draft {
  owner: number;
  chat: number;
  tasks: Task[];
  expires: number;
  saving: boolean;
}
const drafts = new Map<string, Draft>();
export const cancelBrainDrafts = (ctx: BotContext) => {
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

export const processBrainInput = async (ctx: BotContext, input: string) => {
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
    drafts.set(id, {
      owner: ctx.from!.id,
      chat: ctx.chat.id,
      tasks,
      expires: Date.now() + 15 * 60_000,
      saving: false,
    });
    beginPanel(ctx);
    const messages = splitMessages([
      '🧠 Предлагаю сохранить:',
      '',
      ...matrixLines(tasks),
      'Проверь список. Черновик действует 15 минут.',
    ]);
    for (let index = 0; index < messages.length; index++) {
      await panelReply(
        ctx,
        messages[index],
        index === messages.length - 1
          ? {
              reply_markup: new InlineKeyboard()
                .text('✅ Сохранить', `brain_yes:${id}`)
                .text('⬅️ Назад', `brain_no:${id}`),
            }
          : {},
      );
    }
    await removeVoiceInput(ctx);
  } catch (error) {
    logAndReplyError(
      ctx,
      Command.BRAIN,
      error,
      '❌ Не удалось разобрать список. Задачи не сохранены.',
    );
  }
};

export const registerBrainActions = (composer: Composer<BotContext>) => {
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
      logAndReplyError(
        ctx,
        Command.BRAIN,
        error,
        '❌ Не удалось подтвердить сохранение. Можно повторить кнопку; совпадающие названия будут пропущены.',
      );
    }
  });
};
