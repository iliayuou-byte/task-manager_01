import { LocalVoiceError } from './localVoice.js';

export type VoiceStage = 'download' | 'transcribe' | 'tasks';

// Return only fixed diagnostic labels. Raw errors may contain credentials/URLs.
export const voiceError = (error: unknown, stage: VoiceStage) => {
  let record =
    typeof error === 'object' && error !== null
      ? (error as Record<string, unknown>)
      : {};
  // AI SDK retries wrap the final provider error. Inspect only bounded causes.
  for (let depth = 0; depth < 3; depth++) {
    const nested = record.lastError ?? record.cause;
    if (typeof nested !== 'object' || nested === null) break;
    record = nested as Record<string, unknown>;
  }
  const status =
    typeof record.statusCode === 'number' ? record.statusCode : undefined;
  const name = typeof record.name === 'string' ? record.name : '';
  const message = typeof record.message === 'string' ? record.message : '';
  let code = 'unknown';
  let reason = 'Причину сбоя нужно проверить в журнале бота.';
  const provider = process.env.AI_PROVIDER === 'openai' ? 'OpenAI' : 'Gemini';
  if (error instanceof LocalVoiceError) {
    code = `local_${error.code}`;
    reason = {
      setup:
        'Whisper не установлен или не найден Python. Выполни настройку локального голоса.',
      failed:
        'Локальное распознавание не сработало. Проверь установку модели и запись.',
      timeout:
        'Локальное распознавание заняло больше четырёх минут. Можно выбрать модель base.',
      busy: 'Сейчас расшифровываю другое ГС. Повтори после его завершения.',
    }[error.code];
  } else if (status === 429) {
    code = 'rate_limit';
    reason = `${provider} ограничил запросы: проверь квоту или повтори позже.`;
  } else if (status === 503 || /high demand|overloaded/i.test(message)) {
    code = 'overloaded';
    reason = `${provider} сейчас перегружен. Попробуй повторить позже.`;
  } else if (status === 401 || status === 403) {
    code = 'access_denied';
    reason = 'Сервис отклонил доступ. Нужно проверить ключ и его разрешения.';
  } else if (status === 404) {
    code = 'not_found';
    reason =
      stage === 'download'
        ? 'Telegram не отдал файл. Перешли это голосовое боту ещё раз.'
        : `Модель ${provider} недоступна. Нужно проверить AI_MODEL.`;
  } else if (/AbortError|TimeoutError/.test(name)) {
    code = 'timeout';
    reason = 'Сервис не ответил вовремя. Попробуй повторить позже.';
  }
  const step = {
    download: 'скачать голосовое из Telegram',
    transcribe: 'расшифровать голосовое',
    tasks: 'разобрать дела из расшифровки',
  }[stage];
  return {
    diagnostic: `stage=${stage} code=${code}${status ? ` status=${status}` : ''}`,
    text: `❌ Не удалось ${step}. ${reason}\n\nГолосовое сохранено в чате. Можно переслать его сюда повторно; записывать заново не нужно.`,
  };
};
