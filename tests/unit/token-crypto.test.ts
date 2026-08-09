import { describe, it, expect, vi } from 'vitest'

const TEST_KEY = Buffer.alloc(32, 7).toString('base64')
vi.mock('@/env', () => ({ env: { TOKEN_ENC_KEY: Buffer.alloc(32, 7).toString('base64') } }))

import { encryptToken, decryptToken, isEncrypted, ENCRYPTION_PREFIX } from '@/lib/token-crypto'

describe('token-crypto', () => {
  it('round-trips a token', () => {
    const stored = encryptToken('ya29.secret-token')
    expect(stored.startsWith(ENCRYPTION_PREFIX)).toBe(true)
    expect(stored).not.toContain('ya29.secret-token')
    expect(decryptToken(stored)).toBe('ya29.secret-token')
  })

  it('produces distinct ciphertexts per call (random IV)', () => {
    expect(encryptToken('same')).not.toBe(encryptToken('same'))
  })

  it('passes legacy plaintext through decrypt unchanged', () => {
    expect(decryptToken('plain-legacy-token')).toBe('plain-legacy-token')
  })

  it('throws on tampered ciphertext', () => {
    const stored = encryptToken('secret')
    const parts = stored.split(':')
    parts[3] = Buffer.from('tampered-data!!!').toString('base64')
    expect(() => decryptToken(parts.join(':'))).toThrow()
  })

  it('throws on malformed encrypted token (missing parts)', () => {
    expect(() => decryptToken('v1:only-two:parts')).toThrow('Malformed encrypted token')
  })

  it('isEncrypted discriminates', () => {
    expect(isEncrypted(encryptToken('x'))).toBe(true)
    expect(isEncrypted('plain')).toBe(false)
  })

  it('TEST_KEY sanity: 32 bytes', () => {
    expect(Buffer.from(TEST_KEY, 'base64').length).toBe(32)
  })

  it('rejects a key of wrong length', async () => {
    vi.resetModules()
    vi.doMock('@/env', () => ({ env: { TOKEN_ENC_KEY: Buffer.alloc(16, 1).toString('base64') } }))
    const mod = await import('@/lib/token-crypto')
    expect(() => mod.encryptToken('x')).toThrow('TOKEN_ENC_KEY must decode to 32 bytes')
    vi.doUnmock('@/env')
    vi.resetModules()
  })
})
