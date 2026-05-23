const PHONE_PATTERN = /\+?\d[\d\s().-]{6,}\d/g;

export function redactPhone(value: string): string {
  return value.replace(PHONE_PATTERN, (match) => {
    const digits = match.replace(/\D/g, '');
    if (digits.length < 4) return '[phone]';
    return `[phone:***${digits.slice(-4)}]`;
  });
}

export function redactText(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  return redactPhone(String(value));
}

export function safeLogFields(fields: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes('body') ||
      lowerKey.includes('transcript') ||
      lowerKey.includes('args') ||
      lowerKey.includes('params') ||
      lowerKey.includes('note') ||
      lowerKey.includes('reason') ||
      lowerKey.includes('query')
    ) {
      redacted[key] = '[redacted]';
    } else if (typeof value === 'string') {
      redacted[key] = redactPhone(value);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}
