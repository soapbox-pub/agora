import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NostrEvent } from '@nostrify/nostrify';

import { AutoGrowTextarea } from '@/components/ui/auto-grow-textarea';
import { ArticleContent } from '@/components/ArticleContent';
import { MentionAutocomplete } from '@/components/MentionAutocomplete';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useInsertText } from '@/hooks/useInsertText';
import { autoGrowTextarea } from '@/lib/autoGrowTextarea';
import { CAMPAIGN_KIND } from '@/lib/campaign';
import { cn } from '@/lib/utils';

interface CampaignStoryEditorProps {
  /** Current markdown story value. */
  value: string;
  /** Called with the new value on edit. */
  onValueChange: (value: string) => void;
  /** Textarea id (for label association). */
  id?: string;
  placeholder?: string;
  className?: string;
}

/**
 * Story editor for the campaign create/edit flow.
 *
 * Wraps the shared {@link AutoGrowTextarea} with the same authoring
 * affordances the note composer offers:
 *  - `@` autocomplete over people **and** campaigns (inserts `nostr:` URIs),
 *  - an Edit / Preview toggle above the field that renders the markdown
 *    story exactly as it will appear on the campaign page (via
 *    {@link ArticleContent}, including side-by-side campaign rows).
 *
 * The story is kind 33863 markdown, so the preview builds a synthetic
 * campaign event carrying only the content — banner/title/summary are shown
 * elsewhere in the wizard, so they're intentionally excluded here.
 */
export function CampaignStoryEditor({
  value,
  onValueChange,
  id = 'campaign-story',
  placeholder,
  className,
}: CampaignStoryEditorProps) {
  const { t } = useTranslation();
  const { user } = useCurrentUser();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const { insertAtCursor } = useInsertText(textareaRef, value, onValueChange);

  const handleInsertMention = insertAtCursor;

  const hasContent = value.trim().length > 0;

  // Synthetic kind 33863 event for the preview — content only, so the
  // markdown renderer (ArticleContent) lays it out identically to the live
  // campaign page, including the grouped side-by-side campaign row.
  const previewEvent = useMemo<NostrEvent>(
    () => ({
      id: 'campaign-story-preview',
      kind: CAMPAIGN_KIND,
      pubkey: user?.pubkey ?? '',
      created_at: Math.floor(Date.now() / 1000),
      content: value,
      tags: [],
      sig: '',
    }),
    [value, user?.pubkey],
  );

  const showPreview = previewMode && hasContent;

  // Grow the textarea to fit its content whenever the value changes and
  // whenever we return to edit mode. The shared AutoGrowTextarea only grows
  // on focus/change, so prefilled content (editing an existing campaign) or
  // programmatic inserts (autocomplete) would otherwise stay clamped at the
  // 200px minimum until the user manually focused the field.
  useEffect(() => {
    if (showPreview) return;
    const el = textareaRef.current;
    if (el) autoGrowTextarea(el);
  }, [value, showPreview]);

  const enterEdit = useCallback(() => setPreviewMode(false), []);
  const enterPreview = useCallback(() => setPreviewMode(true), []);

  return (
    <div className={cn(className)}>
      {/* Edit / Preview toggle — above the field so it never occludes input. */}
      {hasContent && (
        <div className="mb-2 flex justify-end">
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-border/60 bg-muted/70 p-1 shadow-sm backdrop-blur-sm">
            <button
              type="button"
              onClick={enterEdit}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-medium transition-all',
                !showPreview
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t('compose.preview.edit')}
            </button>
            <button
              type="button"
              onClick={enterPreview}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-medium transition-all',
                showPreview
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t('compose.preview.previewMode')}
            </button>
          </div>
        </div>
      )}

      {showPreview ? (
        <div className="min-h-[200px] w-full rounded-lg border-2 border-transparent bg-muted/40 p-3">
          <ArticleContent event={previewEvent} />
        </div>
      ) : (
        <div className="relative">
          <AutoGrowTextarea
            ref={textareaRef}
            id={id}
            value={value}
            onValueChange={onValueChange}
            placeholder={placeholder}
          />
          <MentionAutocomplete
            textareaRef={textareaRef}
            content={value}
            onInsertMention={handleInsertMention}
          />
        </div>
      )}
    </div>
  );
}
