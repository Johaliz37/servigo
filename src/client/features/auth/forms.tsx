import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import type { z } from 'zod';
import { loginSchema, newPasswordSchema } from '@shared/schemas';
import { Button } from '@client/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@client/components/ui/form';
import { Input } from '@client/components/ui/input';
import { messageOf } from '@client/lib/errors';
import { supabase } from '@client/lib/supabase';
import type { AuthArea } from './AuthLayout';

/** Email + contraseña. `onSuccess` decide a dónde ir. */
export function LoginForm({
  area,
  defaultEmail = '',
  onSuccess,
}: {
  area: AuthArea;
  defaultEmail?: string;
  onSuccess: () => void;
}) {
  const form = useForm<z.input<typeof loginSchema>, unknown, z.output<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: defaultEmail, password: '' },
  });

  async function submit(values: z.output<typeof loginSchema>) {
    const { error } = await supabase.auth.signInWithPassword(values);
    if (error) {
      form.setError('root', { message: messageOf(error) });
      return;
    }
    onSuccess();
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate>
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Correo</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="email" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between">
                <FormLabel>Contraseña</FormLabel>
                <Link
                  to={`${area}/recuperar`}
                  className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                >
                  ¿La olvidaste?
                </Link>
              </div>
              <FormControl>
                <Input type="password" autoComplete="current-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {form.formState.errors.root && (
          <p role="alert" className="text-sm text-destructive">
            {form.formState.errors.root.message}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Entrando…' : 'Entrar'}
        </Button>
      </form>
    </Form>
  );
}

/** Contraseña nueva (recuperación, invitación o cambio desde "Mi cuenta"). */
export function NewPasswordForm({
  submitLabel = 'Guardar contraseña',
  onSuccess,
}: {
  submitLabel?: string;
  onSuccess: () => void;
}) {
  const form = useForm<z.input<typeof newPasswordSchema>, unknown, z.output<typeof newPasswordSchema>>({
    resolver: zodResolver(newPasswordSchema),
    defaultValues: { password: '', confirm: '' },
  });

  async function submit({ password }: z.output<typeof newPasswordSchema>) {
    const { error } = await supabase.auth.updateUser({ password, data: { password_set: true } });
    if (error) {
      form.setError('root', { message: messageOf(error) });
      return;
    }
    form.reset();
    onSuccess();
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate>
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Contraseña nueva</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="confirm"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Repite la contraseña</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {form.formState.errors.root && (
          <p role="alert" className="text-sm text-destructive">
            {form.formState.errors.root.message}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Guardando…' : submitLabel}
        </Button>
      </form>
    </Form>
  );
}
