export const TASK_TAGS = {
  учёба: 'Classes, library, exams and studying',
  работа: 'Job tasks, clients and employer responsibilities',
  дом: 'Cleaning, laundry, rubbish and home maintenance',
  здоровье: 'Exercise, medical appointments, sleep and wellbeing',
  покупки: 'Buying products, groceries or equipment',
  документы: 'Forms, parcels, returns and administrative errands',
  финансы: 'Payments, budgets, bills and accounting',
  проекты: 'Personal product development or creative projects',
  личное: 'Personal plans, relationships and leisure',
} as const;

export const taskTagPrompt = () =>
  `\nAssign 1-2 relevant domain tags from this taxonomy: ${JSON.stringify(TASK_TAGS)}. Tags describe the domain, never importance or urgency. Do not invent labels. If unclear, use []. Preserve relevant explicit user hashtags without #. Do not attach all hashtags to every task in a list.`;

// Enforce the vocabulary; user-provided tags remain supported.
export const normalizeTaskTags = (
  proposed: readonly string[],
  explicit: readonly string[] = [],
) => {
  const allowed = new Set([...Object.keys(TASK_TAGS), ...explicit]);
  return [
    ...new Set(
      proposed
        .map((tag) => tag.replace(/^#/, '').trim())
        .filter((tag) => allowed.has(tag)),
    ),
  ].slice(0, 3);
};

export const displayTaskTags = (tags: readonly string[]) =>
  tags.length ? ` ${tags.map((tag) => `#${tag}`).join(' ')}` : '';
