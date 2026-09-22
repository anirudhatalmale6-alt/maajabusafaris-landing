/*
 * Maajabu Safaris - enquiry form handler
 *
 * Receives the enquiry form POST from maajabusafaris.com and sends the
 * enquiry to your Zoho inbox through Amazon SES (eu-west-1).
 *
 * No dependencies - everything, including AWS request signing, is plain
 * JavaScript using the browser crypto built into Cloudflare Workers.
 *
 * ---------------------------------------------------------------------
 * SETUP - Worker > Settings > Variables and Secrets. Add as SECRET
 * (encrypted), not plain text:
 *
 *   AWS_ACCESS_KEY_ID       your IAM access key id
 *   AWS_SECRET_ACCESS_KEY   your IAM secret access key
 *
 * These are the IAM keys, NOT the SMTP username/password. Create them at
 * IAM > Users > Add user, attach the AmazonSESFullAccess policy, then
 * Security credentials > Create access key.
 * ---------------------------------------------------------------------
 */

const REGION   = 'eu-west-1';
const SERVICE  = 'ses';
const MAIL_TO  = 'account@maajabusafaris.com';   // where enquiries land
const MAIL_FROM = 'account@maajabusafaris.com';  // must be on the verified domain
const ALLOW_ORIGIN = 'https://maajabusafaris.com';

// Auto-acknowledgement to the traveller. Enabled 20 Sep 2026, when SES
// production access was granted - in sandbox this would have failed, because
// sandbox only permits sending to verified addresses.
const SEND_ACKNOWLEDGEMENT = true;

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    if (request.method !== 'POST') return cors(json({ error: 'Method not allowed' }, 405));

    let form;
    try {
      const ct = request.headers.get('content-type') || '';
      form = ct.includes('application/json')
        ? await request.json()
        : Object.fromEntries((await request.formData()).entries());
    } catch {
      return cors(json({ error: 'Could not read the form data' }, 400));
    }

    // --- validation -------------------------------------------------------
    const name    = str(form.name).slice(0, 200);
    const email   = str(form.email).slice(0, 320);
    const message = str(form.message).slice(0, 5000);
    const travellers = str(form.travellers).slice(0, 20);
    const dates      = str(form.dates).slice(0, 100);
    const interest   = str(form.interest).slice(0, 100);

    if (!name || !email) return cors(json({ error: 'Name and email are required' }, 400));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return cors(json({ error: 'That email address does not look right' }, 400));
    }
    // Honeypot: real people leave this hidden field empty, bots fill it in.
    if (str(form.website)) return cors(json({ ok: true }));

    if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
      console.error('AWS credentials missing from Worker secrets');
      return cors(json({ error: 'Server is not configured yet' }, 500));
    }

    const subject = `Safari enquiry - ${name}`;
    const lines = [
      `Name:       ${name}`,
      `Email:      ${email}`,
      `Travellers: ${travellers || '-'}`,
      `Dates:      ${dates || '-'}`,
      `Interest:   ${interest || '-'}`,
      '',
      'Message:',
      message || '(none)',
      '',
      '--',
      `Sent from the enquiry form at ${ALLOW_ORIGIN}`,
    ];

    try {
      await sesSend(env, {
        from: `Maajabu Safaris website <${MAIL_FROM}>`,
        to: [MAIL_TO],
        replyTo: [email],           // hit reply and it goes to the traveller
        subject,
        text: lines.join('\n'),
      });

      if (SEND_ACKNOWLEDGEMENT) {
        await sesSend(env, {
          from: `Maajabu Safaris <${MAIL_FROM}>`,
          to: [email],
          subject: 'We have your safari enquiry',
          text: [
            `Hello ${name},`,
            '',
            'Thanks for getting in touch. We have your enquiry and will come back',
            'to you personally within 24 working hours with a draft itinerary.',
            '',
            'Maajabu Safaris',
          ].join('\n'),
        });
      }

      return cors(json({ ok: true }));
    } catch (err) {
      console.error('SES send failed:', err.message);
      return cors(json({ error: 'Could not send right now. Please email us directly.' }, 502));
    }
  },
};

/* ------------------------------------------------------------------ SES */

async function sesSend(env, { from, to, replyTo, subject, text }) {
  const body = JSON.stringify({
    FromEmailAddress: from,
    Destination: { ToAddresses: to },
    ...(replyTo ? { ReplyToAddresses: replyTo } : {}),
    Content: {
      Simple: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: { Text: { Data: text, Charset: 'UTF-8' } },
      },
    },
  });

  const res = await signedFetch(env, {
    method: 'POST',
    host: `email.${REGION}.amazonaws.com`,
    path: '/v2/email/outbound-emails',
    body,
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`SES ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res;
}

/* -------------------------------------------------- AWS SigV4 signing */

async function signedFetch(env, { method, host, path, body }) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');  // 20260919T112233Z
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = await sha256Hex(body);
  const canonicalHeaders =
    `content-type:application/json\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    method,
    path,
    '',                       // no query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const signature = await deriveSignature(
    env.AWS_SECRET_ACCESS_KEY, dateStamp, REGION, SERVICE, stringToSign
  );

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${env.AWS_ACCESS_KEY_ID}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(`https://${host}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Amz-Date': amzDate,
      'X-Amz-Content-Sha256': payloadHash,
      Authorization: authorization,
    },
    body,
  });
}

export async function deriveSignature(secret, dateStamp, region, service, stringToSign) {
  let key = await hmac(enc(`AWS4${secret}`), dateStamp);
  key = await hmac(key, region);
  key = await hmac(key, service);
  key = await hmac(key, 'aws4_request');
  return hex(await hmac(key, stringToSign));
}

/* --------------------------------------------------------------- crypto */

const enc = s => new TextEncoder().encode(s);

async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc(data)));
}

async function sha256Hex(data) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc(data))));
}

const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');

/* ---------------------------------------------------------------- utils */

const str = v => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function cors(res) {
  res.headers.set('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  res.headers.set('Access-Control-Max-Age', '86400');
  return res;
}
