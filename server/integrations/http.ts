// fetch com tempo limite e erros legíveis (sem vazar chaves de API nas mensagens).

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly body?: string,
  ) {
    super(message);
  }
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined | null | (string | number)[]>;
  json?: unknown;
  body?: BodyInit;
  timeoutMs?: number;
  /** Nome do serviço para as mensagens de erro. */
  service: string;
}

export function buildUrl(base: string, query?: RequestOptions['query']): string {
  const url = new URL(base);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) for (const item of v) url.searchParams.append(k, String(item));
    else url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function send(url: string, opts: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  let body = opts.body;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.json);
  }
  let res: Response;
  try {
    res = await fetch(buildUrl(url, opts.query), {
      method: opts.method ?? (body ? 'POST' : 'GET'),
      headers,
      body,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    });
  } catch (err) {
    const reason = err instanceof Error && err.name === 'TimeoutError' ? 'tempo esgotado' : 'sem conexão';
    throw new HttpError(`${opts.service}: ${reason}`, null);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const hint = res.status === 401 || res.status === 403 ? 'chave/credencial recusada' : `HTTP ${res.status}`;
    throw new HttpError(`${opts.service}: ${hint}`, res.status, text.slice(0, 2000));
  }
  return res;
}

export async function requestJson<T>(url: string, opts: RequestOptions): Promise<T> {
  const res = await send(url, opts);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export async function requestText(url: string, opts: RequestOptions): Promise<{ text: string; headers: Headers }> {
  const res = await send(url, opts);
  return { text: await res.text(), headers: res.headers };
}

export async function requestBuffer(url: string, opts: RequestOptions): Promise<{ data: Buffer; contentType: string }> {
  const res = await send(url, { ...opts, headers: { Accept: 'image/*,*/*', ...opts.headers } });
  return { data: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') ?? 'application/octet-stream' };
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
