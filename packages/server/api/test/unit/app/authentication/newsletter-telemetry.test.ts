import { describe, expect, it, vi } from 'vitest'
import { system } from '../../../../src/app/helper/system/system'
import { UserIdentity } from '@inboxfm-connect/shared'
import { authenticationUtils } from '../../../../src/app/authentication/authentication-utils'

describe('Newsletter Telemetry Security (#161)', () => {
  it('does not send outbound requests or leak user email to third-party endpoints', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    const log = system.globalLogger()

    const identity: UserIdentity = {
      id: 'ident_123',
      email: 'user@example.com',
      firstName: 'Test',
      lastName: 'User',
      trackEvents: false,
      newsLetter: false,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    }

    await authenticationUtils(log).saveNewsLetterSubscriber(identity)

    expect(mockFetch).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
