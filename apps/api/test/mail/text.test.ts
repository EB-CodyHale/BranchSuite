import { LIMITS } from '@branchsuite/shared';
import { describe, expect, it } from 'vitest';
import { prefilter } from '../../src/mail/prefilter.js';
import { cleanBodyText, htmlToText, sanitizeBody } from '../../src/mail/sanitize.js';

const base = { fromAddress: 'dana.whitfield@northwind.example.com', subject: 'Need pickers', body: 'Need 3 pickers Monday', headers: [] };

describe('prefilter', () => {
  it('passes a normal client message', () => {
    expect(prefilter(base)).toBeNull();
  });

  it.each([
    ['Automatic reply: Out of office', 'automatic reply'],
    ['AUTO: Away until Monday', 'auto:'],
    ['Out of Office until 3/14', 'out of office'],
    ['Undeliverable: Need pickers', 'undeliverable'],
    ['Delivery Status Notification (Failure)', 'delivery status notification'],
    ['Mail delivery failed: returning message to sender', 'mail delivery failed'],
  ])('filters subject "%s"', (subject, prefix) => {
    expect(prefilter({ ...base, subject })?.reason).toContain(prefix);
  });

  it('filters Auto-Submitted unless its value is "no"', () => {
    expect(prefilter({ ...base, headers: [{ name: 'auto-submitted', value: 'auto-replied' }] })?.reason).toMatch(/Auto-Submitted/);
    expect(prefilter({ ...base, headers: [{ name: 'Auto-Submitted', value: 'no' }] })).toBeNull();
  });

  it('filters X-Auto-Response-Suppress and bulk precedence', () => {
    expect(prefilter({ ...base, headers: [{ name: 'X-Auto-Response-Suppress', value: 'All' }] })).not.toBeNull();
    expect(prefilter({ ...base, headers: [{ name: 'Precedence', value: 'bulk' }] })).not.toBeNull();
  });

  it.each(['noreply@x.example.com', 'no-reply@x.example.com', 'donotreply@x.example.com', 'do-not-reply@x.example.com', 'MAILER-DAEMON@x.example.com', 'postmaster@x.example.com'])(
    'filters system sender %s',
    (fromAddress) => {
      expect(prefilter({ ...base, fromAddress })?.reason).toBe('No-reply or system sender');
    },
  );

  it('keeps senders that only contain "reply" in their name', () => {
    expect(prefilter({ ...base, fromAddress: 'replyteam@x.example.com' })).toBeNull();
  });

  it('filters empty subject plus empty body, but not one of them alone', () => {
    expect(prefilter({ ...base, subject: ' ', body: '' })?.reason).toBe('Empty message');
    expect(prefilter({ ...base, subject: '', body: 'Call me' })).toBeNull();
  });
});

describe('sanitizer', () => {
  it('prefers uniqueBody over body', () => {
    expect(sanitizeBody({ uniqueBody: { contentType: 'text', content: 'New part' }, body: { contentType: 'text', content: 'New part\n> old' } })).toBe('New part');
  });

  it('falls back to body when uniqueBody is empty', () => {
    expect(sanitizeBody({ uniqueBody: { content: '' }, body: { contentType: 'text', content: 'Body text' } })).toBe('Body text');
  });

  it('strips "On ... wrote:" history, including Gmail\'s wrapped attribution', () => {
    expect(cleanBodyText('Sounds good.\n\nOn Mon, Mar 9, 2026 at 9:00 AM Dana <d@x.example.com> wrote:\n> earlier')).toBe('Sounds good.');
    expect(cleanBodyText('Yes please.\nOn Mon, Mar 9, 2026 at 9:00 AM Dana Whitfield <dana@x.example.com>\nwrote:\nold text')).toBe('Yes please.');
  });

  it('strips Outlook "Original Message" and From/Sent/To/Subject header blocks', () => {
    expect(cleanBodyText('Approved.\n-----Original Message-----\nFrom: A\nold')).toBe('Approved.');
    const outlook = 'Please send two more.\n\nFrom: Dana Whitfield <dana@x.example.com>\nSent: Monday, March 9, 2026 9:00 AM\nTo: Branch <b@x.example.com>\nSubject: RE: pickers\n\nolder message';
    expect(cleanBodyText(outlook)).toBe('Please send two more.');
  });

  it('keeps a single "From:" line that is not a header block', () => {
    expect(cleanBodyText('From: the dock team we need gloves.\nThanks')).toContain('From: the dock team');
  });

  it('removes quoted lines, mobile footers, signatures, disclaimers and external banners', () => {
    const text = [
      'CAUTION: This email originated from outside the organization. Do not click links.',
      'Need 2 forklift drivers tomorrow.',
      '> quoted line',
      '',
      'Get Outlook for iOS',
      'more footer',
    ].join('\n');
    expect(cleanBodyText(text)).toBe('Need 2 forklift drivers tomorrow.');
    expect(cleanBodyText('Call me.\n-- \nDana Whitfield\nOps Lead')).toBe('Call me.');
    expect(cleanBodyText('Call me.\nCONFIDENTIALITY NOTICE: this email is private')).toBe('Call me.');
    expect(cleanBodyText('Hi\nSent from my iPhone')).toBe('Hi');
  });

  it('normalizes whitespace and caps the text', () => {
    expect(cleanBodyText('a\t\t b\r\n\r\n\r\n\r\nc  ')).toBe('a b\n\nc');
    const long = 'x'.repeat(LIMITS.maxEmailBodyChars + 500);
    const out = cleanBodyText(long);
    expect(out.length).toBe(LIMITS.maxEmailBodyChars);
    expect(out.endsWith('[…truncated]')).toBe(true);
  });

  it('converts HTML bodies to text', () => {
    expect(cleanBodyText(htmlToText('<p>Hi&nbsp;there</p><br><style>.a{}</style><b>3</b> &amp; more'))).toBe('Hi there\n\n3 & more');
    expect(sanitizeBody({ body: { contentType: 'html', content: '<div>Need 4 packers</div><blockquote>> old</blockquote>' } })).toBe('Need 4 packers');
  });
});
