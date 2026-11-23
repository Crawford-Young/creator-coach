import { logger } from '@/lib/logger'

/**
 * The one seam for unexpected errors that are handled (reported, then skipped)
 * rather than thrown. Today it logs at `error` through Pino: on Cloud Run that
 * JSON lands in Cloud Logging, and Error Reporting picks up entries that carry
 * a stack. When the GCP migration picks a reporting client, wire it in here and
 * every call site follows.
 */
export function reportError(error: unknown): void {
  const message = error instanceof Error ? error.message : 'Unexpected non-Error value'
  logger.error({ err: error }, message)
}
