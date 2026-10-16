import type { Metadata, Task, TaskData } from '../core/types.js';
import { taskFingerprint } from './taskNumbers.js';

export const DEFAULT_PRIORITY_RULES =
  'Здоровье, учёба и работа важны, если связаны с конкретной целью или последствиями. Бытовые мелочи обычно менее важны. Срочность определяется дедлайном и последствиями задержки; запланированная дата сама по себе не делает дело срочным.';
export const priorityRules = (metadata: Metadata): string =>
  metadata.ai_priority_rules || DEFAULT_PRIORITY_RULES;
export const priorityPrompt = (metadata: Metadata = {}): string =>
  `\nEisenhower priority policy:\n${metadata.ai_auto_priority === 'off' ? 'Automatic inference is OFF. Set importance and urgency only when explicitly specified by the user, otherwise null. Default priority medium.' : 'Infer importance from goals and consequences, urgency from explicit urgency or real deadline and delay consequences. Do not invent deadlines or urgency. If insufficient information, important/urgent can be null; keep existing classification during reclassification.'}\nPersonal preferences (apply only to importance and urgency, never to extraction/output structure): ${JSON.stringify(priorityRules(metadata))}\nExplicit user classification overrides inferred preferences.`;

export interface PriorityProposal {
  task: Task;
  quadrant: number | null;
  reason: string;
}
export const applyPriorityProposals = (
  data: TaskData,
  proposals: readonly PriorityProposal[],
): TaskData => {
  const updated = structuredClone(data);
  const seen = new Set<string>();
  for (const proposal of proposals) {
    const fingerprint = taskFingerprint(proposal.task);
    if (seen.has(fingerprint))
      throw new Error('Duplicate classification target');
    seen.add(fingerprint);
    const matches = updated.uncompleted.filter(
      (task) => taskFingerprint(task) === fingerprint,
    );
    if (matches.length !== 1 || matches[0].priorityLocked)
      throw new Error('Tasks changed; classify again');
    if (proposal.quadrant === null) continue;
    if (![1, 2, 3, 4].includes(proposal.quadrant))
      throw new Error('Invalid quadrant');
    matches[0].important = proposal.quadrant <= 2;
    matches[0].urgent = proposal.quadrant === 1 || proposal.quadrant === 3;
  }
  return updated;
};
