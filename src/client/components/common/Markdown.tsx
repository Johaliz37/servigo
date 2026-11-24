import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import { cn } from '@client/lib/utils';

import { BLOCK_ELEMENTS } from './markdown-elements';

/**
 * Markdown escrito por la empresa, renderizado sin HTML crudo y sanitizado (rehype-sanitize).
 * Los enlaces externos abren en otra pestaña con `rel="noopener noreferrer"`.
 */
export function Markdown({
  children,
  allowed = BLOCK_ELEMENTS,
  className,
}: {
  children: string;
  allowed?: string[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        'space-y-3 text-sm leading-relaxed [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4',
        '[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
        '[&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold [&_h4]:font-medium',
        '[&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5',
        className,
      )}
    >
      <ReactMarkdown
        allowedElements={allowed}
        unwrapDisallowed
        skipHtml
        rehypePlugins={[rehypeSanitize]}
        components={{
          a: ({ href, children: text }) => {
            const external = !!href && /^https?:\/\//.test(href);
            return (
              <a href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                {text}
              </a>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
