import { type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';

import { sanitizeUrl } from '@/lib/sanitizeUrl';
import { cn } from '@/lib/utils';

interface InlineMarkdownProps {
  /** Raw markdown source. */
  children: string;
  className?: string;
}

/**
 * Elements kept when rendering markdown inline. Block-level constructs
 * (headings, lists, blockquotes, tables, code blocks, images, etc.) are
 * disallowed so the output stays on a single line and works with the
 * `truncate` utility. Disallowed elements are unwrapped — their text
 * children survive, only the wrapping tag is dropped — so a story that
 * begins with a heading or list still contributes readable text to the
 * preview instead of vanishing.
 */
const INLINE_ELEMENTS = [
  'p',
  'span',
  'strong',
  'em',
  'del',
  'a',
  'code',
  'br',
  'text',
];

/**
 * Component overrides that flatten inline markdown into a continuous text
 * flow. Paragraphs and line breaks collapse to plain spans/spaces so the
 * whole thing renders as one truncatable line, while emphasis, links, and
 * inline code keep their styling to match the detail page's prose.
 */
const components: Components = {
  // Paragraphs and breaks must not introduce block flow / newlines — the
  // preview is a single truncated line. Render paragraphs as spans and join
  // consecutive ones with a space.
  p: ({ children }: { children?: ReactNode }) => <span>{children} </span>,
  br: () => <span> </span>,
  strong: ({ children }: { children?: ReactNode }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }: { children?: ReactNode }) => <em>{children}</em>,
  del: ({ children }: { children?: ReactNode }) => <del>{children}</del>,
  code: ({ children }: { children?: ReactNode }) => (
    <code className="rounded bg-muted px-1 py-0.5 text-[0.85em] font-normal text-foreground">
      {children}
    </code>
  ),
  // Links render as styled text but are not clickable in the preview — the
  // whole card is a link, so a nested anchor would be invalid and steal the
  // click. Keep the label, drop the interactivity.
  a: ({ href, children }: { href?: string; children?: ReactNode }) => {
    const safe = sanitizeUrl(href);
    return <span className={safe ? 'text-primary' : undefined}>{children}</span>;
  },
};

/**
 * Renders a markdown string as a single line of inline-styled text.
 *
 * Honors the same inline markdown the campaign detail page does (bold,
 * italic, strikethrough, inline code, link labels) while dropping every
 * block-level element and image so the result stays on one line and can be
 * truncated by the caller. Output is sanitized via `rehype-sanitize`.
 *
 * The caller is responsible for truncation (e.g. a `truncate` or
 * `line-clamp-*` class on a wrapping element).
 */
export function InlineMarkdown({ children, className }: InlineMarkdownProps) {
  return (
    <span className={cn(className)}>
      <Markdown
        rehypePlugins={[rehypeSanitize]}
        allowedElements={INLINE_ELEMENTS}
        unwrapDisallowed
        components={components}
      >
        {children}
      </Markdown>
    </span>
  );
}
