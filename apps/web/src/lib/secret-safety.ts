const UNSAFE_SECRET_MARKERS = [
  "replace",
  "change_me",
  "change-me",
  "changeme",
  "placeholder",
  "example",
  "your_",
  "your-",
  "set_a_",
  "before_hosting",
  "32-plus",
  "random-characters",
  "secret-key",
  "secret_key",
  "password",
];

function uniqueCharacterCount(value: string): number {
  return new Set(value).size;
}

export function getSharedSecretValidationIssue(
  name: string,
  value: string | undefined,
  minLength = 32,
): string | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length < minLength) {
    return `${name} must be at least ${minLength} characters`;
  }

  const normalized = trimmed.toLowerCase();
  if (UNSAFE_SECRET_MARKERS.some((marker) => normalized.includes(marker))) {
    return `${name} must not use a documented placeholder or example value`;
  }

  if (uniqueCharacterCount(trimmed) < 8 || /^(.)\1+$/.test(trimmed)) {
    return `${name} must be high entropy, not a repeated or low-variety value`;
  }

  return null;
}

export function isSharedSecretSafe(value: string | undefined, minLength = 32): boolean {
  return getSharedSecretValidationIssue("secret", value, minLength) === null;
}
