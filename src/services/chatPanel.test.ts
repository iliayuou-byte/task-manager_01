import { expect, test } from 'bun:test';
import type { BotContext } from '../middlewares/session.js';
import { beginPanel, panelReply, removeVoiceInput } from './chatPanel.js';

const fixture = (chat: number) => {
  const calls: Array<{ method: string; id?: number; text?: string }> = [];
  let message = 100;
  let failEdit = false;
  let failDelete = false;
  const api = {
    editMessageText: async (_chat: number, id: number, text: string) => {
      calls.push({ method: 'edit', id, text });
      if (failEdit) throw new Error('Message unavailable');
      return { message_id: id };
    },
    deleteMessage: async (_chat: number, id: number) => {
      calls.push({ method: 'delete', id });
      if (failDelete) throw new Error('Message unavailable');
      return true;
    },
  };
  const context = (input?: 'text' | 'voice') =>
    ({
      chat: { id: chat, type: 'private' },
      api,
      message:
        input === 'text'
          ? { message_id: 50, text: 'Input' }
          : input === 'voice'
            ? { message_id: 51, voice: { file_id: 'voice' } }
            : undefined,
      reply: async (text: string) => {
        const id = message++;
        calls.push({ method: 'send', id, text });
        return { message_id: id };
      },
    }) as unknown as BotContext;
  return {
    calls,
    context,
    failEdit: () => {
      failEdit = true;
    },
    failDelete: () => {
      failDelete = true;
    },
  };
};

test('single panel edits in place and removes consumed text', async () => {
  const f = fixture(8001);
  await panelReply(f.context('text'), 'Settings');
  await panelReply(f.context(), 'Reminder settings');
  expect(f.calls.filter((call) => call.method === 'send')).toHaveLength(1);
  expect(
    f.calls.some((call) => call.method === 'edit' && call.id === 100),
  ).toBe(true);
  expect(
    f.calls.some((call) => call.method === 'delete' && call.id === 50),
  ).toBe(true);
});

test('multipart previews stay together until replaced, then all parts are removed', async () => {
  const f = fixture(8002);
  const ctx = f.context();
  await panelReply(ctx, 'Part 1');
  await panelReply(ctx, 'Part 2');
  await panelReply(ctx, 'Confirm');
  await panelReply(f.context(), 'Saved');
  expect(
    f.calls.filter((call) => call.method === 'delete').map((call) => call.id),
  ).toEqual([100, 101, 102]);
});

test('fallback sends replacement before cleanup and cleanup failures do not break action', async () => {
  const f = fixture(8003);
  await panelReply(f.context(), 'Old menu');
  f.failEdit();
  f.failDelete();
  await panelReply(f.context(), 'New menu');
  expect(f.calls.map((call) => call.method)).toEqual([
    'send',
    'edit',
    'send',
    'delete',
  ]);
});

test('errors and original voice survive failures; successful preview can remove voice', async () => {
  const f = fixture(8004);
  const ctx = f.context('voice');
  await panelReply(ctx, 'Working');
  await panelReply(ctx, '❌ Failed');
  expect(
    f.calls.some((call) => call.method === 'delete' && call.id === 51),
  ).toBe(false);
  beginPanel(ctx);
  await panelReply(ctx, 'Preview');
  await removeVoiceInput(ctx);
  expect(
    f.calls.some((call) => call.method === 'delete' && call.id === 101),
  ).toBe(false);
  expect(
    f.calls.some((call) => call.method === 'delete' && call.id === 51),
  ).toBe(true);
});
