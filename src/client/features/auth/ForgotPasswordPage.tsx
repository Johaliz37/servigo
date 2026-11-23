import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { z } from 'zod';
import { emailSchema } from '@shared/schemas';
import { Button } from '@client/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@client/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@client/components/ui/form';
import { Input } from '@client/components/ui/input';
import { messageOf } from '@client/lib/errors';
import { supabase } from '@client/lib/supabase';
import { useAuthArea } from './AuthLayout';

const schema = z.object({ email: emailSchema });

export function Component() {
  const area = useAuthArea();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  });

  async function submit({ email }: z.output<typeof schema>) {
    // El enlace vuelve al mismo subdominio: la sesión queda en el localStorage de esta empresa.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}${area}/nueva-contrasena`,
    });
    if (error) {
      form.setError('root', { message: messageOf(error) });
      return;
    }
    setSentTo(email);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recuperar contraseña</CardTitle>
        <CardDescription>
          {sentTo
            ? `Si ${sentTo} tiene una cuenta, te enviamos un enlace para crear una contraseña nueva.`
            : 'Te enviaremos un enlace para crear una contraseña nueva.'}
        </CardDescription>
      </CardHeader>
      {!sentTo && (
        <CardContent>
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
              {form.formState.errors.root && (
                <p role="alert" className="text-sm text-destructive">
                  {form.formState.errors.root.message}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Enviando…' : 'Enviar enlace'}
              </Button>
            </form>
          </Form>
        </CardContent>
      )}
      <CardFooter>
        <Link to={`${area}/login`} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          Volver a iniciar sesión
        </Link>
      </CardFooter>
    </Card>
  );
}
