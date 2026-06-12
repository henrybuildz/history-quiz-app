const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;

// Expects a pre-trimmed string. Callers must trim() before passing.
export function validateUsername(value: string): string | null {
  if (value.length < 3)  return 'Username must be at least 3 characters';
  if (value.length > 20) return 'Username must be 20 characters or less';
  if (!USERNAME_REGEX.test(value)) return 'Only letters, numbers, and underscores';
  return null;
}
