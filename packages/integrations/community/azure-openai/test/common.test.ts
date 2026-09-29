import {
  calculateMessagesTokenSize,
  exceedsHistoryLimit,
  reduceContextSize,
} from '../src/lib/common';

// The real call path (ask-gpt.ts) stores { role, content } objects and passes
// model '' — tiktoken rejects it, so the char-based fallback estimator runs.
// These tests drive the exact production shape instead of plain strings.
const MODEL = '';
const TOKENS_PER_CHAR = 0.25; // fallback: 4 chars ~ 1 token

function buildMessages(count: number, charsPerMessage: number) {
  return Array.from({ length: count }, (_, index) => ({
    role: index === 0 ? 'system' : index % 2 === 1 ? 'user' : 'assistant',
    content: `${index}-`.padEnd(charsPerMessage, 'x'),
  }));
}

describe('calculateMessagesTokenSize (production shape)', () => {
  it('counts tokens from message content, not the object shape', async () => {
    const messages = buildMessages(3, 40);
    const tokens = await calculateMessagesTokenSize(messages, MODEL);
    // 3 messages x 40 chars x 0.25 tokens/char = 30 tokens
    expect(tokens).toBe(3 * 40 * TOKENS_PER_CHAR);
  });

  it('returns a finite number, never NaN', async () => {
    const messages = buildMessages(5, 100);
    const tokens = await calculateMessagesTokenSize(messages, MODEL);
    expect(Number.isFinite(tokens)).toBe(true);
  });
});

describe('reduceContextSize (production shape, issue #184)', () => {
  it('returns short histories unchanged without mutating the input', async () => {
    const messages = buildMessages(4, 40);
    const snapshot = JSON.parse(JSON.stringify(messages));
    const result = await reduceContextSize(messages, MODEL, 1000);
    expect(result).toEqual(messages);
    expect(messages).toEqual(snapshot);
  });

  it('reduces long histories until they fit maxTokens / 1.5', async () => {
    const messages = buildMessages(20, 40); // 20 x 10 tokens = 200 tokens
    const maxTokens = 100; // budget 66.6 tokens
    const result = await reduceContextSize(messages, MODEL, maxTokens);
    expect(result.length).toBeLessThan(messages.length);
    const tokens = await calculateMessagesTokenSize(result, MODEL);
    expect(tokens).toBeLessThanOrEqual(maxTokens / 1.5);
  });

  it('keeps cutting while a single cutoff is not enough (regression: discarded recursion)', async () => {
    const messages = buildMessages(100, 40); // 1000 tokens total
    const maxTokens = 100; // budget 66.6 tokens
    const result = await reduceContextSize(messages, MODEL, maxTokens);
    const tokens = await calculateMessagesTokenSize(result, MODEL);
    expect(tokens).toBeLessThanOrEqual(maxTokens / 1.5);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('preserves relative order of the surviving messages', async () => {
    const messages = buildMessages(50, 40);
    const result = await reduceContextSize(messages, MODEL, 100);
    const firstContent = result[0].content;
    const allContents = messages.map((m) => m.content);
    expect(allContents).toContain(firstContent);
    // survivors must be a contiguous tail of the original history
    const firstIndex = allContents.indexOf(firstContent);
    expect(result.map((m) => m.content)).toEqual(
      allContents.slice(firstIndex),
    );
  });
});

describe('exceedsHistoryLimit (guard fires on production shape)', () => {
  it('triggers when the object-shaped history exceeds the budget', async () => {
    const messages = buildMessages(20, 100); // 500 tokens
    const tokenLength = await calculateMessagesTokenSize(messages, MODEL);
    // modelTokenLimit('') = 2048 default, maxTokens 100 -> (2048-100)/1.1 ~ 1770
    expect(tokenLength).toBeGreaterThan(0);
    expect(Number.isFinite(tokenLength)).toBe(true);
    // 500 < 1770 so limit not exceeded here — assert the comparison is real
    expect(exceedsHistoryLimit(tokenLength, MODEL, 100)).toBe(false);
    // now exceed it: 2000 tokens
    const big = buildMessages(80, 100); // 2000 tokens
    const bigTokens = await calculateMessagesTokenSize(big, MODEL);
    expect(exceedsHistoryLimit(bigTokens, MODEL, 100)).toBe(true);
  });

  it('roles tokens count toward the guard: history that fits alone fails with a large system prompt (#342)', async () => {
    // history alone is under the limit
    const history = buildMessages(20, 100); // 500 tokens
    const historyTokens = await calculateMessagesTokenSize(history, MODEL);
    expect(exceedsHistoryLimit(historyTokens, MODEL, 100)).toBe(false);

    // roles/system tokens ride on every request; combined size trips the guard
    const roles = buildMessages(60, 100); // 1500 tokens
    const rolesTokens = await calculateMessagesTokenSize(roles, MODEL);
    expect(exceedsHistoryLimit(historyTokens + rolesTokens, MODEL, 100)).toBe(true);
  });
});
