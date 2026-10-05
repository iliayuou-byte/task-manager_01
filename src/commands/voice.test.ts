import { expect, spyOn, test } from 'bun:test';
import * as ai from '../clients/ai.js';
import type { BotContext } from '../middlewares/session.js';
import { voiceMessage } from './voice.js';

test('failed 56-second voice clears status, preserves recording and explains overload', async () => {
  const provider = process.env.AI_PROVIDER;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  process.env.AI_PROVIDER = 'gemini';
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  const fetchMock = spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(new Uint8Array([1, 2, 3])),
  );
  const transcription = spyOn(ai, 'transcribeVoice').mockRejectedValue({
    lastError: { statusCode: 503 },
  });
  const texts: string[] = [];
  const deleted: number[] = [];
  let id = 100;
  const ctx = {
    chat: { id: 8201, type: 'private' },
    from: { id: 8201 },
    message: { message_id: 51, voice: { file_id: 'voice', duration: 56 } },
    api: {
      getFile: async () => ({ file_path: 'voice.ogg' }),
      deleteMessage: async (_chat: number, message: number) => {
        deleted.push(message);
        return true;
      },
    },
    reply: async (text: string) => {
      texts.push(text);
      return { message_id: id++ };
    },
  } as unknown as BotContext;
  try {
    await voiceMessage(ctx);
    expect(transcription).toHaveBeenCalledTimes(1);
    expect(deleted).toEqual([100]);
    expect(texts[texts.length - 1]).toContain('перегружен');
    expect(texts[texts.length - 1]).not.toContain('короткое');
    expect(texts[texts.length - 1]).toContain('записывать заново не нужно');
  } finally {
    fetchMock.mockRestore();
    transcription.mockRestore();
    if (provider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = provider;
    if (token === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = token;
  }
});
