import { supabase } from '@/lib/supabase'

/**
 * Wraps supabase.functions.invoke so that non-2xx responses surface the
 * function's `{ error: "..." }` body instead of the generic
 * "Edge Function returned a non-2xx status code".
 */
export async function invokeFn<T = unknown>(name: string, body?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    const ctx = (error as unknown as { context?: Response }).context
    if (ctx && typeof ctx.text === 'function') {
      try {
        const text = await ctx.clone().text()
        if (text) {
          try {
            const parsed = JSON.parse(text) as { error?: string; message?: string }
            const msg = parsed.error ?? parsed.message
            if (msg) throw new Error(msg)
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== 'Unexpected end of JSON input') {
              throw parseErr
            }
            throw new Error(text.slice(0, 500))
          }
        }
      } catch (e) {
        if (e instanceof Error) throw e
      }
    }
    throw error
  }
  if (data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)) {
    const msg = (data as { error?: string }).error
    if (msg) throw new Error(msg)
  }
  return data as T
}
