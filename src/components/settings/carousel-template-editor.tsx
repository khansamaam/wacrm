'use client';

import { Plus, Trash2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { extractVariableIndices, TEMPLATE_LIMITS } from '@/lib/whatsapp/template-validators';
import type { TemplateButton, TemplateCarouselCard } from '@/types';

interface CarouselTemplateEditorProps {
  cards: TemplateCarouselCard[];
  uploading: boolean;
  onChange: (cards: TemplateCarouselCard[]) => void;
  onUploadImage: (cardIndex: number, file: File) => Promise<void>;
}

function emptyCard(): TemplateCarouselCard {
  return {
    header_type: 'image',
    header_media_url: '',
    body_text: '',
    buttons: [],
    sample_values: { body: [] },
  };
}

function emptyButton(type: TemplateButton['type']): TemplateButton {
  if (type === 'URL') return { type, text: '', url: '' };
  if (type === 'PHONE_NUMBER') return { type, text: '', phone_number: '' };
  return { type: 'QUICK_REPLY', text: '' };
}

export function CarouselTemplateEditor({
  cards,
  uploading,
  onChange,
  onUploadImage,
}: CarouselTemplateEditorProps) {
  const t = useTranslations('Settings.templates');

  function updateCard(index: number, patch: Partial<TemplateCarouselCard>) {
    onChange(cards.map((card, current) => (current === index ? { ...card, ...patch } : card)));
  }

  function updateButton(cardIndex: number, buttonIndex: number, button: TemplateButton) {
    const next = [...(cards[cardIndex].buttons ?? [])];
    next[buttonIndex] = button;
    updateCard(cardIndex, { buttons: next });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-muted-foreground">{t('carouselCards')}</Label>
          <p className="text-[11px] text-muted-foreground">{t('carouselCardsHint')}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={cards.length >= TEMPLATE_LIMITS.carouselMaxCards}
          onClick={() => onChange([...cards, emptyCard()])}
        >
          <Plus className="size-3.5" /> {t('addCard')}
        </Button>
      </div>

      {cards.map((card, cardIndex) => {
        const variables = extractVariableIndices(card.body_text);
        return (
          <div key={cardIndex} className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-foreground">{t('cardNumber', { number: cardIndex + 1 })}</p>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={cards.length <= TEMPLATE_LIMITS.carouselMinCards}
                onClick={() => onChange(cards.filter((_, index) => index !== cardIndex))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">{t('cardImage')}</Label>
              <Input
                type="file"
                accept="image/jpeg,image/png"
                disabled={uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void onUploadImage(cardIndex, file);
                  event.target.value = '';
                }}
                className="h-9 bg-muted text-xs"
              />
              <Input
                type="url"
                value={card.header_media_url ?? ''}
                placeholder="https://…"
                onChange={(event) => updateCard(cardIndex, {
                  header_media_url: event.target.value,
                  header_handle: undefined,
                })}
                className="bg-muted"
              />
              {card.header_media_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={card.header_media_url}
                  alt={t('cardImageAlt', { number: cardIndex + 1 })}
                  className="max-h-36 rounded-md border border-border object-contain"
                />
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">{t('cardBody')}</Label>
              <Textarea
                value={card.body_text}
                maxLength={TEMPLATE_LIMITS.carouselCardBodyMaxLength}
                rows={3}
                placeholder={t.raw('cardBodyPlaceholder')}
                onChange={(event) => {
                  const bodyText = event.target.value;
                  const count = extractVariableIndices(bodyText).length;
                  const samples = [...(card.sample_values?.body ?? [])].slice(0, count);
                  while (samples.length < count) samples.push('');
                  updateCard(cardIndex, {
                    body_text: bodyText,
                    sample_values: samples.length ? { body: samples } : undefined,
                  });
                }}
                className="resize-none bg-muted"
              />
              {variables.map((variable, sampleIndex) => (
                <Input
                  key={variable}
                  value={card.sample_values?.body?.[sampleIndex] ?? ''}
                  placeholder={t('samplePlaceholder', { var: `{{${variable}}}` })}
                  onChange={(event) => {
                    const samples = [...(card.sample_values?.body ?? [])];
                    samples[sampleIndex] = event.target.value;
                    updateCard(cardIndex, { sample_values: { body: samples } });
                  }}
                  className="bg-muted"
                />
              ))}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">{t('cardButtons')}</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={(card.buttons?.length ?? 0) >= TEMPLATE_LIMITS.carouselMaxButtonsPerCard}
                  onClick={() => updateCard(cardIndex, {
                    buttons: [...(card.buttons ?? []), emptyButton('QUICK_REPLY')],
                  })}
                >
                  <Plus className="size-3" /> {t('addButton')}
                </Button>
              </div>

              {(card.buttons ?? []).map((button, buttonIndex) => (
                <div key={buttonIndex} className="space-y-2 rounded border border-border p-2">
                  <div className="flex gap-2">
                    <Select
                      value={button.type}
                      onValueChange={(value) => updateButton(
                        cardIndex,
                        buttonIndex,
                        emptyButton(value as TemplateButton['type']),
                      )}
                    >
                      <SelectTrigger className="w-36 bg-muted"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="QUICK_REPLY">{t('btnQuickReply')}</SelectItem>
                        <SelectItem value="URL">{t('btnUrl')}</SelectItem>
                        <SelectItem value="PHONE_NUMBER">{t('btnPhone')}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      value={button.text}
                      placeholder={t('btnLabelPlaceholder')}
                      onChange={(event) => updateButton(cardIndex, buttonIndex, {
                        ...button,
                        text: event.target.value,
                      })}
                      className="bg-muted"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => updateCard(cardIndex, {
                        buttons: card.buttons?.filter((_, index) => index !== buttonIndex),
                      })}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                  {button.type === 'URL' && (
                    <>
                      <Input
                        value={button.url}
                        placeholder={t.raw('urlPlaceholder')}
                        onChange={(event) => updateButton(cardIndex, buttonIndex, {
                          ...button,
                          url: event.target.value,
                        })}
                        className="bg-muted"
                      />
                      {extractVariableIndices(button.url).length > 0 && (
                        <Input
                          value={button.example ?? ''}
                          placeholder={t.raw('urlSamplePlaceholder')}
                          onChange={(event) => updateButton(cardIndex, buttonIndex, {
                            ...button,
                            example: event.target.value,
                          })}
                          className="bg-muted"
                        />
                      )}
                    </>
                  )}
                  {button.type === 'PHONE_NUMBER' && (
                    <Input
                      value={button.phone_number}
                      placeholder={t('phonePlaceholder')}
                      onChange={(event) => updateButton(cardIndex, buttonIndex, {
                        ...button,
                        phone_number: event.target.value,
                      })}
                      className="bg-muted"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
