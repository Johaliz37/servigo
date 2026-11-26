import { useId } from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@client/components/ui/chart';

/**
 * Serie temporal de una sola medida (reservas o ingresos). Una medida por gráfica: nunca dos
 * ejes. Línea de 2 px con relleno suave, cuadrícula discreta y tooltip con cruz.
 * Recharts solo se descarga con este componente (lazy).
 */
export default function TimeChart({
  data,
  label,
  format,
  formatTick,
  formatValue,
}: {
  data: { bucket: string; value: number }[];
  label: string;
  /** Etiqueta del eje X a partir de 'YYYY-MM-DD'. */
  format: (bucket: string) => string;
  formatTick?: (value: number) => string;
  formatValue: (value: number) => string;
}) {
  const id = `fill-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const config = { value: { label, color: 'var(--series-1)' } } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="aspect-auto h-56 w-full">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} accessibilityLayer>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-value)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--color-value)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis
          dataKey="bucket"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          tickFormatter={format}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={56}
          allowDecimals={false}
          tickFormatter={formatTick ?? ((v: number) => String(v))}
        />
        <ChartTooltip
          cursor={{ stroke: 'var(--muted-foreground)', strokeDasharray: '3 3' }}
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => format(String(payload[0]?.payload?.bucket ?? ''))}
              formatter={(value) => (
                <span className="flex w-full justify-between gap-4">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium text-foreground tabular-nums">{formatValue(Number(value))}</span>
                </span>
              )}
            />
          }
        />
        <Area
          dataKey="value"
          type="linear"
          stroke="var(--color-value)"
          strokeWidth={2}
          fill={`url(#${id})`}
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}
