// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { db } from '@/db'

describe('db client', () => {
  it('exposes the drizzle query api', () => {
    expect(db).toBeDefined()
    expect(typeof db.select).toBe('function')
  })
})
