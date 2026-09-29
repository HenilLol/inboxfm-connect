import fs from 'node:fs'
import path from 'node:path'
import { PropertyType } from '@inboxfm-connect/pieces-framework'
import { createProductAction } from '../src/lib/actions/create-product'
import { createTimeTrackingAction } from '../src/lib/actions/create-time-tracking'
import { updateProductAction } from '../src/lib/actions/update-product'

const ACTIONS_DIR = path.resolve(__dirname, '../src/lib/actions')

function readActionSource(fileName: string): string {
  return fs.readFileSync(path.join(ACTIONS_DIR, fileName), 'utf-8')
}

describe('bexio dropdown failure visibility (issue #185)', () => {
  it.each([
    'create-time-tracking.ts',
    'create-product.ts',
    'update-product.ts',
  ])('does not swallow dropdown errors into empty lists in %s', (fileName) => {
    expect(readActionSource(fileName)).not.toContain('.catch(() => [])')
  })

  it('has no unconfirmed-endpoint TODOs left in the piece', () => {
    const files = fs.readdirSync(ACTIONS_DIR).filter((file) => file.endsWith('.ts'))
    for (const file of files) {
      expect(readActionSource(file)).not.toContain('Need to confirm endpoint')
    }
  })

  it('never calls the nonexistent article_group endpoint', () => {
    const files = fs.readdirSync(ACTIONS_DIR).filter((file) => file.endsWith('.ts'))
    for (const file of files) {
      expect(readActionSource(file)).not.toContain('/2.0/article_group')
    }
  })

  it('asks for the article group id directly since the API exposes no listing endpoint', () => {
    expect(createProductAction.props.article_group_id.type).toBe(PropertyType.NUMBER)
    expect(updateProductAction.props.article_group_id.type).toBe(PropertyType.NUMBER)
    expect(createTimeTrackingAction.props.status_id.type).toBe(PropertyType.DROPDOWN)
  })
})
