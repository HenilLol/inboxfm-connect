import { describe, expect, it, vi } from 'vitest'
import { httpClient } from '@inboxfm-connect/pieces-common'
import { bexioCommonProps } from '../src/lib/common/props'

describe('bexioCommonProps', () => {
  it('returns disabled option with prompt when auth is missing', async () => {
    const accountProp = bexioCommonProps.account({
      displayName: 'Account',
      required: true,
    })

    const result = await (accountProp.options as any)({ auth: undefined })
    expect(result.disabled).toBe(true)
    expect(result.placeholder).toBe('Connect your Bexio account first')
    expect(result.options).toEqual([])
  })

  it('loads accounts successfully using v3 endpoint', async () => {
    vi.spyOn(httpClient, 'sendRequest').mockResolvedValueOnce({
      body: [
        { id: 1, account_no: '1000', name: 'Cash' },
        { id: 2, account_no: '1020', name: 'Bank' },
      ],
      headers: {},
      status: 200,
    })

    const accountProp = bexioCommonProps.account({
      displayName: 'Account',
      required: true,
    })

    const result = await (accountProp.options as any)({
      auth: { access_token: 'valid-token' },
    })

    expect(result.disabled).toBe(false)
    expect(result.options).toEqual([
      { label: '1000 - Cash', value: 1 },
      { label: '1020 - Bank', value: 2 },
    ])
  })

  it('handles account loading failure gracefully with informative placeholder', async () => {
    vi.spyOn(httpClient, 'sendRequest').mockRejectedValueOnce(new Error('Network error'))

    const accountProp = bexioCommonProps.account({
      displayName: 'Account',
      required: true,
    })

    const result = await (accountProp.options as any)({
      auth: { access_token: 'valid-token' },
    })

    expect(result.disabled).toBe(true)
    expect(result.placeholder).toContain('Failed to load accounts')
    expect(result.options).toEqual([])
  })

  it('loads taxes successfully using v3 endpoint', async () => {
    vi.spyOn(httpClient, 'sendRequest').mockResolvedValueOnce({
      body: [
        { id: 10, name: 'Standard VAT', percentage: 7.7 },
      ],
      headers: {},
      status: 200,
    })

    const result = await (bexioCommonProps.tax.options as any)({
      auth: { access_token: 'valid-token' },
    })

    expect(result.disabled).toBe(false)
    expect(result.options).toEqual([
      { label: 'Standard VAT (7.7%)', value: 10 },
    ])
  })

  it('loads currencies successfully using v3 endpoint', async () => {
    vi.spyOn(httpClient, 'sendRequest').mockResolvedValueOnce({
      body: [
        { id: 1, name: 'CHF' },
        { id: 2, name: 'EUR' },
      ],
      headers: {},
      status: 200,
    })

    const currencyProp = bexioCommonProps.currency({
      displayName: 'Currency',
      required: true,
    })

    const result = await (currencyProp.options as any)({
      auth: { access_token: 'valid-token' },
    })

    expect(result.disabled).toBe(false)
    expect(result.options).toEqual([
      { label: 'CHF', value: 1 },
      { label: 'EUR', value: 2 },
    ])
  })
})
