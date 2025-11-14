import crypto from 'crypto';

function getKey() {
  const secret = process.env.CRED_ENCRYPTION_KEY || process.env.CRED_ENC_KEY || 'dev_cred_key_change_me';
  return crypto.createHash('sha256').update(String(secret)).digest(); // 32 bytes
}

export function encryptSecret(plain) {
  if (!plain) return null;
  const iv = crypto.randomBytes(12);
  const key = getKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(enc) {
  if (!enc) return null;
  try {
    if (enc.startsWith('v1:')) {
      const [, ivb64, tagb64, ctb64] = enc.split(':');
      const iv = Buffer.from(ivb64, 'base64');
      const tag = Buffer.from(tagb64, 'base64');
      const ct = Buffer.from(ctb64, 'base64');
      const key = getKey();
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
      return dec.toString('utf8');
    }
    return null;
  } catch {
    return null;
  }
}

