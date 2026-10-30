import { randomUUID } from 'node:crypto';
import type { Composer } from 'grammy';
import type { BotContext } from '../middlewares/session.js';

type Button = { text: string; callback_data?: string };
type ReplyOptions = Parameters<BotContext['reply']>[1];
interface KeyboardScreen {
  rows: Button[][];
  chat: number;
  text: string;
  options?: ReplyOptions;
  expires: number;
}
const pages = new Map<string, KeyboardScreen>();

export const buildContextKeyboard = (
  rows: Button[][],
  screen?: {
    chat: number;
    text: string;
    options?: ReplyOptions;
    page?: number;
    id?: string;
  },
) => {
  const buttons = rows.flat().filter((button) => button.callback_data);
  const footer = buttons.filter(
    (button) =>
      /^menu:filter(?:today|all)$/.test(button.callback_data ?? '') ||
      /^(?:⬅️ )?Назад$|^(?:🏠 )?Меню$|^◀|^▶|^Next|^✏️ Ввести HH:MM$/.test(
        button.text,
      ),
  );
  const actions = buttons.filter((button) => !footer.includes(button));
  let visible = actions;
  if (screen && actions.length > 6) {
    for (const [id, cached] of pages)
      if (cached.expires < Date.now()) pages.delete(id);
    const id = screen.id ?? randomUUID().slice(0, 8);
    pages.set(id, {
      rows,
      chat: screen.chat,
      text: screen.text,
      options: screen.options,
      expires: Date.now() + 30 * 60_000,
    });
    const page = Math.min(
      Math.max(0, screen.page ?? 0),
      Math.ceil(actions.length / 6) - 1,
    );
    visible = actions.slice(page * 6, page * 6 + 6);
    if (page > 0)
      footer.unshift({ text: '◀️', callback_data: `kbd:${id}:${page - 1}` });
    if ((page + 1) * 6 < actions.length)
      footer.unshift({ text: '▶️', callback_data: `kbd:${id}:${page + 1}` });
  }
  const rowsOfPairs = (items: Button[]) => {
    const result: { text: string; callback_data: string }[][] = [];
    for (let index = 0; index < items.length; index += 2) {
      result.push(
        items.slice(index, index + 2).map((button) => ({
          text:
            button.text.length > 26
              ? `${button.text.slice(0, 25)}…`
              : button.text,
          callback_data: button.callback_data!,
        })),
      );
    }
    return result;
  };
  const keyboard = {
    inline_keyboard: [...rowsOfPairs(visible), ...rowsOfPairs(footer)],
  };
  return { keyboard };
};

export const registerContextKeyboard = (composer: Composer<BotContext>) => {
  composer.callbackQuery(/^kbd:([^:]+):(\d+)$/, async (ctx) => {
    const screen = pages.get(ctx.match[1]);
    if (
      !screen ||
      screen.chat !== ctx.chat?.id ||
      screen.expires < Date.now()
    ) {
      await ctx.answerCallbackQuery({
        text: 'Меню устарело. Открой раздел заново.',
      });
      return;
    }
    await ctx.answerCallbackQuery();
    const layout = buildContextKeyboard(screen.rows, {
      ...screen,
      page: Number(ctx.match[2]),
      id: ctx.match[1],
    });
    const { panelReply } = await import('./chatPanel.js');
    await panelReply(ctx, screen.text, {
      ...screen.options,
      reply_markup: layout.keyboard,
    });
  });
};
