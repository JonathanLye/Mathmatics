import { createHmac, timingSafeEqual } from 'node:crypto';

// 预览令牌（06 §4.2）：60 秒有效，绑定作答、目标层级与状态版本。
// 签名密钥由服务端密钥派生，不能由客户端伪造。claim 时仍会用引擎重新检查门槛，令牌里的内容只用于比对，不直接决定是否下发。
export const PREVIEW_TTL_MS = 60_000;

export interface PreviewClaims {
  attemptId: string;
  level: string;
  stateVersion: number;
  expiresAt: number;
}

function macKey(secret: string): Buffer {
  return createHmac('sha256', secret).update('preview-token-v1').digest();
}

function mac(secret: string, body: string): string {
  return createHmac('sha256', macKey(secret)).update(body).digest('base64url');
}

export function signPreview(secret: string, claims: PreviewClaims): string {
  const body = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return `pt_${body}.${mac(secret, body)}`;
}

// 签名、格式、过期任一不通过都返回 null。不说明是哪一项失败（不给攻击者反馈）。
export function verifyPreview(secret: string, token: string, now: number): PreviewClaims | null {
  if (!token.startsWith('pt_')) return null;
  const [body, signature] = token.slice(3).split('.');
  if (!body || !signature) return null;
  const expected = Buffer.from(mac(secret, body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const claims = parsed as Partial<PreviewClaims>;
  if (
    typeof claims.attemptId !== 'string' ||
    typeof claims.level !== 'string' ||
    typeof claims.stateVersion !== 'number' ||
    typeof claims.expiresAt !== 'number'
  ) {
    return null;
  }
  if (claims.expiresAt <= now) return null;
  return claims as PreviewClaims;
}
