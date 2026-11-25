import { errorMessage } from '@shared/errors';
import { ApiRequestError } from './api-error';

/**
 * Mensaje en español para cualquier error (Worker, Supabase, red). Sin sonner: lo usan el
 * sitio público y `RouteError`, que no deben cargar la librería de toasts.
 */
export function messageOf(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return errorMessage(error);
}
