import { encoding_for_model } from 'tiktoken';

export const calculateTokensFromString = (string: string, model: string) => {
  try {
    const encoder = encoding_for_model(model as any);
    const tokens = encoder.encode(string);
    encoder.free();

    return tokens.length;
  } catch (e) {
    // Model not supported by tiktoken, every 4 chars is a token
    return Math.round(string.length / 4);
  }
};

// The stored chat history holds { role, content } message objects (see ask-gpt.ts),
// not plain strings, so the estimator must read the message content. Estimating
// the whole object (e.g. via String(message).length) silently returns NaN and
// disables the context guard entirely.
export const calculateMessagesTokenSize = async (
  messages: { role: string; content: string }[],
  model: string
) => {
  let tokenLength = 0;
  for (const message of messages) {
    tokenLength += calculateTokensFromString(message.content, model);
  }

  return tokenLength;
};

export const reduceContextSize = async (
  messages: { role: string; content: string }[],
  model: string,
  maxTokens: number,
  // Roles/system messages ride along on every request but are not part of the
  // history being reduced; subtract their tokens from the budget so what
  // remains actually fits alongside the system prompt (review #342, item 2).
  rolesTokenLength = 0
) => {
  // TODO: Summarize context instead of cutoff
  // Cut from the front (oldest first) without mutating the caller's array, and
  // keep cutting while the remaining history still exceeds the budget.
  let currentMessages = [...messages];
  while (
    currentMessages.length > 1 &&
    (await calculateMessagesTokenSize(currentMessages, model)) >
      maxTokens / 1.5 - rolesTokenLength
  ) {
    const cutoffSize = Math.max(1, Math.round(currentMessages.length * 0.1));
    currentMessages = currentMessages.slice(cutoffSize);
  }

  return currentMessages;
};

export const exceedsHistoryLimit = (
  tokenLength: number,
  model: string,
  maxTokens: number
) => {
  if (
    tokenLength >= tokenLimit / 1.1 ||
    tokenLength >= (modelTokenLimit(model) - maxTokens) / 1.1
  ) {
    return true;
  }

  return false;
};

export const tokenLimit = 32000;

export const modelTokenLimit = (model: string) => {
  switch (model) {
    default:
      return 2048;
  }
};
