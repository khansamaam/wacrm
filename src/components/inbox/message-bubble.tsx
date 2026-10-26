"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import type { Message, MessageReaction } from "@/types";
import {
  Clock,
  Check,
  CheckCheck,
  XCircle,
  FileText,
  MapPin,
  LayoutTemplate,
  ImageOff,
  CornerDownLeft,
  Sparkles,
  Phone,
  ExternalLink,
  Copy,
  Trash2,
  Download,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { ReplyQuote } from "./reply-quote";
import { MessageReactions } from "./message-reactions";
import { InteractivePreview } from "@/components/interactive/interactive-preview";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

interface MessageBubbleProps {
  message: Message;
  /** Pre-computed quote info for messages that reply to another. */
  reply?: { authorLabel: string; preview: string } | null;
  reactions?: MessageReaction[];
  currentUserId?: string;
  onToggleReaction?: (emoji: string) => void;
}

function StatusIcon({
  status,
  errorCode,
  errorMessage,
}: {
  status: Message["status"];
  errorCode?: string | null;
  errorMessage?: string | null;
}) {
  switch (status) {
    case "sending":
      return <Clock className="h-3 w-3 text-white/70" />;
    case "sent":
      return <Check className="h-3 w-3 text-white/80" />;
    case "delivered":
      return <CheckCheck className="h-3 w-3 text-white/90" />;
    case "read":
      return <CheckCheck className="h-3 w-3 text-sky-200" />;
    case "failed": {
      const detail = [
        errorCode ? `[${errorCode}]` : null,
        errorMessage || "Delivery failed",
      ]
        .filter(Boolean)
        .join(" ");
      return (
        <span
          className="inline-flex cursor-help"
          title={detail}
          aria-label={detail}
          tabIndex={0}
        >
          <XCircle className="h-3 w-3 text-red-200" />
        </span>
      );
    }
    default:
      return null;
  }
}

function MediaUnavailable({ label, t }: { label: string, t: ReturnType<typeof useTranslations> }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <ImageOff className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span>{t("unavailable", { label })}</span>
    </div>
  );
}

