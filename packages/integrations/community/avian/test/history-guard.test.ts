import { describe, expect, it } from 'vitest';
import {
  HISTORY_TOKEN_BUDGET,
  estimateHistoryTokens,
  estimateTokens,
  trimHistoryToBudget,
} from '../src/lib/common/history-guard';

function buildMessages(count: number, charsPerMessage: number) {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `${index}-`.padEnd(charsPerMessage, 'x'),
  }));
}

describe('trimHistoryToBudget on top of the count cap (issue #385)', () => {
  it('keeps a small history unchanged without mutating the input', () => {
    const messages = buildMessages(5, 40);
    const snapshot = JSON.parse(JSON.stringify(messages));
    const result = trimHistoryToBudget(messages, 1000);
    expect(result).toEqual(messages);
    expect(messages).toEqual(snapshot);
  });

  it('trims under the count cap when messages are large', () => {
    // 30 messages x ~4000 tokens each: passes the 30-message count cap but
    // far exceeds the 32k budget.
    const messages = buildMessages(30, 16000);
    const result = trimHistoryToBudget(messages);
    expect(result.length).toBeLessThan(messages.length);
    expect(estimateHistoryTokens(result)).toBeLessThanOrEqual(HISTORY_TOKEN_BUDGET);
    // survivors are the newest messages (a contiguous tail)
    expect(result[result.length - 1]).toEqual(messages[messages.length - 1]);
  });

  it('keeps at least one message when a single entry exceeds the budget', () => {
    const messages = buildMessages(3, 100000);
    const result = trimHistoryToBudget(messages, 10);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('estimates string content at ~4 chars/token and never returns NaN', () => {
    expect(estimateTokens({ content: 'x'.repeat(400) })).toBe(100);
    expect(Number.isFinite(estimateTokens({ content: undefined }))).toBe(true);
  });
});
