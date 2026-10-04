import { transcribeVoice } from '../clients/ai.js';
import logger from '../core/logger.js';
import type { BotContext } from '../middlewares/session.js';
import { panelReply } from '../services/chatPanel.js';
import {
  MAX_VOICE_BYTES,
  MAX_VOICE_SECONDS,
  readVoiceBytes,
} from '../services/voiceDownload.js';
import { processBrainInput } from './brain.js';
import { removeByVoice } from './removeSelected.js';

export const voiceMessage = async (ctx: BotContext) => {
  if (ctx.chat?.type !== 'private') {
    return await panelReply(
      ctx,
      'Отправляй голосовые с делами в личный чат с ботом.',
    );
  }
  const voice = ctx.message?.voice;
  if (!voice) return;
  if (
    voice.duration > MAX_VOICE_SECONDS ||
    (voice.file_size ?? 0) > MAX_VOICE_BYTES
  ) {
    return await panelReply(
      ctx,
      'Отправь ГС до 3 минут и 8 МБ. Длинный список можно разделить.',
    );
  }
  if (process.env.AI_PROVIDER !== 'gemini') {
    return await panelReply(
      ctx,
      'Голосовые пока работают с AI_PROVIDER=gemini. Можно добавить дела через /brain текстом.',
    );
  }
  try {
    ctx.chatAction = 'typing';
    await panelReply(ctx, '🎙️ Расшифровываю голосовое и разбираю дела…');
    const file = await ctx.api.getFile(voice.file_id);
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!file.file_path || !token) throw new Error('Voice file unavailable');
    const response = await fetch(
      `https://api.telegram.org/file/bot${token}/${file.file_path}`,
      { signal: AbortSignal.timeout(30_000) },
    );
    const transcript = await transcribeVoice(await readVoiceBytes(response));
    if (!transcript)
      return await panelReply(
        ctx,
        'Не удалось разобрать речь. Попробуй записать ещё раз или используй /brain.',
      );
    if (transcript.length > 6000)
      return await panelReply(
        ctx,
        'Получился слишком длинный текст. Раздели ГС на несколько сообщений.',
      );
    // Plain text, chunked to stay below Telegram's message limit.
    for (let offset = 0; offset < transcript.length; offset += 3000) {
      await panelReply(
        ctx,
        `📝 Расшифровка:\n${transcript.slice(offset, offset + 3000)}`,
      );
    }
    if (/(удал|убер|убра|исключ|delete|remove)/i.test(transcript)) {
      await removeByVoice(ctx, transcript);
    } else {
      await processBrainInput(ctx, transcript);
    }
  } catch {
    // Download errors can contain a Telegram token in their URL: never log them.
    logger.warnWithContext({
      op: 'VOICE',
      message: 'Voice processing failed',
      userId: ctx.from?.id,
    });
    await panelReply(
      ctx,
      '❌ Не удалось обработать ГС. Попробуй короткое сообщение или /brain текстом.',
    );
  }
};
