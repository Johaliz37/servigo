import { toast } from 'sonner';
import { messageOf } from './messages';

export { messageOf };

export function toastError(error: unknown): void {
  toast.error(messageOf(error));
}
