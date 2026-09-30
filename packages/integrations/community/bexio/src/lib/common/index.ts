import { HttpError } from '@inboxfm-connect/pieces-common';

export const bexioCommon = {
  baseUrl: 'https://api.bexio.com',
  api_version: '3.0',
};

export function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpError) {
    const body = error.response?.body;
    if (typeof body === 'object' && body !== null) {
      const msg =
        (body as Record<string, unknown>).message ||
        (body as Record<string, unknown>).error;
      if (typeof msg === 'string' && msg.trim()) {
        return msg.trim();
      }
    } else if (typeof body === 'string' && body.trim()) {
      return body.trim();
    }
    if (error.response?.status) {
      return `HTTP ${error.response.status}`;
    }
  }

  if (error && typeof error === 'object') {
    const errObj = error as Record<string, unknown>;
    const resp = errObj['response'] as Record<string, unknown> | undefined;
    if (resp && typeof resp === 'object') {
      const data = resp['data'] || resp['body'];
      if (typeof data === 'object' && data !== null) {
        const msg =
          (data as Record<string, unknown>).message ||
          (data as Record<string, unknown>).error;
        if (typeof msg === 'string' && msg.trim()) {
          return msg.trim();
        }
      } else if (typeof data === 'string' && data.trim()) {
        return data.trim();
      }
      if (resp['status']) {
        return `HTTP ${resp['status']}`;
      }
    }
  }

  if (error instanceof Error) {
    if (error.message.startsWith('{') && error.message.includes('"response"')) {
      try {
        const parsed = JSON.parse(error.message);
        const body = parsed?.response?.body || parsed?.response?.data;
        if (typeof body === 'object' && body !== null) {
          const msg = body.message || body.error;
          if (typeof msg === 'string' && msg.trim()) {
            return msg.trim();
          }
        } else if (typeof body === 'string' && body.trim()) {
          return body.trim();
        }
        if (parsed?.response?.status) {
          return `HTTP ${parsed.response.status}`;
        }
      } catch {
        // Fall back to original message
      }
    }
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  return fallback;
}
