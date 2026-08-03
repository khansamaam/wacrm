import type {
  MessageTemplate,
  TemplateMessageButtonSnapshot,
  TemplateMessageSnapshot,
} from '@/types';
import type { SendTimeParams } from './template-send-builder';
import { renderTemplateBody } from './template-render';

function renderHeaderText(
  template: MessageTemplate,
  params: SendTimeParams
): string | undefined {
  if (template.header_type !== 'text' || !template.header_content) {
    return undefined;
  }
  return params.headerText
    ? renderTemplateBody(template.header_content, [params.headerText])
    : template.header_content;
}

function snapshotButton(
  button: NonNullable<MessageTemplate['buttons']>[number],
  index: number,
  params: SendTimeParams
): TemplateMessageButtonSnapshot {
  const override = params.buttonParams?.[index]?.trim();
  switch (button.type) {
    case 'URL':
      return {
        type: button.type,
        text: button.text,
        url: button.url.replace(
          /\{\{1\}\}/g,
          override || button.example || '{{1}}'
        ),
      };
    case 'PHONE_NUMBER':
      return {
        type: button.type,
        text: button.text,
        phone_number: button.phone_number,
      };
    case 'COPY_CODE':
      return {
        type: button.type,
        text: button.text,
        code: override || button.example,
      };
    case 'QUICK_REPLY':
      return { type: button.type, text: button.text };
  }
}

export function buildTemplateMessageSnapshot(
  template: MessageTemplate,
  bodyText: string,
  params: SendTimeParams = {}
): TemplateMessageSnapshot {
  const mediaHeader =
    template.header_type === 'image' ||
    template.header_type === 'video' ||
    template.header_type === 'document';
  const buttons = template.buttons?.map((button, index) =>
    snapshotButton(button, index, params)
  );
  const carouselCards = template.carousel_cards?.map((card, cardIndex) => {
    const cardParams = params.carouselCards?.[cardIndex] ?? {};
    return {
      header_type: card.header_type,
      header_media_url: cardParams.headerMediaUrl || card.header_media_url,
      body_text: renderTemplateBody(card.body_text, cardParams.body ?? []),
      buttons: card.buttons?.map((button, buttonIndex) =>
        snapshotButton(button, buttonIndex, cardParams)
      ),
    };
  });

  return {
    header_type: template.header_type,
    header_text: renderHeaderText(template, params),
    header_media_url: mediaHeader
      ? params.headerMediaUrl || template.header_media_url
      : undefined,
    body_text: bodyText,
    footer_text: template.footer_text,
    buttons: buttons?.length ? buttons : undefined,
    carousel_cards: carouselCards?.length ? carouselCards : undefined,
  };
}
