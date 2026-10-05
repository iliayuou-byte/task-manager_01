export const aiFailure = (error: unknown) => {
  let value =
    typeof error === 'object' && error !== null
      ? (error as Record<string, unknown>)
      : {};
  for (let depth = 0; depth < 4; depth++) {
    const next = value.lastError ?? value.cause;
    if (!next || typeof next !== 'object') break;
    value = next as Record<string, unknown>;
  }
  let data = value.data;
  if (!data && typeof value.responseBody === 'string') {
    try {
      data = JSON.parse(value.responseBody);
    } catch {
      /* No raw diagnostics. */
    }
  }
  const detail =
    data && typeof data === 'object' && 'error' in data
      ? data.error
      : undefined;
  const code =
    detail && typeof detail === 'object' && 'code' in detail
      ? String(detail.code)
      : String(value.code ?? '');
  const status = Number(value.statusCode);
  const message = String(value.message ?? '');
  const billing =
    /quota|credit|billing|spend_limit|usage_limit/.test(code) ||
    /insufficient_quota|billing|exceeded your current quota|credit balance/i.test(
      message,
    );
  const temporary =
    !billing &&
    (status === 429 ||
      status === 503 ||
      status === 502 ||
      status === 504 ||
      /TimeoutError|AbortError/.test(String(value.name)));
  const headers = value.responseHeaders as Record<string, string> | undefined;
  const retryAfter = Number(headers?.['retry-after']);
  return {
    temporary,
    billing,
    delay:
      Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.max(30_000, retryAfter * 1000)
        : 60_000,
    reason: billing
      ? 'Проверь баланс и лимиты API.'
      : temporary
        ? 'ИИ временно недоступен.'
        : 'Проверь настройки API или журнал бота.',
  };
};

export const isSchemaFailure = (error: unknown) =>
  error instanceof Error &&
  /NoObjectGenerated|TypeValidation|ZodError/.test(error.name);
