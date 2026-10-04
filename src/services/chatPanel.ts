import type { BotContext } from '../middlewares/session.js';
import { navigationKeyboard } from '../views/menuView.js';

type ReplyOptions = Parameters<BotContext['reply']>[1];
interface Panel {
  ids: number[];
  updated: number;
}
const panels = new Map<number, Panel>();
const started = new WeakSet<BotContext>();
const cleanedInputs = new WeakSet<BotContext>();
export const beginPanel = (ctx: BotContext) => {
  started.delete(ctx);
};

// Only explicitly routed UI messages participate. Reminders and errors stay in history.
export const panelReply = async (
  ctx: BotContext,
  text: string,
  options?: ReplyOptions,
) => {
  if (ctx.chat?.type === 'private') {
    const markup = options?.reply_markup;
    if (!markup) options = { ...options, reply_markup: navigationKeyboard() };
    else if ('inline_keyboard' in markup) {
      const rows = markup.inline_keyboard.map((row) => [...row]);
      const buttons = rows.flat();
      const footer = [];
      if (!buttons.some((button) => button.text.includes('Назад')))
        footer.push({ text: '⬅️ Назад', callback_data: 'menu:back' });
      if (
        !buttons.some(
          (button) =>
            'callback_data' in button && button.callback_data === 'menu:home',
        )
      )
        footer.push({ text: '🏠 Меню', callback_data: 'menu:home' });
      if (footer.length) rows.push(footer);
      options = { ...options, reply_markup: { inline_keyboard: rows } };
    }
  }
  if (/^(?:❌|Не удалось|Дело изменилось)/.test(text))
    return ctx.reply(text, options);
  if (ctx.chat?.type !== 'private') return ctx.reply(text, options);
  const chat = ctx.chat.id;
  for (const [id, panel] of panels)
    if (Date.now() - panel.updated > 24 * 60 * 60_000) panels.delete(id);
  const first = !started.has(ctx);
  const previous = first ? panels.get(chat) : undefined;
  const markup = options?.reply_markup;
  const canEdit =
    previous?.ids.length === 1 && (!markup || 'inline_keyboard' in markup);
  if (canEdit) {
    try {
      const result = await ctx.api.editMessageText(
        chat,
        previous.ids[0],
        text,
        {
          ...options,
          reply_markup:
            markup && 'inline_keyboard' in markup
              ? markup
              : { inline_keyboard: [] },
        },
      );
      started.add(ctx);
      previous.updated = Date.now();
      await removeInput(ctx);
      return result;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('message is not modified')
      ) {
        started.add(ctx);
        await removeInput(ctx);
        return;
      }
      // Deleted/old messages or noneditable markup: send the replacement first.
    }
  }
  const message = await ctx.reply(text, options);
  started.add(ctx);
  if (first) {
    panels.set(chat, { ids: [message.message_id], updated: Date.now() });
    await Promise.allSettled(
      (previous?.ids ?? []).map((id) => ctx.api.deleteMessage(chat, id)),
    );
  } else {
    const current = panels.get(chat);
    if (current) {
      current.ids.push(message.message_id);
      current.updated = Date.now();
    } else panels.set(chat, { ids: [message.message_id], updated: Date.now() });
  }
  await removeInput(ctx);
  return message;
};

const removeInput = async (ctx: BotContext) => {
  // Keep voice originals until the task operation succeeds, and leave unrelated history alone.
  if (cleanedInputs.has(ctx)) return;
  if (!ctx.message || !('text' in ctx.message) || ctx.chat?.type !== 'private')
    return;
  cleanedInputs.add(ctx);
  try {
    await ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id);
  } catch {
    /* Cleanup must not fail the action. */
  }
};

export const removeVoiceInput = async (ctx: BotContext) => {
  if (!ctx.message?.voice || ctx.chat?.type !== 'private') return;
  try {
    await ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id);
  } catch {
    /* Best effort. */
  }
};
