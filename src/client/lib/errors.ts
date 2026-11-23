import { toast } from 'sonner';
import { errorMessage } from '@shared/errors';
import { ApiRequestError } from './api-error';

/** Mensaje en español para cualquier error (Worker, Supabase, red). */
export function messageOf(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return errorMessage(error);
}

export function toastError(error: unknown): void {
  toast.error(messageOf(error));
}
