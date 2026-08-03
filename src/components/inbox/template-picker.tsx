"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { MessageTemplate } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  ChevronRight,
  LayoutTemplate,
  Loader2,
} from "lucide-react";
import { extractVariableIndices } from "@/lib/whatsapp/template-validators";
import { useTranslations } from "next-intl";

export interface TemplateSendValues {
  body: string[];
  headerText?: string;
  headerMediaUrl?: string;
  buttonParams?: Record<number, string>;
  carouselCards?: Array<{
    body: string[];
    headerMediaUrl?: string;
    buttonParams?: Record<number, string>;
  }>;
}

interface TemplatePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (template: MessageTemplate, values: TemplateSendValues) => void;
}

function renderBodyPreview(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
    const idx = Number(raw) - 1;
    const value = params[idx];
    return value && value.trim().length > 0 ? value : `{{${raw}}}`;
  });
}

interface UrlButtonSlot {
  index: number;
  text: string;
  url: string;
}

type MediaHeaderType = "image" | "video" | "document";

function isMediaHeaderType(
  value: MessageTemplate["header_type"],
): value is MediaHeaderType {
  return value === "image" || value === "video" || value === "document";
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Templates may need values for: body variables, a text-header
 * variable, a media header URL, and per-URL-button suffixes. Collect
 * them all so the send-message path doesn't reject missing parameters.
 */
function collectVariableSlots(template: MessageTemplate): {
  bodyVars: number[];
  headerVarCount: number;
  mediaHeaderType: MediaHeaderType | null;
  urlButtonSlots: UrlButtonSlot[];
  carouselCards: Array<{
    bodyVars: number[];
    mediaHeaderType: "image" | "video";
    urlButtonSlots: UrlButtonSlot[];
  }>;
} {
  const bodyVars = extractVariableIndices(template.body_text);
  const headerVarCount =
    template.header_type === "text" && template.header_content
      ? extractVariableIndices(template.header_content).length
      : 0;
  const mediaHeaderType = isMediaHeaderType(template.header_type)
    ? template.header_type
    : null;
  const urlButtonSlots: UrlButtonSlot[] = [];
  (template.buttons ?? []).forEach((b, i) => {
    if (b.type === "URL" && extractVariableIndices(b.url).length > 0) {
      urlButtonSlots.push({ index: i, text: b.text, url: b.url });
    }
  });
  const carouselCards = (template.carousel_cards ?? []).map((card) => ({
    bodyVars: extractVariableIndices(card.body_text),
    mediaHeaderType: card.header_type,
    urlButtonSlots: (card.buttons ?? []).flatMap((button, index) =>
      button.type === "URL" && extractVariableIndices(button.url).length > 0
        ? [{ index, text: button.text, url: button.url }]
        : [],
    ),
  }));
  return { bodyVars, headerVarCount, mediaHeaderType, urlButtonSlots, carouselCards };
}

export function TemplatePicker({
  open,
  onOpenChange,
  onSelect,
}: TemplatePickerProps) {
  const t = useTranslations("Inbox.templatePicker");

  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<MessageTemplate | null>(null);
  const [params, setParams] = useState<string[]>([]);
  const [headerText, setHeaderText] = useState<string>("");
  const [headerMediaUrl, setHeaderMediaUrl] = useState<string>("");
  const [buttonParams, setButtonParams] = useState<Record<number, string>>({});
  const [carouselParams, setCarouselParams] = useState<
    NonNullable<TemplateSendValues["carouselCards"]>
  >([]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        if (!cancelled) {
          setTemplates([]);
          setLoading(false);
        }
        return;
      }

      // Scope by RLS (message_templates_select → is_account_member), NOT by
      // user_id. Templates are account-owned, so filtering on the caller's
      // user_id hid templates that a teammate created — leaving them unable
      // to send approved templates in a shared account.
      const { data, error } = await supabase
        .from("message_templates")
        .select("*")
        .eq("status", "APPROVED")
        .order("created_at", { ascending: false });

      if (cancelled) return;
      if (error) {
        console.error("Failed to fetch templates:", error);
        setTemplates([]);
      } else {
        setTemplates((data as MessageTemplate[]) ?? []);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  const slots = selected ? collectVariableSlots(selected) : null;

  function resetSelection() {
    setSelected(null);
    setParams([]);
    setHeaderText("");
    setHeaderMediaUrl("");
    setButtonParams({});
    setCarouselParams([]);
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetSelection();
    onOpenChange(next);
  }

  function pickTemplate(template: MessageTemplate) {
    const slots = collectVariableSlots(template);
    const noInputsNeeded =
      slots.bodyVars.length === 0 &&
      slots.headerVarCount === 0 &&
      slots.mediaHeaderType === null &&
      slots.urlButtonSlots.length === 0;
    const carouselNeedsInput = slots.carouselCards.some(
      (card, index) =>
        !isValidHttpUrl(template.carousel_cards?.[index]?.header_media_url ?? "") ||
        card.bodyVars.length > 0 ||
        card.urlButtonSlots.length > 0,
    );
    if (noInputsNeeded && !carouselNeedsInput) {
      onSelect(template, {
        body: [],
        carouselCards: template.carousel_cards?.map((card) => ({
          body: [],
          headerMediaUrl: card.header_media_url,
        })),
      });
      handleOpenChange(false);
      return;
    }
    setSelected(template);
    setParams(new Array(slots.bodyVars.length).fill(""));
    setHeaderText("");
    setHeaderMediaUrl(template.header_media_url ?? "");
    setButtonParams({});
    setCarouselParams(
      (template.carousel_cards ?? []).map((card, index) => ({
        body: new Array(slots.carouselCards[index]?.bodyVars.length ?? 0).fill(""),
        headerMediaUrl: card.header_media_url ?? "",
        buttonParams: {},
      })),
    );
  }

  function confirm() {
    if (!selected) return;
    const values: TemplateSendValues = { body: params };
    if (headerText.trim()) values.headerText = headerText.trim();
    if (slots?.mediaHeaderType && headerMediaUrl.trim()) {
      values.headerMediaUrl = headerMediaUrl.trim();
    }
    if (Object.keys(buttonParams).length > 0) {
      values.buttonParams = Object.fromEntries(
        Object.entries(buttonParams).map(([k, v]) => [Number(k), v.trim()]),
      );
    }
    if (carouselParams.length > 0) values.carouselCards = carouselParams;
    onSelect(selected, values);
    handleOpenChange(false);
  }

  const canConfirm =
    !!selected &&
    !!slots &&
    slots.bodyVars.every((_, i) => (params[i] ?? "").trim().length > 0) &&
    (slots.headerVarCount === 0 || headerText.trim().length > 0) &&
    (slots.mediaHeaderType === null || isValidHttpUrl(headerMediaUrl.trim())) &&
    slots.urlButtonSlots.every(
      (s) => (buttonParams[s.index] ?? "").trim().length > 0,
    ) &&
    slots.carouselCards.every((cardSlots, cardIndex) => {
      const values = carouselParams[cardIndex];
      return (
        !!values &&
        isValidHttpUrl(values.headerMediaUrl?.trim() ?? "") &&
        cardSlots.bodyVars.every(
          (_, index) => (values.body[index] ?? "").trim().length > 0,
        ) &&
        cardSlots.urlButtonSlots.every(
          (button) => (values.buttonParams?.[button.index] ?? "").trim().length > 0,
        )
      );
    });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden border-border bg-popover sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-popover-foreground">
            <LayoutTemplate className="h-4 w-4 text-primary" />
            {selected ? selected.name : t("sendTemplate")}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {selected
              ? t("fillPlaceholders")
              : t("pickTemplate")}
          </DialogDescription>
        </DialogHeader>

        {!selected ? (
          <div className="min-h-0 space-y-2 overflow-y-auto overscroll-contain pr-2">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : templates.length === 0 ? (
              <div className="rounded-md border border-border bg-background/50 p-6 text-center">
                <p className="text-sm text-popover-foreground">{t("noApprovedTemplates")}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("noApprovedTemplatesHint")}
                </p>
              </div>
            ) : (
              templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => pickTemplate(t)}
                  className="w-full rounded-md border border-border bg-background/50 p-3 text-left transition-colors hover:border-primary/40 hover:bg-popover"
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium text-popover-foreground">
                          {t.name}
                        </p>
                        <Badge className="border border-primary/30 bg-primary/20 text-[10px] text-primary">
                          {t.category}
                        </Badge>
                        {t.language && (
                          <span className="text-[10px] uppercase text-muted-foreground">
                            {t.language}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {t.body_text}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  </div>
                </button>
              ))
            )}
          </div>
        ) : (
          <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain pr-2">
            <div className="rounded-md border border-border bg-background/50 p-3">
              <p className="mb-1 text-xs text-muted-foreground">{t("preview")}</p>
              <p className="whitespace-pre-wrap text-sm text-popover-foreground">
                {renderBodyPreview(selected.body_text, params)}
              </p>
              {selected.footer_text && (
                <p className="mt-2 text-xs italic text-muted-foreground">
                  {selected.footer_text}
                </p>
              )}
            </div>
            {(selected.template_type ?? "standard") === "carousel" &&
              selected.carousel_cards?.map((card, cardIndex) => {
                const cardSlots = slots?.carouselCards[cardIndex];
                const values = carouselParams[cardIndex];
                if (!cardSlots || !values) return null;
                return (
                  <div key={cardIndex} className="space-y-2 rounded-md border border-border bg-background/50 p-3">
                    <p className="text-xs font-medium text-popover-foreground">{`Card ${cardIndex + 1}`}</p>
                    <Input
                      type="url"
                      value={values.headerMediaUrl ?? ""}
                      onChange={(event) => {
                        const next = [...carouselParams];
                        next[cardIndex] = { ...values, headerMediaUrl: event.target.value };
                        setCarouselParams(next);
                      }}
                      placeholder={t("mediaHeaderUrlPlaceholder")}
                      className="border-border bg-muted text-foreground"
                    />
                    {isValidHttpUrl(values.headerMediaUrl?.trim() ?? "") && card.header_type === "image" && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={values.headerMediaUrl} alt="" className="max-h-32 rounded-md border border-border object-contain" />
                    )}
                    <p className="whitespace-pre-wrap text-sm text-popover-foreground">
                      {renderBodyPreview(card.body_text, values.body)}
                    </p>
                    {cardSlots.bodyVars.map((variable, index) => (
                      <Input
                        key={variable}
                        value={values.body[index] ?? ""}
                        onChange={(event) => {
                          const next = [...carouselParams];
                          const body = [...values.body];
                          body[index] = event.target.value;
                          next[cardIndex] = { ...values, body };
                          setCarouselParams(next);
                        }}
                        placeholder={`Card ${cardIndex + 1} body {{${variable}}}`}
                        className="border-border bg-muted text-foreground"
                      />
                    ))}
                    {cardSlots.urlButtonSlots.map((button) => (
                      <Input
                        key={button.index}
                        value={values.buttonParams?.[button.index] ?? ""}
                        onChange={(event) => {
                          const next = [...carouselParams];
                          next[cardIndex] = {
                            ...values,
                            buttonParams: { ...values.buttonParams, [button.index]: event.target.value },
                          };
                          setCarouselParams(next);
                        }}
                        placeholder={`Value for "${button.text}" URL {{1}}`}
                        className="border-border bg-muted text-foreground"
                      />
                    ))}
                  </div>
                );
              })}
            {slots && slots.headerVarCount > 0 && (
              <div className="space-y-1">
                <Label className="text-xs text-popover-foreground">
                  {`Header {{1}}`}
                </Label>
                <Input
                  value={headerText}
                  onChange={(e) => setHeaderText(e.target.value)}
                  placeholder={t("headerValuePlaceholder")}
                  className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
                />
              </div>
            )}
            {slots?.mediaHeaderType && (
              <div className="space-y-1">
                <Label className="text-xs text-popover-foreground">
                  {t("mediaHeaderUrl", {
                    type: slots.mediaHeaderType.toUpperCase(),
                  })}
                </Label>
                <Input
                  type="url"
                  value={headerMediaUrl}
                  onChange={(e) => setHeaderMediaUrl(e.target.value)}
                  placeholder={t("mediaHeaderUrlPlaceholder")}
                  className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
                />
                <p className="text-[10px] text-muted-foreground">
                  {t("mediaHeaderUrlHint")}
                </p>
                {headerMediaUrl.trim() &&
                  !isValidHttpUrl(headerMediaUrl.trim()) && (
                    <p className="text-[10px] text-amber-300">
                      {t("mediaHeaderUrlInvalid")}
                    </p>
                  )}
                {slots.mediaHeaderType === "image" &&
                  isValidHttpUrl(headerMediaUrl.trim()) && (
                    // The URL must be public for Meta too; previewing it here
                    // gives the sender an immediate reachability sanity check.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={headerMediaUrl.trim()}
                      alt=""
                      className="mt-2 max-h-32 rounded-md border border-border object-contain"
                    />
                  )}
              </div>
            )}
            {slots?.bodyVars.map((v, i) => (
              <div key={v} className="space-y-1">
                <Label className="text-xs text-popover-foreground">{`Body {{${v}}}`}</Label>
                <Input
                  value={params[i] ?? ""}
                  onChange={(e) => {
                    const next = [...params];
                    next[i] = e.target.value;
                    setParams(next);
                  }}
                  placeholder={t("bodyValuePlaceholder", { val: `{{${v}}}` })}
                  className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
                />
              </div>
            ))}
            {slots?.urlButtonSlots.map((slot) => (
              <div key={slot.index} className="space-y-1">
                <Label className="text-xs text-popover-foreground">
                  {`URL button "${slot.text}" — value for `}{`{{1}}`}
                </Label>
                <Input
                  value={buttonParams[slot.index] ?? ""}
                  onChange={(e) =>
                    setButtonParams((prev) => ({
                      ...prev,
                      [slot.index]: e.target.value,
                    }))
                  }
                  placeholder={t("urlSuffixValuePlaceholder")}
                  className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
                />
                <p className="text-[10px] text-muted-foreground break-all">
                  {t("finalUrl", { url: slot.url.replace(/\{\{1\}\}/g, buttonParams[slot.index] || "{{1}}") })}
                </p>
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="gap-2">
          {selected ? (
            <>
              <Button
                variant="outline"
                onClick={resetSelection}
                className="border-border text-popover-foreground hover:bg-muted"
              >
                <ArrowLeft className="h-4 w-4" />
                {t("back")}
              </Button>
              <Button
                disabled={!canConfirm}
                onClick={confirm}
                className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {t("send")}
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              className="border-border text-popover-foreground hover:bg-muted"
            >
              {t("cancel")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
