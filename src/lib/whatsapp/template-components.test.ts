import { describe, expect, it } from 'vitest';
import { buildMetaTemplatePayload } from './template-components';
import type { TemplatePayload } from './template-validators';

const base: TemplatePayload = {
  name: 'order_confirmation',
  category: 'Utility',
  language: 'en_US',
  body_text: 'Your order is on its way.',
};

describe('buildMetaTemplatePayload', () => {
  it('upcases category and produces minimal components (body only)', () => {
    const payload = buildMetaTemplatePayload(base);
    expect(payload).toEqual({
      name: 'order_confirmation',
      category: 'UTILITY',
      language: 'en_US',
      components: [{ type: 'BODY', text: 'Your order is on its way.' }],
    });
  });

  it('includes body_text example as a 2D array (Meta spec)', () => {
    const payload = buildMetaTemplatePayload({
      ...base,
      body_text: 'Hi {{1}}, order {{2}}.',
      sample_values: { body: ['John', 'ORD-42'] },
    });
    const body = payload.components.find((c) => c.type === 'BODY');
    expect(body?.example?.body_text).toEqual([['John', 'ORD-42']]);
  });

  it('emits TEXT header in canonical first position', () => {
    const payload = buildMetaTemplatePayload({
      ...base,
      header_type: 'text',
      header_content: 'Hello {{1}}',
      sample_values: { header: ['Sara'] },
    });
    expect(payload.components[0]).toEqual({
      type: 'HEADER',
      format: 'TEXT',
      text: 'Hello {{1}}',
      example: { header_text: ['Sara'] },
    });
  });

  it('uses header_url for media headers when no handle is set', () => {
    const payload = buildMetaTemplatePayload({
      ...base,
      header_type: 'image',
      header_media_url: 'https://example.com/img.jpg',
    });
    expect(payload.components[0]).toEqual({
      type: 'HEADER',
      format: 'IMAGE',
      example: { header_url: ['https://example.com/img.jpg'] },
    });
  });

  it('prefers header_handle over header_media_url', () => {
    const payload = buildMetaTemplatePayload({
      ...base,
      header_type: 'video',
      header_handle: '4::aW1...',
      header_media_url: 'https://example.com/v.mp4',
    });
    expect(payload.components[0]).toEqual({
      type: 'HEADER',
      format: 'VIDEO',
      example: { header_handle: ['4::aW1...'] },
    });
  });

  it('emits footer when present, skips when empty', () => {
    const withFooter = buildMetaTemplatePayload({
      ...base,
      footer_text: 'Reply STOP to opt out',
    });
    expect(
      withFooter.components.some(
        (c) => c.type === 'FOOTER' && c.text === 'Reply STOP to opt out'
      )
    ).toBe(true);

    const withoutFooter = buildMetaTemplatePayload({
      ...base,
      footer_text: '',
    });
    expect(withoutFooter.components.some((c) => c.type === 'FOOTER')).toBe(
      false
    );
  });

  it('emits the buttons component with correct per-type fields', () => {
    const payload = buildMetaTemplatePayload({
      ...base,
      buttons: [
        { type: 'QUICK_REPLY', text: 'Yes' },
        { type: 'URL', text: 'Track', url: 'https://x/{{1}}', example: 'abc' },
        { type: 'PHONE_NUMBER', text: 'Call', phone_number: '+15551234567' },
        { type: 'COPY_CODE', text: 'Copy', example: 'SUMMER20' },
      ],
    });
    const buttons = payload.components.find((c) => c.type === 'BUTTONS');
    expect(buttons?.buttons).toEqual([
      { type: 'QUICK_REPLY', text: 'Yes' },
      { type: 'URL', text: 'Track', url: 'https://x/{{1}}', example: ['abc'] },
      { type: 'PHONE_NUMBER', text: 'Call', phone_number: '+15551234567' },
      { type: 'COPY_CODE', text: 'Copy', example: ['SUMMER20'] },
    ]);
  });

  it('orders components HEADER → BODY → FOOTER → BUTTONS', () => {
    const payload = buildMetaTemplatePayload({
      ...base,
      header_type: 'text',
      header_content: 'Hi',
      footer_text: 'Footer',
      buttons: [{ type: 'QUICK_REPLY', text: 'Yes' }],
    });
    expect(payload.components.map((c) => c.type)).toEqual([
      'HEADER',
      'BODY',
      'FOOTER',
      'BUTTONS',
    ]);
  });

  it('builds Meta CAROUSEL cards with nested media, body, and buttons', () => {
    const payload = buildMetaTemplatePayload({
      ...base,
      name: 'summer_carousel',
      category: 'Marketing',
      template_type: 'carousel',
      body_text: 'Choose the offer that suits you.',
      carousel_cards: [
        {
          header_type: 'image',
          header_handle: '4::card-one',
          body_text: 'Save {{1}} on facials today.',
          sample_values: { body: ['20%'] },
          buttons: [
            { type: 'URL', text: 'Book', url: 'https://example.com/one' },
          ],
        },
        {
          header_type: 'image',
          header_handle: '4::card-two',
          body_text: 'Save {{1}} on skincare today.',
          sample_values: { body: ['15%'] },
          buttons: [
            { type: 'URL', text: 'Book', url: 'https://example.com/two' },
          ],
        },
      ],
    });

    expect(payload.category).toBe('MARKETING');
    expect(payload.components.map((component) => component.type)).toEqual([
      'BODY',
      'CAROUSEL',
    ]);
    expect(payload.components[1].cards?.[0].components).toEqual([
      {
        type: 'HEADER',
        format: 'IMAGE',
        example: { header_handle: ['4::card-one'] },
      },
      {
        type: 'BODY',
        text: 'Save {{1}} on facials today.',
        example: { body_text: [['20%']] },
      },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'URL', text: 'Book', url: 'https://example.com/one' },
        ],
      },
    ]);
  });
});
