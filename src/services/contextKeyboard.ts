import { type Composer, Context, Keyboard } from 'grammy';
import type { BotContext } from '../middlewares/session.js';

interface Actions {
  callbacks: Map<string, string>;
  expires: number;
}
const screens = new Map<number, Actions>();

export const buildContextKeyboard = (
  rows: Array<Array<{ text: string; callback_data?: string }>>,
) => {
  const keyboard = new Keyboard();
  const callbacks = new Map<string, string>();
  const targets = new Map<string, Set<string>>();
  const occurrences = new Map<string, number>();
  for (const button of rows.flat())
    if (button.callback_data) {
      const actions = targets.get(button.text) ?? new Set<string>();
      actions.add(button.callback_data);
      targets.set(button.text, actions);
    }
  for (const row of rows) {
    for (const button of row) {
      if (!button.callback_data) continue;
      const occurrence = (occurrences.get(button.text) ?? 0) + 1;
      occurrences.set(button.text, occurrence);
      const label =
        (targets.get(button.text)?.size ?? 0) > 1
          ? `${button.text} (${occurrence})`
          : button.text;
      keyboard.text(label);
      callbacks.set(label, button.callback_data);
    }
    keyboard.row();
  }
  return { keyboard: keyboard.resized().persistent(), callbacks };
};

export const rememberKeyboard = (
  chat: number,
  callbacks: Map<string, string>,
) => {
  for (const [id, screen] of screens)
    if (screen.expires < Date.now()) screens.delete(id);
  screens.set(chat, { callbacks, expires: Date.now() + 30 * 60_000 });
};
export const getKeyboardAction = (
  chat: number,
  label: string,
): string | undefined => {
  const screen = screens.get(chat);
  return screen && screen.expires > Date.now()
    ? screen.callbacks.get(label)
    : undefined;
};

// Reply keyboards send text. Route their current buttons through the same validated
// handlers as inline buttons so confirmations, ownership and stale checks stay shared.
export const registerContextKeyboard = (composer: Composer<BotContext>) => {
  composer.on('message:text', async (ctx, next) => {
    if (ctx.chat.type !== 'private') return next();
    const action = getKeyboardAction(ctx.chat.id, ctx.message.text.trim());
    if (!action) return next();
    const callback = new Context(
      {
        update_id: ctx.update.update_id,
        callback_query: {
          id: `keyboard:${ctx.message.message_id}`,
          from: ctx.from,
          chat_instance: String(ctx.chat.id),
          data: action,
          message: ctx.message,
        },
      },
      ctx.api,
      ctx.me,
    ) as BotContext;
    callback.session = ctx.session;
    callback.answerCallbackQuery = async (options) => {
      const text = typeof options === 'string' ? options : options?.text;
      if (text) await ctx.reply(text);
      return true;
    };
    await composer.middleware()(callback, async () => {});
    try {
      await ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id);
    } catch {
      /* Keyboard tap cleanup is best effort. */
    }
  });
};
