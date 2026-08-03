import type { MessageTemplate } from '@/types';
import type { SendTimeParams } from './template-send-builder';
import { extractVariableIndices } from './template-validators';

interface BroadcastTemplateParamOptions {
  body: string[];
  headerMediaUrl?: string;
  carouselCardMediaUrls?: string[];
}

/**
 * Build the structured Meta parameters shared by every recipient in a
 * dashboard broadcast. Body values remain recipient-specific; media URLs are
 * selected once in the wizard and applied consistently across the campaign.
 */
export function buildBroadcastTemplateParams(
  template: MessageTemplate,
  options: BroadcastTemplateParamOptions
): SendTimeParams {
  const params: SendTimeParams = { body: options.body };
  const headerMediaUrl = options.headerMediaUrl?.trim();
  if (headerMediaUrl) params.headerMediaUrl = headerMediaUrl;

  if ((template.template_type ?? 'standard') !== 'carousel') return params;

  params.carouselCards = (template.carousel_cards ?? []).map((card, index) => {
    const buttonParams: Record<number, string> = {};
    card.buttons?.forEach((button, buttonIndex) => {
      if (
        button.type === 'URL' &&
        extractVariableIndices(button.url).length > 0 &&
        button.example
      ) {
        buttonParams[buttonIndex] = button.example;
      }
      if (button.type === 'COPY_CODE' && button.example) {
        buttonParams[buttonIndex] = button.example;
      }
    });

    return {
      // The same numbered mapping is used in the top-level body and cards;
      // buildSendComponents trims unused values per component.
      body: options.body,
      headerMediaUrl:
        options.carouselCardMediaUrls?.[index]?.trim() ||
        card.header_media_url?.trim() ||
        undefined,
      buttonParams:
        Object.keys(buttonParams).length > 0 ? buttonParams : undefined,
    };
  });

  return params;
}
