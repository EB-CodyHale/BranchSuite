/** Pairing codes shown on a lobby TV: 6 letters/digits, displayed as "K7Q-29M". */

/** Uppercase, keep A-Z/0-9, at most 6 characters, dash after the third. */
export function formatPairingCode(input: string): string {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  return raw.length > 3 ? `${raw.slice(0, 3)}-${raw.slice(3)}` : raw;
}

export function isCompletePairingCode(code: string): boolean {
  return /^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(code);
}
