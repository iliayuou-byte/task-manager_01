import { afterAll, describe, expect, it } from 'bun:test';
import { ALLOWED_USERS } from './core/config.js';

const originalToken = process.env.TELEGRAM_BOT_TOKEN;
const originalAllowlist = [...ALLOWED_USERS];
process.env.TELEGRAM_BOT_TOKEN = '123456:fake';
ALLOWED_USERS.splice(0, ALLOWED_USERS.length, 1);
const { default: bot } = await import('./bot.js');
bot.botInfo = {
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
};
const calls: string[] = [];
bot.api.config.use(async (_previous, method) => {
  calls.push(method);
  return { ok: false, error_code: 400, description: 'Offline test transport' };
});
afterAll(() => {
  ALLOWED_USERS.splice(0, ALLOWED_USERS.length, ...originalAllowlist);
  if (originalToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = originalToken;
});

describe('Bot authorization ordering', () => {
  it('checks authorization before a scene callback can edit a message', async () => {
    await bot.handleUpdate({
      update_id: 1,
      callback_query: {
        id: '1',
        from: { id: 2, is_bot: false, first_name: 'Other' },
        chat_instance: 'private',
        data: 'add_cancel',
        message: {
          message_id: 1,
          date: 1,
          chat: { id: 2, type: 'private', first_name: 'Other' },
        },
      },
    });
    expect(calls).toContain('sendMessage');
    expect(calls).not.toContain('editMessageText');
    expect(calls).not.toContain('answerCallbackQuery');
  });
});