function MediaImage({ url, alt }: { url: string; alt: string }) {
  const t = useTranslations("Inbox.bubble");
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [viewerOpen, setViewerOpen] = useState(false);
  // The blob URL currently held, so it can be released on change/unmount
  // (reading `src` in the cleanup would see a stale value).
  const blobUrlRef = useRef<string | null>(null);

  const loadImage = useCallback(async () => {
    if (!url) return;

    // Proxy URLs need auth fetch to create blob URL
    if (url.startsWith("/api/whatsapp/media/")) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to load media");
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        blobUrlRef.current = blobUrl;
        setSrc(blobUrl);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    } else {
      setSrc(url);
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    loadImage();
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [loadImage]);

  if (error) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-muted">
        <ImageOff className="h-8 w-8 text-muted-foreground" />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-muted">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // `url` (not the blob) is the shareable address: the media proxy works in
  // a new tab because it authenticates with the session cookie.
  return (
    <>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        title={t("imageViewHint")}
        className="block cursor-zoom-in"
        onClick={(event) => {
          // Plain left click opens the viewer; Ctrl/Cmd/Shift/middle click
          // and the right-click menu keep the browser's own behaviour.
          if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
          event.preventDefault();
          setViewerOpen(true);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src ?? ""}
          alt={alt}
          className="max-h-64 max-w-60 rounded-lg object-cover"
          onError={() => setError(true)}
        />
      </a>
      <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
        <DialogContent
          showCloseButton={false}
          className="flex max-h-[95vh] w-auto max-w-[95vw] flex-col items-center gap-3 border-none bg-black/90 p-3 sm:max-w-[95vw]"
        >
          <DialogTitle className="sr-only">{alt || t("imageViewTitle")}</DialogTitle>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src ?? ""}
            alt={alt}
            className="max-h-[80vh] max-w-[90vw] rounded object-contain"
          />
          <div className="flex flex-wrap items-center justify-center gap-2">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t("imageOpenNewTab")}
            </a>
            <a
              href={src ?? url}
              download
              className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20"
            >
              <Download className="h-3.5 w-3.5" />
              {t("imageDownload")}
            </a>
            <button
              type="button"
              onClick={() => setViewerOpen(false)}
              className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20"
            >
              <X className="h-3.5 w-3.5" />
              {t("imageClose")}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function WhatsAppTemplateText({ text }: { text: string }) {
  const parts = text.split(/(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g);
  return (
    <p className="whitespace-pre-wrap break-words text-sm">
      {parts.map((part, index) => {
        if (part.startsWith("*") && part.endsWith("*")) {
          return <strong key={index}>{part.slice(1, -1)}</strong>;
        }
        if (part.startsWith("_") && part.endsWith("_")) {
          return <em key={index}>{part.slice(1, -1)}</em>;
        }
        if (part.startsWith("~") && part.endsWith("~")) {
          return <s key={index}>{part.slice(1, -1)}</s>;
        }
        return part;
      })}
    </p>
  );
}

function TemplateMessageContent({
  message,
  t,
}: {
  message: Message;
  t: ReturnType<typeof useTranslations>;
}) {
  const payload = message.template_payload;
  if (!payload) {
    return (
      <div>
        <span className="mb-1 inline-flex items-center gap-1 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
          <LayoutTemplate className="h-3 w-3" />
          {t("template")}
        </span>
        <WhatsAppTemplateText
          text={message.content_text || message.template_name || t("template")}
        />
      </div>
    );
  }

  return (
    <div className="min-w-64 max-w-sm">
      {payload.carousel_cards?.length ? (
        <div className="mb-2 flex max-w-[min(72vw,40rem)] snap-x gap-2 overflow-x-auto pb-1">
          {payload.carousel_cards.map((card, cardIndex) => (
            <div
              key={cardIndex}
              className="w-56 shrink-0 snap-start overflow-hidden rounded-lg bg-black/10"
            >
              {card.header_type === "image" && card.header_media_url ? (
                <MediaImage url={card.header_media_url} alt="" />
              ) : null}
              {card.header_type === "video" && card.header_media_url ? (
                <video src={card.header_media_url} controls className="max-h-48 w-full" />
              ) : null}
              <div className="space-y-2 p-2">
                <WhatsAppTemplateText text={card.body_text} />
                {card.buttons?.map((button, buttonIndex) => (
                  <div
                    key={buttonIndex}
                    className="rounded-md bg-white/15 px-2 py-1.5 text-center text-xs font-medium text-white"
                  >
                    {button.text}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {payload.header_type === "image" && payload.header_media_url ? (
        <div className="mb-2 overflow-hidden rounded-lg">
          <MediaImage url={payload.header_media_url} alt="" />
        </div>
      ) : null}
      {payload.header_type === "video" && payload.header_media_url ? (
        <video
          src={payload.header_media_url}
          controls
          className="mb-2 max-h-64 w-full rounded-lg"
        />
      ) : null}
      {payload.header_type === "document" && payload.header_media_url ? (
        <a
          href={payload.header_media_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-2 flex items-center gap-2 rounded-lg bg-primary-foreground/10 px-3 py-2 text-sm"
        >
          <FileText className="h-4 w-4 shrink-0" />
          <span className="truncate">{t("document")}</span>
        </a>
      ) : null}
      {payload.header_text ? (
        <p className="mb-1 text-sm font-semibold">{payload.header_text}</p>
      ) : null}
      {/* Migration 064 drops body_text from the stored payload when it
          equals content_text, so fall back to the message text. */}
      <WhatsAppTemplateText text={payload.body_text || message.content_text || ""} />
      {payload.footer_text ? (
        <p className="mt-1.5 text-xs text-white/70">
          {payload.footer_text}
        </p>
      ) : null}
      {payload.buttons?.length ? (
        <div className="mt-2 space-y-1 border-t border-white/20 pt-2">
          {payload.buttons.map((button, index) => {
            const content = (
              <>
                {button.type === "PHONE_NUMBER" ? (
                  <Phone className="h-4 w-4" />
                ) : button.type === "URL" ? (
                  <ExternalLink className="h-4 w-4" />
                ) : button.type === "COPY_CODE" ? (
                  <Copy className="h-4 w-4" />
                ) : (
                  <CornerDownLeft className="h-4 w-4" />
                )}
                <span className="truncate">{button.text}</span>
              </>
            );
            const className =
              "flex w-full items-center justify-center gap-2 rounded-md bg-white/15 px-3 py-2 text-center text-sm font-medium text-white transition-colors hover:bg-white/20";

            if (button.type === "URL" && button.url) {
              return (
                <a
                  key={index}
                  href={button.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={className}
                >
                  {content}
                </a>
              );
            }
            if (button.type === "PHONE_NUMBER" && button.phone_number) {
              return (
                <a
                  key={index}
                  href={`tel:${button.phone_number}`}
                  className={className}
                >
                  {content}
                </a>
              );
            }
            return (
              <div key={index} className={className}>
                {content}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function MessageContent({ message, t }: { message: Message, t: ReturnType<typeof useTranslations> }) {
  switch (message.content_type) {
    case "text":
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text}
        </p>
      );

    case "image":
      return (
        <div>
          {message.media_url ? (
            <MediaImage url={message.media_url} alt="Shared image" />
          ) : (
            <MediaUnavailable label={t("photo")} t={t} />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "video":
      return (
        <div>
          {message.media_url ? (
            <video
              src={message.media_url}
              controls
              className="max-h-64 max-w-60 rounded-lg"
            />
          ) : (
            <MediaUnavailable label={t("video")} t={t} />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "audio":
      return (
        <div>
          {message.media_url ? (
            <audio src={message.media_url} controls className="max-w-60" />
          ) : (
            <MediaUnavailable label={t("audio")} t={t} />
          )}
        </div>
      );

    case "document":
      if (!message.media_url) {
        return <MediaUnavailable label={message.content_text || t("document")} t={t} />;
      }
      return (
        <a
          href={message.media_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm hover:bg-muted"
        >
          <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
          <span className="truncate">
            {message.content_text || t("document")}
          </span>
        </a>
      );

    case "template":
      return <TemplateMessageContent message={message} t={t} />;

    case "location":
      return (
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>{message.content_text || t("locationShared")}</span>
        </div>
      );

    case "interactive": {
      // Three cases share content_type='interactive':
      //  - OUTBOUND with payload (composer / automation / Flow send after
      //    migration 035): render the buttons/list as they appear on the phone.
      //  - INBOUND tap (customer chose an option, sender_type='customer'):
      //    no payload; show the tapped option's title with a reply affordance
      //    so agents can tell it's a tap, not the customer typing.
      //  - OUTBOUND with NO payload (legacy bot/Flow sends from before
      //    migration 035 backfilled the column): show the body text plainly —
      //    it is our own message, NOT a customer tap.
      if (message.interactive_payload) {
        return <InteractivePreview payload={message.interactive_payload} />;
      }
      if (message.sender_type === "customer") {
        return (
          <div className="flex flex-col gap-0.5">
            <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <CornerDownLeft className="h-3 w-3" />
              {t("buttonReply")}
            </span>
            <p className="whitespace-pre-wrap break-words text-sm">
              {message.content_text || t("interactiveReply")}
            </p>
          </div>
        );
      }
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text || t("interactiveReply")}
        </p>
      );
    }

    default:
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text || t("unsupported")}
        </p>
      );
  }
}

export function MessageBubble({
  message,
  reply,
  reactions,
  currentUserId,
  onToggleReaction,
}: MessageBubbleProps) {
  const t = useTranslations("Inbox.bubble");

  const isAgent = message.sender_type === "agent" || message.sender_type === "bot";
  const time = format(new Date(message.created_at), "HH:mm");

  // Row alignment + width cap are owned by <MessageActions> so its hover
  // group matches the bubble's content area, not the full row.
  return (
    <div
      className={cn(
        "flex flex-col",
        isAgent ? "items-end" : "items-start",
      )}
    >
      <div
        className={cn(
          "relative rounded-2xl px-3 py-2",
          isAgent
            ? "rounded-br-md bg-[#16835c] text-white shadow-sm"
            : "rounded-bl-md bg-muted text-foreground",
        )}
      >
        {reply && (
          <ReplyQuote
            authorLabel={reply.authorLabel}
            preview={reply.preview}
            onPrimary={isAgent}
          />
        )}
        <MessageContent message={message} t={t} />
        <div
          className={cn(
            "mt-1 flex items-center gap-1",
            isAgent ? "justify-end" : "justify-start",
          )}
        >
          {/* AI badge — only on replies the auto-reply bot generated
              (always outbound, so it sits on the primary fill). Lets
              agents tell an AI reply from their own / a Flow's at a
              glance. */}
          {/* The customer deleted this message for everyone in WhatsApp
              (migration 063). Kept visible to staff for the record. */}
          {message.deleted_by_customer_at && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full bg-red-500/15 px-1.5 py-px text-[9px] font-semibold uppercase leading-none tracking-wide text-red-400"
              title={t("deletedBadgeTitle")}
            >
              <Trash2 className="h-2.5 w-2.5" />
              {t("deletedBadge")}
            </span>
          )}
          {message.ai_generated && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full bg-white/20 px-1.5 py-px text-[9px] font-semibold uppercase leading-none tracking-wide text-white"
              title={t("aiBadgeTitle")}
            >
              <Sparkles className="h-2.5 w-2.5" />
              {t("aiBadge")}
            </span>
          )}
          <span
            className={cn(
              "text-[10px]",
              // Outbound bubbles sit on the primary fill, so the
              // timestamp must read against that (not the neutral
              // foreground) — otherwise it goes low-contrast in light
              // mode. Inbound bubbles use the muted surface.
              isAgent ? "text-white/70" : "text-muted-foreground",
            )}
          >
            {time}
          </span>
          {isAgent && (
            <StatusIcon
              status={message.status}
              errorCode={message.delivery_error_code}
              errorMessage={message.delivery_error_message}
            />
          )}
        </div>
      </div>
      {reactions && reactions.length > 0 && onToggleReaction && (
        <MessageReactions
          reactions={reactions}
          currentUserId={currentUserId}
          onToggle={onToggleReaction}
        />
      )}
    </div>
  );
}
