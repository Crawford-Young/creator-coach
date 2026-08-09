import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { env } from '@/env'

export const ENCRYPTION_PREFIX = 'v1:'
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH_BYTES = 12
const KEY_LENGTH_BYTES = 32

function encryptionKey(): Buffer {
  const key = Buffer.from(env.TOKEN_ENC_KEY, 'base64')
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(`TOKEN_ENC_KEY must decode to ${KEY_LENGTH_BYTES} bytes`)
  }
  return key
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTION_PREFIX)
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(IV_LENGTH_BYTES)
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${ENCRYPTION_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`
}

export function decryptToken(stored: string): string {
  if (!isEncrypted(stored)) return stored
  const parts = stored.split(':')
  const ivB64 = parts[1]
  const tagB64 = parts[2]
  const dataB64 = parts[3]
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed encrypted token')
  }
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}
