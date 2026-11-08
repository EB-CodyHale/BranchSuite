/**
 * Message content for storage and classification (ARCHITECTURE §7 step 4).
 *
 * Graph `uniqueBody` already holds only the new part of a message, so it is preferred. The fallback
 * stripper removes quoted history, mobile footers, signatures, disclaimers and external-sender
 * banners heuristically, then whitespace is normalized and the text capped at LIMITS.maxEmailBodyChars.
 * The heuristics err on the side of keeping text: a missed signature costs little, lost content costs a lot.
 */
import { LIMITS } from '@branchsuite/shared';

export interface BodySource {
  uniqueBody?: { contentType?: string; content?: string | null } | null;
  body?: { contentType?: string; content?: string | null } | null;
}

/** Lines that start a block of quoted history: everything from here down is dropped. */
const HISTORY_MARKERS: RegExp[] = [
  /^-{2,}\s*original message\s*-{2,}$/i,
  /^-{2,}\s*forwarded message\s*-{2,}$/i,
  /^_{10,}$/,
  /^begin forwarded message:?$/i,
  /^on\s.{3,200}\swrote:\s*$/i,
  /^le\s.{3,200}\sa écrit\s*:\s*$/i,
  /^el\s.{3,200}\sescribió:\s*$/i,
];

/** A "From:" line followed within a few lines by Sent:/Date: and To:/Subject: is a header block. */
const HEADER_FROM = /^\*?(from|de):\*?\s/i;
const HEADER_FOLLOW = /^\*?(sent|date|to|cc|subject|enviado|para|asunto):\*?\s/i;

/** Lines that start a signature or footer: everything from here down is dropped. */
const FOOTER_MARKERS: RegExp[] = [
  /^--\s*$/,
  /^get outlook for (ios|android)/i,
  /^sent from my (iphone|ipad|android|samsung|mobile|galaxy|phone)/i,
  /^sent from (outlook|mail) for/i,
  /^sent via the samsung/i,
  /^(confidentiality notice|this e-?mail (and any attachments )?(is|are|may be) (confidential|intended))/i,
  /^the information (contained )?in this (e-?mail|message|communication) (is|may be) (confidential|privileged)/i,
  /^this (message|communication) (is|may be) (confidential|privileged|intended only)/i,
  /^disclaimer:/i,
];

/** Single banner lines removed wherever they appear. */
const BANNERS: RegExp[] = [
  /^\[?\s*(caution|external|warning)\s*[:!\]-].{0,40}(originated from )?outside( of)? (the|your|our) organi[sz]ation.*$/i,
  /^\[?external( email| sender)?\]?\s*$/i,
  /^this (email|message) originated from outside.*$/i,
  /^you don'?t often get email from .*learn why this is important.*$/i,
];

function stripQuotedHistory(lines: string[]): string[] {
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim();
    if (HISTORY_MARKERS.some((re) => re.test(line))) return lines.slice(0, i);
    // Two-line "On Mon, Jan 1, 2026 at 9:00 AM Name <x@y>\nwrote:" (Gmail wraps long attributions).
    if (/^on\s.{3,200}$/i.test(line) && /^.{0,120}wrote:\s*$/i.test((lines[i + 1] ?? '').trim()) && line.length > 12) {
      return lines.slice(0, i);
    }
    if (HEADER_FROM.test(line)) {
      const window = lines.slice(i + 1, i + 6).map((l) => l.trim());
      if (window.filter((l) => HEADER_FOLLOW.test(l)).length >= 2) return lines.slice(0, i);
    }
  }
  return lines;
}

function stripFooters(lines: string[]): string[] {
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim();
    // Never cut the very first line: a message that is only a footer keeps its text.
    if (i > 0 && FOOTER_MARKERS.some((re) => re.test(line))) return lines.slice(0, i);
  }
  return lines;
}

/** Remove quoted lines ("> ..."), banners and other single-line noise. */
function dropNoiseLines(lines: string[]): string[] {
  return lines.filter((raw) => {
    const line = raw.trim();
    if (line.startsWith('>')) return false;
    return !BANNERS.some((re) => re.test(line));
  });
}

/** Very small HTML-to-text for bodies Graph returns as HTML despite the Prefer header. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[​-‍﻿]/g, '')
    .replace(/[\t  ]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function capText(text: string, max: number = LIMITS.maxEmailBodyChars): string {
  if (text.length <= max) return text;
  const marker = '\n[…truncated]';
  return `${text.slice(0, max - marker.length)}${marker}`;
}

/** Apply the fallback stripper to plain text, then normalize and cap. */
export function cleanBodyText(text: string, max: number = LIMITS.maxEmailBodyChars): string {
  let lines = normalizeWhitespace(text).split('\n');
  lines = stripQuotedHistory(lines);
  lines = dropNoiseLines(lines);
  lines = stripFooters(lines);
  return capText(normalizeWhitespace(lines.join('\n')), max);
}

function asText(part: BodySource['body']): string {
  const content = part?.content ?? '';
  if (!content) return '';
  return part?.contentType?.toLowerCase() === 'html' ? htmlToText(content) : content;
}

/** Sanitized new-content text of a Graph message: uniqueBody first, body as fallback. */
export function sanitizeBody(source: BodySource, max: number = LIMITS.maxEmailBodyChars): string {
  const unique = cleanBodyText(asText(source.uniqueBody), max);
  if (unique) return unique;
  return cleanBodyText(asText(source.body), max);
}

/** Short single-line excerpt for FilteredMail / closedByReply. */
export function excerpt(text: string, max = 500): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
