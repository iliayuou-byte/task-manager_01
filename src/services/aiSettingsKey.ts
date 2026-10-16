import type { Metadata } from '../core/types.js';
export const eisenhowerSettingsKey = (metadata: Metadata): string =>
  JSON.stringify([
    metadata.ai_auto_priority,
    metadata.ai_priority_rules,
    metadata.timezone,
  ]);
