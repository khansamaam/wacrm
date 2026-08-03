import type { TemplateCarouselCard } from '@/types';

/**
 * Meta returns review-time header handles when templates are synced, but it
 * does not return the public media URL originally uploaded by this app. Keep
 * that local URL by card position so a sync cannot make an approved carousel
 * unsendable. Meta remains authoritative for card text, buttons, and handles.
 */
export function preserveCarouselMediaUrls(
  syncedCards: TemplateCarouselCard[] | null,
  localCards: TemplateCarouselCard[] | null | undefined,
): TemplateCarouselCard[] | null {
  if (!syncedCards) return null;

  return syncedCards.map((syncedCard, index) => {
    const localCard = localCards?.[index];
    const localUrl = localCard?.header_media_url?.trim();

    return {
      ...syncedCard,
      header_media_url: syncedCard.header_media_url?.trim() || localUrl || undefined,
    };
  });
}
