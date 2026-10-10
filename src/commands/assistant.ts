import { randomUUID } from 'node:crypto';
import { type Composer, InlineKeyboard } from 'grammy';
import { generateAssistantReply } from '../clients/ai.js';
import logger from '../core/logger.js';
import type { BotContext } from '../middlewares/session.js';
import { aiFailure } from '../services/aiFailure.js';
import { AssistantHistory } from '../services/assistantHistory.js';
import { panelReply } from '../services/chatPanel.js';
import { queryTasks } from '../services/queryTasks.js';
import { cancelBrainDrafts, processBrainInput } from './brain.js';
import { clearMenuInput } from './menu.js';
import { cancelRemovalDrafts, removeByVoice } from './removeSelected.js';

const keyboard = (ctx: BotContext) => {
  const state = ctx.session.assistant;
  const buttons = new InlineKeyboard();
  if (state?.suggestion)
    buttons
      .text('📝 Подготовить черновик', `assistant:draft:${state.id}`)
      .row();
  return buttons
    .text('🧹 Забыть разговор', 'assistant:forget')
    .row()
    .text('⬅️ Назад', 'menu:home')
    .text('🏠 Меню', 'menu:home');
};

export const openAssistant = async (ctx: BotContext) => {
  if (ctx.chat?.type !== 'private' || !ctx.from) return;
  cancelBrainDrafts(ctx);
  cancelRemovalDrafts(ctx);
  clearMenuInput(ctx);
  ctx.session.awaitingAdd = undefined;
  ctx.session.editScene = undefined;
  ctx.session.assistant = {
    id: randomUUID().slice(0, 8),
    expires: Date.now() + 30 * 60_000,
  };
  await panelReply(
    ctx,
    '💬 Давай разберёмся. Что сейчас хочется обсудить: за что взяться, как разгрузить день или почему дело зависло? Можно текстом или голосом.\n\nЯ вижу текущие дела и помню последние 6 обменов репликами. «Забыть разговор» очищает эту память; сами дела остаются.',
    { reply_markup: keyboard(ctx) },
  );
};

export const processAssistantInput = async (ctx: BotContext, input: string) => {
  const state = ctx.session.assistant;
  if (!state || ctx.chat?.type !== 'private' || !ctx.from) return;
  if (state.expires < Date.now()) {
    ctx.session.assistant = undefined;
    return await panelReply(ctx, 'Разговор приостановлен. Открой /talk.');
  }
  if (state.busy)
    return await panelReply(ctx, 'Ещё думаю над предыдущим сообщением.', {
      reply_markup: keyboard(ctx),
    });
  if (!input.trim() || input.length > 6000)
    return await panelReply(ctx, 'Пришли сообщение до 6000 символов.', {
      reply_markup: keyboard(ctx),
    });
  state.busy = true;
  state.suggestion = undefined;
  try {
    ctx.chatAction = 'typing';
    const { taskData, metadata } = await queryTasks();
    const history = new AssistantHistory();
    const result = await generateAssistantReply(
      input,
      history.get(ctx.from.id, ctx.chat.id),
      taskData,
      metadata,
    );
    if (ctx.session.assistant !== state) return;
    history.append(ctx.from.id, ctx.chat.id, input, result.reply);
    state.id = randomUUID().slice(0, 8);
    state.expires = Date.now() + 30 * 60_000;
    if (result.action !== 'none' && result.taskInput.trim())
      state.suggestion = { mode: result.action, input: result.taskInput };
    await panelReply(ctx, result.reply, { reply_markup: keyboard(ctx) });
  } catch (error) {
    if (ctx.session.assistant !== state) return;
    const failure = aiFailure(error);
    logger.warnWithContext({
      op: 'ASSISTANT',
      userId: ctx.from.id,
      message: failure.diagnostic,
    });
    await panelReply(ctx, `❌ ${failure.reason} Сообщение осталось в чате.`, {
      reply_markup: keyboard(ctx),
    });
  } finally {
    state.busy = false;
  }
};

export const registerAssistant = (composer: Composer<BotContext>) => {
  composer.command('talk', openAssistant);
  composer.callbackQuery(
    /^assistant:(forget|draft)(?::(.+))?$/,
    async (ctx) => {
      if (ctx.chat?.type !== 'private') return await ctx.answerCallbackQuery();
      const state = ctx.session.assistant;
      if (!state || state.expires < Date.now() || state.busy) {
        await ctx.answerCallbackQuery({ text: 'Открой «Поговорить» заново.' });
        return;
      }
      await ctx.answerCallbackQuery();
      if (ctx.match[1] === 'forget') {
        new AssistantHistory().clear(ctx.from.id, ctx.chat.id);
        await openAssistant(ctx);
        return;
      }
      if (ctx.match[2] !== state.id || !state.suggestion) return;
      const suggestion = state.suggestion;
      ctx.session.assistant = undefined;
      if (suggestion.mode === 'add')
        await processBrainInput(ctx, suggestion.input);
      else await removeByVoice(ctx, suggestion.input);
    },
  );
  composer.on('message:text', async (ctx, next) => {
    if (
      ctx.chat.type !== 'private' ||
      !ctx.session.assistant ||
      ctx.message.text.startsWith('/')
    )
      return next();
    if (ctx.session.assistant.expires < Date.now()) {
      ctx.session.assistant = undefined;
      return await panelReply(ctx, 'Разговор приостановлен. Открой /talk.');
    }
    await processAssistantInput(ctx, ctx.message.text);
  });
};
