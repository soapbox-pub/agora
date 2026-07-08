import { Children, createElement, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import type { NostrEvent } from '@nostrify/nostrify';

import { NoteContent } from '@/components/NoteContent';
import { isCampaignNaddr } from '@/lib/campaign';
import { rewriteAgoraLinksToNostrUris } from '@/lib/appUrls';
import { sanitizeUrl } from '@/lib/sanitizeUrl';
import { cn } from '@/lib/utils';

/** Gets a tag value by name. */
function getTag(tags: string[][], name: string): string | undefined {
  return tags.find(([n]) => n === name)?.[1];
}

interface ArticleContentProps {
  event: NostrEvent;
  /** If true, show a truncated preview instead of the full article. */
  preview?: boolean;
  className?: string;
}

/** Options controlling how text leaves are enriched inside a particular markdown tag. */
interface EnrichOptions {
  /** When true, `nostr:nevent/note/naddr` URIs render as inline links (not block-level quote cards),
   *  and media embeds (images/video/audio) are suppressed. Used for headings and other tight contexts. */
  inlineOnly?: boolean;
}

/**
 * Recursively walk markdown children, replacing each string leaf with a
 * `<NoteContent as="span">` instance so Nostr URIs, URLs, hashtags, and
 * custom emoji render with identical behavior to regular note content
 * (mentions, quoted-note cards, link-preview cards, images, custom emoji).
 *
 * The synthetic event clones the article's own tags so NIP-30 emoji,
 * imeta metadata, and q-tag relay hints resolve correctly for each run.
 */
function enrichChildren(
  children: ReactNode,
  event: NostrEvent,
  opts: EnrichOptions = {},
): ReactNode {
  return Children.map(children, (child, i) => {
    if (typeof child === 'string') {
      const synthetic: NostrEvent = { ...event, content: child };
      return (
        <NoteContent
          key={i}
          event={synthetic}
          as="span"
          disableNoteEmbeds={opts.inlineOnly}
          disableMediaEmbeds={opts.inlineOnly}
        />
      );
    }
    return child;
  });
}

/** Build react-markdown component overrides for this article's event. */
function buildComponents(event: NostrEvent): Components {
  // Wrap a text-bearing block/inline element so its string leaves are enriched.
  // Uses `createElement` to sidestep TS widening issues when spreading
  // unknown rehype-passed props onto a generic intrinsic tag.
  function wrap(Tag: keyof React.JSX.IntrinsicElements, opts: EnrichOptions = {}) {
    return function Wrapped(
      props: { children?: ReactNode } & Record<string, unknown>,
    ) {
      const { children, node: _node, ...rest } = props;
      return createElement(Tag, rest, enrichChildren(children, event, opts));
    };
  }

  return {
    // Paragraphs render as `<div>` so block-level embeds (quoted notes,
    // images, link-preview cards) inside them produce valid HTML.
    // Reproduce prose-sm paragraph spacing with utility classes.
    p: ({ children, node: _node, ...rest }: { children?: ReactNode } & Record<string, unknown>) =>
      createElement(
        'div',
        {
          ...rest,
          className: cn('my-[1em] first:mt-0 last:mb-0', rest.className as string | undefined),
        },
        enrichChildren(children, event),
      ),
    li: wrap('li'),
    // Headings: keep inline linkification (mentions, hashtags, URL links)
    // but suppress block embeds so a heading can't contain a giant quote card.
    h1: wrap('h1', { inlineOnly: true }),
    h2: wrap('h2', { inlineOnly: true }),
    h3: wrap('h3', { inlineOnly: true }),
    h4: wrap('h4', { inlineOnly: true }),
    h5: wrap('h5', { inlineOnly: true }),
    h6: wrap('h6', { inlineOnly: true }),
    strong: wrap('strong'),
    em: wrap('em'),
    blockquote: wrap('blockquote'),
    td: wrap('td'),
    th: wrap('th'),
    a: ({ href, children, node: _node, ...rest }) => {
      const safe = sanitizeUrl(href);
      if (!safe) {
        // Unsafe href — render label as plain text so we don't emit a dead/dangerous link.
        return <span>{children}</span>;
      }
      return (
        <a
          {...rest}
          href={safe}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'text-primary no-underline hover:underline break-all',
            rest.className as string | undefined,
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </a>
      );
    },
    img: ({ src, alt, node: _node, ...rest }) => {
      const safe = typeof src === 'string' ? sanitizeUrl(src) : undefined;
      if (!safe) return null;
      return <img {...rest} src={safe} alt={alt ?? ''} loading="lazy" />;
    },
  } as Components;
}

/**
 * Merge consecutive campaign-only paragraphs into a single paragraph so the
 * downstream {@link NoteContent} renderer can group them into a side-by-side
 * campaign row.
 *
 * Markdown splits blank-line-separated blocks into separate paragraphs, and
 * each paragraph is enriched by its own `NoteContent` instance — so two
 * campaign `nostr:naddr` URIs written on separate lines never reach a single
 * `NoteContent` and can't be grouped. Here we detect runs of paragraphs that
 * consist solely of campaign `nostr:naddr` URIs (one per line, blank lines
 * between) and collapse each run into one paragraph with single-newline
 * separators. NoteContent then sees all of them at once and lays them out as
 * a grid.
 *
 * Non-campaign content is left byte-for-byte untouched.
 */
function collapseCampaignParagraphs(markdown: string): string {
  // Split into blank-line-delimited blocks, preserving the exact separators
  // so non-campaign blocks reassemble unchanged.
  const parts = markdown.split(/(\n[ \t]*\n)/);

  // A block "is a campaign paragraph" when every non-blank line in it is a
  // single campaign naddr URI (after Agora-link rewriting) and it has ≥1 such
  // line. This tolerates a campaign written across soft-wrapped lines.
  const isCampaignBlock = (block: string): boolean => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return false;
    return lines.every((line) => isCampaignNaddr(line));
  };

  // Walk the parts (blocks interleaved with separators), grouping adjacent
  // campaign blocks (whose separators are blank-line-only) into one block.
  const out: string[] = [];
  let i = 0;
  while (i < parts.length) {
    const block = parts[i];
    if (i % 2 === 0 && isCampaignBlock(block)) {
      // Start of a potential campaign run. Gather following campaign blocks
      // as long as they're separated by blank lines only.
      const campaignLines: string[] = block.split('\n').map((l) => l.trim()).filter(Boolean);
      let j = i + 1;
      while (j + 1 < parts.length && isCampaignBlock(parts[j + 1])) {
        campaignLines.push(...parts[j + 1].split('\n').map((l) => l.trim()).filter(Boolean));
        j += 2;
      }
      // Join the collected campaign URIs with single newlines so they land in
      // one markdown paragraph → one NoteContent → one grouped row.
      out.push(campaignLines.join('\n'));
      // If more content follows, re-insert the trailing blank-line separator
      // so the merged campaign block stays its own paragraph and doesn't
      // fuse with the next block.
      if (j < parts.length) {
        out.push(parts[j]);
      }
      i = j + 1;
    } else {
      out.push(block);
      i++;
    }
  }

  return out.join('');
}

