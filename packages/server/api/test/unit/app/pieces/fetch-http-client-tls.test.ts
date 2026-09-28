import { describe, expect, it, vi } from 'vitest'
import { FetchHttpClient, HttpMethod } from '@inboxfm-connect/pieces-common'

describe('FetchHttpClient TLS Security (#162)', () => {
  it('does not set or mutate process.env.NODE_TLS_REJECT_UNAUTHORIZED when making requests', async () => {
    delete process.env['NODE_TLS_REJECT_UNAUTHORIZED']

    // Mock global fetch to avoid real network call
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', mockFetch)

    const client = new FetchHttpClient('https://api.example.com')
    const response = await client.sendRequest({
      method: HttpMethod.GET,
      url: '/test',
    })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ ok: true })
    expect(process.env['NODE_TLS_REJECT_UNAUTHORIZED']).toBeUndefined()

    vi.unstubAllGlobals()
  })
})
