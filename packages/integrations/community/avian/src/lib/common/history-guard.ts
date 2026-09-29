// ---------------------------------------------------------------------------
// Stored-history token budget (issue #385)
//
// The piece already caps stored history by MESSAGE COUNT (50 here), but a
// count cap says nothing about payload size: 30 x 4000-token messages blow
// past every model window and the stored array keeps failing every later
// run. This guard trims oldest-first until the history also fits the token
// budget (~4 chars/token estimate, 32k default), in addition to the count cap.
export const HISTORY_TOKEN_BUDGET = 32000;

export const estimateTokens = (message: { content?: unknown }): number => {
  const text =
    typeof message?.content === 'string'
      ? message.content
      : JSON.stringify(message?.content ?? '');
  return Math.max(1, Math.round(text.length / 4));
};

export const estimateHistoryTokens = (messages: unknown[]): number =>
  messages.reduce<number>(
    (total: number, message: unknown) => total + estimateTokens(message as { content?: unknown }),
    0
  );

export const trimHistoryToBudget = <T>(
  messages: T[],
  budget: number = HISTORY_TOKEN_BUDGET
): T[] => {
  let current = [...messages];
  while (
    current.length > 1 &&
    estimateHistoryTokens(current as unknown[]) > budget
  ) {
    current = current.slice(Math.max(1, Math.round(current.length * 0.1)));
  }
  // Front-trimming can strand an assistant/model turn at the head; providers
  // that enforce user-first sequencing (OpenAI-compatible APIs) reject the
  // next request. Drop leading non-user turns so the head is a user turn
  // again — keep at least one message whatever happens (review #386).
  while (
    current.length > 1 &&
    (current[0] as { role?: unknown }).role !== 'user'
  ) {
    current = current.slice(1);
  }
  return current;
};