/** Renders kind 30023 long-form article content with Markdown. */
export function ArticleContent({ event, preview, className }: ArticleContentProps) {
  const title = getTag(event.tags, 'title');
  const summary = getTag(event.tags, 'summary');
  const image = getTag(event.tags, 'image');
  const hashtags = event.tags.filter(([n]) => n === 't').map(([, v]) => v);

  if (preview) {
    return (
      <div className={className}>
        {title && (
          <h3 dir="auto" className="text-base font-bold leading-snug">{title}</h3>
        )}
        {image && (
          <img
            src={image}
            alt={title ?? 'Article image'}
            className="w-full rounded-lg object-cover max-h-64 mt-2"
          />
        )}
        {summary ? (
          <p dir="auto" className="text-[15px] leading-relaxed line-clamp-3 mt-2">{summary}</p>
        ) : (
          <p dir="auto" className="text-[15px] leading-relaxed line-clamp-3 mt-2">
            {event.content.slice(0, 280)}{event.content.length > 280 ? '...' : ''}
          </p>
        )}
        <span className="inline-block text-xs font-medium text-primary mt-2">Read article</span>
      </div>
    );
  }

  const components = buildComponents(event);
  // Rewrite Agora app links to nostr: URIs, then merge consecutive
  // campaign-only paragraphs so the campaign row renders side-by-side.
  const processedContent = collapseCampaignParagraphs(
    rewriteAgoraLinksToNostrUris(event.content),
  );

  return (
    <div className={className}>
      {title && (
        <h1 dir="auto" className="text-2xl font-bold leading-tight mb-4">{title}</h1>
      )}
      {image && (
        <img
          src={image}
          alt={title ?? 'Article image'}
          className="w-full rounded-xl object-cover max-h-96 mb-6"
        />
      )}
      <div dir="auto" className="prose prose-sm max-w-none break-words text-foreground prose-headings:text-foreground prose-headings:font-bold prose-strong:text-foreground prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-img:rounded-lg prose-pre:overflow-x-auto prose-pre:rounded-lg prose-pre:bg-muted prose-pre:text-foreground prose-code:text-[13px] prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none prose-code:bg-muted prose-code:rounded prose-code:px-1.5 prose-code:py-0.5 prose-code:font-normal prose-li:marker:text-muted-foreground prose-blockquote:text-muted-foreground prose-blockquote:border-border prose-hr:border-border prose-th:text-foreground">
        <Markdown rehypePlugins={[rehypeSanitize]} components={components}>
          {processedContent}
        </Markdown>
      </div>
      {hashtags.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-6 pt-4 border-t border-border">
          {hashtags.map((tag) => (
            <a
              key={tag}
              href={`/t/${encodeURIComponent(tag)}`}
              className="text-sm text-primary hover:underline"
            >
              #{tag}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
