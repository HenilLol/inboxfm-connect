import { calculateMessagesTokenSize, reduceContextSize } from '../src/lib/common/common'

// Unknown models fall back to ~1 token per 4 chars, which keeps these tests
// deterministic without depending on tiktoken encodings.
const UNKNOWN_MODEL = 'test-unknown-model'

function buildMessages(count: number, charsPerMessage: number) {
  return Array.from({ length: count }, (_, index) => ({
    role: index === 0 ? 'system' : 'user',
    content: `${index}-`.padEnd(charsPerMessage, 'x'),
  }))
}

describe('reduceContextSize (issue #184)', () => {
  it('returns short histories unchanged', async () => {
    const messages = buildMessages(4, 40)
    const result = await reduceContextSize(messages, UNKNOWN_MODEL, 1000)
    expect(result).toEqual(messages)
  })

  it('reduces long histories until they fit maxTokens / 1.5', async () => {
    const messages = buildMessages(20, 40)
    const maxTokens = 100
    const result = await reduceContextSize(messages, UNKNOWN_MODEL, maxTokens)
    expect(result.length).toBeLessThan(messages.length)
    const tokens = await calculateMessagesTokenSize(result, UNKNOWN_MODEL)
    expect(tokens).toBeLessThanOrEqual(maxTokens / 1.5)
  })

  it('keeps cutting while a single cutoff is not enough (discarded recursion regression)', async () => {
    const messages = buildMessages(100, 40)
    const maxTokens = 100
    const result = await reduceContextSize(messages, UNKNOWN_MODEL, maxTokens)
    const tokens = await calculateMessagesTokenSize(result, UNKNOWN_MODEL)
    expect(tokens).toBeLessThanOrEqual(maxTokens / 1.5)
  })

  it('does not mutate the input array', async () => {
    const messages = buildMessages(20, 40)
    const snapshot = JSON.parse(JSON.stringify(messages))
    await reduceContextSize(messages, UNKNOWN_MODEL, 100)
    expect(messages).toEqual(snapshot)
  })
})
