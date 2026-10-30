import { afterAll, describe, expect, it } from 'bun:test';

const original = {
  token: process.env.TELEGRAM_BOT_TOKEN,
  secret: process.env.BOT_SECRET,
  personal: process.env.PERSONAL_SYSTEM_ENABLED,
};
process.env.TELEGRAM_BOT_TOKEN = '123456:fake';
const { default: bot } = await import('./bot.js');
const { default: app } = await import('./app.js');
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
afterAll(() => {
  for (const [key, value] of Object.entries({
    TELEGRAM_BOT_TOKEN: original.token,
    BOT_SECRET: original.secret,
    PERSONAL_SYSTEM_ENABLED: original.personal,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('Personal webhook authentication', () => {
  it('rejects an unconfigured personal webhook before parsing the update', async () => {
    process.env.PERSONAL_SYSTEM_ENABLED = 'true';
    delete process.env.BOT_SECRET;
    const response = await app.request('/api', {
      method: 'POST',
      body: 'invalid JSON',
    });
    expect(response.status).toBe(503);
  });
  it('rejects missing/wrong secrets and a forged owner payload', async () => {
    process.env.PERSONAL_SYSTEM_ENABLED = 'true';
    process.env.BOT_SECRET = 'test-placeholder-secret';
    for (const header of ['', 'wrong']) {
      const response = await app.request('/api', {
        method: 'POST',
        headers: { 'x-telegram-bot-api-secret-token': header },
        body: JSON.stringify({
          update_id: 1,
          message: {
            from: { id: 1 },
            chat: { id: 2, type: 'private' },
            text: '/coaching export',
          },
        }),
      });
      expect(response.status).toBe(401);
    }
  });
  it('accepts an authenticated no-op update without external APIs', async () => {
    const response = await app.request('/api', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'test-placeholder-secret' },
      body: JSON.stringify({ update_id: 2 }),
    });
    expect(response.status).toBe(200);
  });
});
