export interface MetaDeliveryError {
  code?: number | string;
  title?: string;
  message?: string;
  error_data?: {
    details?: string;
  };
  href?: string;
}

export interface DeliveryErrorDetails {
  code: string | null;
  message: string;
}

/**
 * Meta attaches delivery failures to status webhooks as an `errors[]`
 * array. Keep the first code and combine every unique human-readable
 * field so operators see the useful detail instead of only "failed".
 */
export function parseMetaDeliveryError(
  errors: MetaDeliveryError[] | undefined,
): DeliveryErrorDetails | null {
  if (!errors?.length) return null;

  const first = errors[0];
  const parts = [
    first.title,
    first.message,
    first.error_data?.details,
  ].filter(
    (value, index, values): value is string =>
      Boolean(value?.trim()) && values.indexOf(value) === index,
  );

  return {
    code: first.code === undefined ? null : String(first.code),
    message:
      parts.join(' — ') ||
      'Meta reported a delivery failure without additional details.',
  };
}

export function deliveryErrorLabel(
  error: DeliveryErrorDetails | null,
): string {
  if (!error) return 'Meta reported a delivery failure.';
  return error.code ? `[${error.code}] ${error.message}` : error.message;
}
