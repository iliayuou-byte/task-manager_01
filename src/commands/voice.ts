import { transcribeVoice } from '../clients/ai.js';
import logger from '../core/logger.js';
import type { BotContext } from '../middlewares/session.js';
import {
  beginPanel,
  panelReply,
  removePanelMessage,
} from '../services/chatPanel.js';
import {
  MAX_VOICE_BYTES,
  MAX_VOICE_SECONDS,
  readVoiceBytes,
} from '../services/voiceDownload.js';
import { type VoiceStage, voiceError } from '../services/voiceError.js';
import { processAssistantInput } from './assistant.js';
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
  if (
    (process.env.VOICE_TRANSCRIPTION_PROVIDER ?? 'gemini') === 'gemini' &&
    process.env.AI_PROVIDER !== 'gemini'
  ) {
    return await panelReply(
      ctx,
      'Для голоса включи VOICE_TRANSCRIPTION_PROVIDER=local и установи Whisper. Пока можно добавить дела текстом.',
    );
  }
  let stage: VoiceStage = 'download';
  const assistantState = ctx.session?.assistant;
  let statusId: number | undefined;
  const clearStatus = async () => {
    if (statusId !== undefined) {
      await removePanelMessage(ctx, statusId);
      statusId = undefined;
    }
    beginPanel(ctx);
  };
  try {
    ctx.chatAction = 'typing';
    const status = await panelReply(ctx, '🎙️ Расшифровываю голосовое…');
    if (status && typeof status === 'object') statusId = status.message_id;
    const file = await ctx.api.getFile(voice.file_id);
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!file.file_path || !token) throw new Error('Voice file unavailable');
    const response = await fetch(
      `https://api.telegram.org/file/bot${token}/${file.file_path}`,
      { signal: AbortSignal.timeout(30_000) },
    );
    const audio = await readVoiceBytes(response);
    stage = 'transcribe';
    const transcript = await transcribeVoice(audio);
    await clearStatus();
    if (assistantState && ctx.session.assistant !== assistantState) return;
    if (!transcript)
      return await panelReply(
        ctx,
        'Не удалось разобрать речь. Голосовое осталось в чате. Можно переслать его повторно или написать дела текстом.',
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
    stage = 'tasks';
    if (assistantState) return await processAssistantInput(ctx, transcript);
    if (/(удал|убер|убра|исключ|delete|remove)/i.test(transcript)) {
      await removeByVoice(ctx, transcript);
    } else {
      await processBrainInput(ctx, transcript);
    }
  } catch (error) {
    await clearStatus();
    const failure = voiceError(error, stage);
    logger.warnWithContext({
      op: 'VOICE',
      message: failure.diagnostic,
      userId: ctx.from?.id,
    });
    await panelReply(ctx, failure.text);
  } finally {
    await clearStatus();
  }
};
