import { expect, test } from 'bun:test';
import type { BotContext } from '../middlewares/session.js';
import {
  beginPanel,
  panelReply,
  removePanelMessage,
  removeVoiceInput,
} from './chatPanel.js';

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

test('context keyboard replaces the panel and removes consumed text', async () => {
  const f = fixture(8001);
  await panelReply(f.context('text'), 'Settings');
  await panelReply(f.context(), 'Reminder settings');
  expect(f.calls.filter((call) => call.method === 'send')).toHaveLength(2);
  expect(
    f.calls.some((call) => call.method === 'delete' && call.id === 100),
  ).toBe(true);
  expect(
    f.calls.some((call) => call.method === 'delete' && call.id === 50),
  ).toBe(true);
});

test('multipart previews stay together until replaced, then all parts are removed', async () => {
  const f = fixture(8002);
  const ctx = f.context();
  await panelReply(ctx, 'Part 1', undefined, { navigation: false });
  await panelReply(ctx, 'Part 2', undefined, { navigation: false });
  await panelReply(ctx, 'Confirm', undefined, { navigation: false });
  await panelReply(f.context(), 'Saved', undefined, { navigation: false });
  expect(
    f.calls.filter((call) => call.method === 'delete').map((call) => call.id),
  ).toEqual([100, 101, 102]);
});

test('new keyboard is sent before cleanup and cleanup failures do not break action', async () => {
  const f = fixture(8003);
  await panelReply(f.context(), 'Old menu', {
    reply_markup: { keyboard: [[{ text: 'Action' }]] },
  });
  f.failEdit();
  f.failDelete();
  await panelReply(f.context(), 'New menu', {
    reply_markup: { keyboard: [[{ text: 'Action' }]] },
  });
  expect(f.calls.map((call) => call.method)).toEqual([
    'send',
    'send',
    'delete',
  ]);
});

test('errors and original voice survive failures; successful preview can remove voice', async () => {
  const f = fixture(8004);
  const ctx = f.context('voice');
  await panelReply(ctx, 'Working', undefined, { navigation: false });
  await panelReply(ctx, '❌ Failed', undefined, { navigation: false });
  expect(
    f.calls.some((call) => call.method === 'delete' && call.id === 51),
  ).toBe(false);
  beginPanel(ctx);
  await panelReply(ctx, 'Preview', undefined, { navigation: false });
  await removeVoiceInput(ctx);
  expect(
    f.calls.some((call) => call.method === 'delete' && call.id === 101),
  ).toBe(false);
  expect(
    f.calls.some((call) => call.method === 'delete' && call.id === 51),
  ).toBe(true);
});

test('status cleanup preserves the voice and a newer menu', async () => {
  const f = fixture(8005);
  const voice = f.context('voice');
  await panelReply(voice, 'Working', {
    reply_markup: { keyboard: [[{ text: 'Action' }]] },
  });
  await panelReply(f.context(), 'New menu', {
    reply_markup: { keyboard: [[{ text: 'Action' }]] },
  });
  await removePanelMessage(voice, 100);
  await panelReply(f.context(), 'Next menu', {
    reply_markup: { keyboard: [[{ text: 'Action' }]] },
  });
  expect(
    f.calls.filter((call) => call.method === 'delete').map((call) => call.id),
  ).toEqual([100, 100, 101]);
  expect(
    f.calls.some((call) => call.method === 'delete' && call.id === 51),
  ).toBe(false);
});

test('late voice status cleanup cannot delete a newer inline menu', async () => {
  const f = fixture(8010);
  const voice = f.context('voice');
  await panelReply(voice, 'Working', undefined, { navigation: false });
  const current = await panelReply(f.context(), 'New inline menu');
  expect(current).toMatchObject({ message_id: expect.any(Number) });
  expect(f.calls).toContainEqual({
    method: 'send',
    id: current && typeof current === 'object' ? current.message_id : undefined,
    text: 'New inline menu',
  });
  await removePanelMessage(voice, 100);
  expect(
    current &&
      typeof current === 'object' &&
      f.calls.some(
        (call) => call.method === 'delete' && call.id === current.message_id,
      ),
  ).toBe(false);
});
