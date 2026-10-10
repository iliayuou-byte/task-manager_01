import { expect, test } from 'bun:test';
import { voiceError } from './voiceError.js';

test('voice diagnostics do not expose credentials from download errors', () => {
  const failure = voiceError(
    new Error('https://api.telegram.org/file/botSECRET/private.ogg'),
    'download',
  );
  expect(JSON.stringify(failure)).not.toContain('SECRET');
  expect(failure.diagnostic).toBe('stage=download code=unknown');
  expect(failure.text).toContain('скачать голосовое');
});

test('distinguishes overload, quota, access, model and timeouts', () => {
  for (const [statusCode, code] of [
    [503, 'overloaded'],
    [429, 'rate_limit'],
    [403, 'access_denied'],
    [404, 'not_found'],
  ] as const) {
    expect(voiceError({ statusCode }, 'transcribe').diagnostic).toContain(code);
  }
  expect(
    voiceError({ name: 'TimeoutError' }, 'transcribe').diagnostic,
  ).toContain('timeout');
  expect(voiceError({ statusCode: 404 }, 'download').text).toContain(
    'Telegram',
  );
  expect(voiceError({ statusCode: 404 }, 'transcribe').text).toContain(
    'AI_MODEL',
  );
});

test('extracts the final provider status from AI SDK retry errors', () => {
  const result = voiceError(
    { lastError: { statusCode: 503, message: 'SECRET' } },
    'transcribe',
  );
  expect(result.diagnostic).toContain('overloaded');
  expect(JSON.stringify(result)).not.toContain('SECRET');
});
