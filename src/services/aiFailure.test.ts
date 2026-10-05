import { expect, test } from 'bun:test';
import { aiFailure } from './aiFailure.js';

test('billing failures are never automatically retried', () => {
  expect(
    aiFailure({
      statusCode: 429,
      data: { error: { code: 'insufficient_quota' } },
    }).temporary,
  ).toBe(false);
  expect(
    aiFailure({
      lastError: {
        statusCode: 429,
        responseBody: '{"error":{"code":"credit_balance_exhausted"}}',
      },
    }).billing,
  ).toBe(true);
  expect(aiFailure({ statusCode: 401 }).temporary).toBe(false);
});

test('temporary failures respect the provider delay without exposing errors', () => {
  const result = aiFailure({
    statusCode: 503,
    responseHeaders: { 'retry-after': '125' },
    message: 'SECRET',
  });
  expect(result.temporary).toBe(true);
  expect(result.delay).toBe(125000);
  expect(JSON.stringify(result)).not.toContain('SECRET');
  expect(
    aiFailure({
      statusCode: 429,
      data: { error: { code: 'rate_limit_exceeded' } },
    }).temporary,
  ).toBe(true);
});
