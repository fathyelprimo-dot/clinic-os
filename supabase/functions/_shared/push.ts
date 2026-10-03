// Explicit provider allowlist prevents an untrusted subscription becoming an SSRF target.
export function validPushSubscription(value: unknown) {
  const s = value as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  try {
    const url = new URL(s.endpoint || '');
    return url.protocol === 'https:' && !url.port && !url.username && !url.password &&
      (['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(url.hostname) ||
        /^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname)) &&
      (s.endpoint || '').length < 2048 && /^[A-Za-z0-9_-]{87}$/.test(s.keys?.p256dh || '') &&
      /^[A-Za-z0-9_-]{22}$/.test(s.keys?.auth || '');
  } catch { return false; }
}

export async function hash(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

export async function limitHash(value: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
