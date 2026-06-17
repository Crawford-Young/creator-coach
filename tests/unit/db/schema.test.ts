// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { creators } from '@/db/schema/creator'
import { users } from '@/db/schema/auth'

describe('schema', () => {
  it('creator has tenant columns', () => {
    expect(creators.userId).toBeDefined()
    expect(creators.timezone).toBeDefined()
  })
  it('auth has users', () => {
    expect(users.id).toBeDefined()
  })
})
