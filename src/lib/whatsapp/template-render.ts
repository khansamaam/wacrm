/**
 * Render a WhatsApp template body using Meta's one-based `{{1}}`
 * placeholders. Unknown values remain visible instead of disappearing.
 */
export function renderTemplateBody(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw: string) => {
    const index = Number(raw) - 1;
    return params[index] ?? `{{${raw}}}`;
  });
}
