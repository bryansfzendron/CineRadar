import crypto, { X509Certificate } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as F from './fixtures.ts';
import { certUrlOk, rejectReason, signatureOk, splitPem, timestampOk, verifyCertChain } from './verify.ts';

const roots = [new X509Certificate(F.ROOT)];
const chain = F.LEAF + F.INTERMEDIATE;
const now = Date.now();

describe('certUrlOk (exemplos da documentação da Alexa)', () => {
  it.each([
    ['https://s3.amazonaws.com/echo.api/echo-api-cert.pem', true],
    ['https://s3.amazonaws.com:443/echo.api/echo-api-cert.pem', true],
    ['HTTPS://s3.AMAZONAWS.com/echo.api/echo-api-cert.pem', true],
    ['https://s3.amazonaws.com/echo.api/../echo.api/echo-api-cert.pem', true],
    ['http://s3.amazonaws.com/echo.api/echo-api-cert.pem', false],
    ['https://notamazon.com/echo.api/echo-api-cert.pem', false],
    ['https://s3.amazonaws.com/EcHo.aPi/echo-api-cert.pem', false],
    ['https://s3.amazonaws.com/invalid.path/echo-api-cert.pem', false],
    ['https://s3.amazonaws.com:563/echo.api/echo-api-cert.pem', false],
    ['https://s3.amazonaws.com/echo.api/../invalid.path/cert.pem', false],
    ['https://user@s3.amazonaws.com/echo.api/echo-api-cert.pem', false],
    ['https://s3.amazonaws.com/echo.api/', false],
    ['não é url', false],
  ])('%s → %s', (url, ok) => {
    expect(certUrlOk(url)).toBe(ok);
  });
});

describe('timestampOk', () => {
  const t = Date.parse('2026-11-11T14:00:00Z');
  it('aceita até 150 s de diferença', () => {
    expect(timestampOk('2026-11-11T14:00:00Z', t)).toBe(true);
    expect(timestampOk('2026-11-11T13:57:30Z', t)).toBe(true);
    expect(timestampOk('2026-11-11T14:02:30Z', t)).toBe(true);
  });
  it('recusa fora da janela ou sem data', () => {
    expect(timestampOk('2026-11-11T13:57:29Z', t)).toBe(false);
    expect(timestampOk('2026-11-11T14:03:00Z', t)).toBe(false);
    expect(timestampOk('', t)).toBe(false);
  });
});

describe('verifyCertChain', () => {
  it('separa a cadeia', () => {
    expect(splitPem(chain)).toHaveLength(2);
  });
  it('aceita folha + intermediária até a raiz confiável', () => {
    expect(verifyCertChain(chain, now, roots)).not.toBeNull();
  });
  it('aceita a cadeia que já traz a raiz', () => {
    expect(verifyCertChain(chain + F.ROOT, now, roots)).not.toBeNull();
  });
  it('recusa sem a intermediária', () => {
    expect(verifyCertChain(F.LEAF, now, roots)).toBeNull();
  });
  it('recusa raiz que não é a que assinou', () => {
    expect(verifyCertChain(chain, now, [new X509Certificate(F.OTHER_ROOT)])).toBeNull();
    expect(verifyCertChain(chain, now, [])).toBeNull();
  });
  it('recusa certificado de outro site', () => {
    expect(verifyCertChain(F.OTHER_SAN_LEAF + F.INTERMEDIATE, now, roots)).toBeNull();
  });
  it('recusa emissor que não é CA', () => {
    expect(verifyCertChain(F.LEAF_FROM_NON_CA + F.NON_CA_ISSUER, now, roots)).toBeNull();
  });
  it('recusa fora do prazo', () => {
    const leaf = new X509Certificate(F.LEAF);
    expect(verifyCertChain(chain, Date.parse(leaf.validFrom) - 86_400_000, roots)).toBeNull();
    expect(verifyCertChain(chain, Date.parse(leaf.validTo) + 86_400_000, roots)).toBeNull();
  });
  it('recusa lixo', () => {
    expect(verifyCertChain('não é pem', now, roots)).toBeNull();
    expect(verifyCertChain('-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----', now, roots)).toBeNull();
  });
});

describe('signatureOk', () => {
  const key = verifyCertChain(chain, now, roots)!;
  const body = '{"version":"1.0","request":{"type":"LaunchRequest"}}';
  const sign = (pem: string, text = body) => crypto.sign('sha256', Buffer.from(text), pem).toString('base64');

  it('confere a assinatura do corpo', () => {
    expect(signatureOk(body, sign(F.LEAF_KEY), key)).toBe(true);
  });
  it('recusa corpo mexido, outra chave e lixo', () => {
    expect(signatureOk(`${body} `, sign(F.LEAF_KEY), key)).toBe(false);
    expect(signatureOk(body, sign(F.OTHER_SAN_KEY), key)).toBe(false);
    expect(signatureOk(body, '***', key)).toBe(false);
    expect(signatureOk(body, '', key)).toBe(false);
  });
});

describe('rejectReason', () => {
  const skillId = 'amzn1.ask.skill.teste';
  const certUrl = 'https://s3.amazonaws.com/echo.api/echo-api-cert.pem';
  const envelope = (over: Record<string, unknown> = {}) => ({
    version: '1.0',
    context: { System: { application: { applicationId: skillId }, user: { userId: 'amzn1.ask.account.dono' } } },
    request: { type: 'LaunchRequest', timestamp: new Date(now).toISOString() },
    ...over,
  });
  // A cadeia "baixada do S3" vem do cache falso, e a raiz confiável é a de mentira.
  const certs = { get: async () => chain };
  const check = async (env: ReturnType<typeof envelope>, cfg = { skillId, userIds: [] as string[] }, sigKey = F.LEAF_KEY) => {
    const body = JSON.stringify(env);
    const signature = crypto.sign('sha256', Buffer.from(body), sigKey).toString('base64');
    return rejectReason(body, env, { certUrl, signature }, cfg, certs, now, roots);
  };

  it('aceita o pedido assinado da nossa skill', async () => {
    expect(await check(envelope())).toBeNull();
  });
  it('recusa sem skill configurada', async () => {
    expect(await check(envelope(), { skillId: '', userIds: [] })).toBe('skill não configurada');
  });
  it('recusa outra skill', async () => {
    const env = envelope({ context: { System: { application: { applicationId: 'amzn1.ask.skill.outra' } } } });
    expect(await check(env)).toBe('skill desconhecida');
  });
  it('recusa pedido velho', async () => {
    const env = envelope({ request: { type: 'LaunchRequest', timestamp: new Date(now - 200_000).toISOString() } });
    expect(await check(env)).toBe('pedido fora do horário');
  });
  it('recusa assinatura de outra chave', async () => {
    expect(await check(envelope(), undefined, F.OTHER_SAN_KEY)).toBe('assinatura recusada');
  });
  it('recusa URL de certificado que não é da Amazon', async () => {
    const body = JSON.stringify(envelope());
    expect(await rejectReason(body, envelope(), { certUrl: 'https://evil.com/echo.api/x.pem', signature: 'AAAA' }, { skillId, userIds: [] }, certs, now, roots)).toBe(
      'sem assinatura válida',
    );
  });
  it('com lista de usuários, só aceita quem está nela', async () => {
    expect(await check(envelope(), { skillId, userIds: ['amzn1.ask.account.dono'] })).toBeNull();
    expect(await check(envelope(), { skillId, userIds: ['amzn1.ask.account.outro'] })).toBe('usuário da Alexa não autorizado');
  });
});
