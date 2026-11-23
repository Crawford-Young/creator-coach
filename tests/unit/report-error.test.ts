import { beforeEach, describe, expect, it, vi } from 'vitest'

const errorSpy = vi.fn()
vi.mock('@/lib/logger', () => ({ logger: { error: errorSpy } }))

const { reportError } = await import('@/lib/report-error')

describe('reportError', () => {
  beforeEach(() => errorSpy.mockClear())

  it('logs an Error with its message and the error itself', () => {
    const error = new Error('boom')
    reportError(error)
    expect(errorSpy).toHaveBeenCalledWith({ err: error }, 'boom')
  })

  it('logs a non-Error value with a fixed message', () => {
    reportError('oops')
    expect(errorSpy).toHaveBeenCalledWith({ err: 'oops' }, 'Unexpected non-Error value')
  })
})
