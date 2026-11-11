// O pedido veio mesmo da Amazon? A rota /alexa fica aberta na internet (pelo túnel da Cloudflare) e sem
// login: o que a protege é a assinatura que a Alexa põe em todo pedido. Regras da documentação da Alexa
// para skills hospedadas fora da Lambda.

import crypto, { X509Certificate } from 'node:crypto';
import tls from 'node:tls';

/** Tolerância do carimbo de tempo do pedido, como a Amazon exige: 150 s. */
export const TIMESTAMP_TOLERANCE_MS = 150_000;

/**
 * A URL do certificado é da Amazon? https, host s3.amazonaws.com (sem diferenciar maiúsculas), porta 443
 * se vier, e caminho começando com /echo.api/ (diferenciando) depois de resolver "..".
 */
export function certUrlOk(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== 's3.amazonaws.com') return false;
  if (u.port !== '' && u.port !== '443') return false;
  if (u.username || u.password) return false;
  // O URL já resolve "." e ".."; o caminho precisa ficar dentro de /echo.api/.
  const parts = u.pathname.split('/').filter(Boolean);
  return parts[0] === 'echo.api' && parts.length > 1;
}

export function timestampOk(timestamp: string, now: number): boolean {
  const t = Date.parse(timestamp);
  return Number.isFinite(t) && Math.abs(now - t) <= TIMESTAMP_TOLERANCE_MS;
}

export function splitPem(pem: string): string[] {
  return pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
}

function inValidity(c: X509Certificate, now: number): boolean {
  return now >= Date.parse(c.validFrom) && now <= Date.parse(c.validTo);
}

let systemRoots: X509Certificate[] | null = null;
function defaultRoots(): X509Certificate[] {
  systemRoots ??= tls.rootCertificates.map((p) => new X509Certificate(p));
  return systemRoots;
}

/**
 * Valida a cadeia e devolve a chave pública do certificado da Amazon, ou null em qualquer dúvida. A folha
 * tem de estar no prazo, ter echo-api.amazon.com no SAN e fechar uma cadeia até uma CA raiz confiável,
 * com cada emissor sendo uma CA.
 */
export function verifyCertChain(pem: string, now: number, roots: X509Certificate[] = defaultRoots()): crypto.KeyObject | null {
  let certs: X509Certificate[];
  try {
    certs = splitPem(pem).map((p) => new X509Certificate(p));
  } catch {
    return null;
  }
  const leaf = certs[0];
  if (!leaf || !roots.length) return null;
  const san = (leaf.subjectAltName ?? '').split(',').map((s) => s.trim());
  if (!san.includes('DNS:echo-api.amazon.com')) return null;
  if (!certs.every((c) => inValidity(c, now))) return null;

  for (let i = 0; i < certs.length - 1; i++) {
    const child = certs[i]!;
    const issuer = certs[i + 1]!;
    if (!issuer.ca || !child.checkIssued(issuer) || !child.verify(issuer.publicKey)) return null;
  }
  const top = certs[certs.length - 1]!;
  const anchored = roots.some(
    (r) => r.fingerprint256 === top.fingerprint256 || (r.ca && inValidity(r, now) && top.checkIssued(r) && top.verify(r.publicKey)),
  );
  return anchored ? leaf.publicKey : null;
}

export function signatureOk(body: string, signatureB64: string, key: crypto.KeyObject): boolean {
  if (!signatureB64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(signatureB64)) return false;
  try {
    return crypto.verify('sha256', Buffer.from(body, 'utf8'), key, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}

/** Baixa e guarda a cadeia da Amazon: é a mesma em todo pedido, e buscar no S3 a cada fala deixaria a resposta lenta. */
export class CertCache {
  private readonly cache = new Map<string, { at: number; pem: string }>();

  async get(url: string): Promise<string | null> {
    const hit = this.cache.get(url);
    if (hit && Date.now() - hit.at < 86_400_000) return hit.pem;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const pem = await res.text();
      if (!splitPem(pem).length) return null;
      this.cache.set(url, { at: Date.now(), pem });
      return pem;
    } catch {
      return null;
    }
  }
}

export interface AlexaAuthConfig {
  skillId: string;
  /** userIds da Alexa aceitos; vazio aceita qualquer um (a skill em desenvolvimento só roda na conta do dono). */
  userIds: string[];
}

/** Motivo da recusa, ou null quando o pedido é autêntico. */
export async function rejectReason(
  body: string,
  parsed: AlexaRequestEnvelope,
  headers: { certUrl: string; signature: string },
  cfg: AlexaAuthConfig,
  certs: Pick<CertCache, 'get'>,
  now = Date.now(),
  roots?: X509Certificate[],
): Promise<string | null> {
  if (!cfg.skillId) return 'skill não configurada';
  if (!headers.certUrl || !headers.signature || !certUrlOk(headers.certUrl)) return 'sem assinatura válida';
  const pem = await certs.get(headers.certUrl);
  const key = pem ? verifyCertChain(pem, now, roots) : null;
  if (!key || !signatureOk(body, headers.signature, key)) return 'assinatura recusada';
  if (!timestampOk(parsed.request?.timestamp ?? '', now)) return 'pedido fora do horário';
  const app = parsed.context?.System?.application?.applicationId ?? parsed.session?.application?.applicationId;
  if (app !== cfg.skillId) return 'skill desconhecida';
  const user = parsed.context?.System?.user?.userId ?? parsed.session?.user?.userId ?? '';
  if (cfg.userIds.length && !cfg.userIds.includes(user)) return 'usuário da Alexa não autorizado';
  return null;
}

export interface AlexaRequestEnvelope {
  session?: {
    new?: boolean;
    attributes?: Record<string, unknown>;
    application?: { applicationId?: string };
    user?: { userId?: string };
  };
  context?: { System?: { application?: { applicationId?: string }; user?: { userId?: string } } };
  request?: {
    type?: string;
    timestamp?: string;
    intent?: { name?: string; slots?: Record<string, { name?: string; value?: string }> };
  };
}
