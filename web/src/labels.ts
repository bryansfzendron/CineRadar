import type { ItemStatus, ReleaseLanguage } from '../../shared/types.ts';

export const STATUS_LABEL: Record<ItemStatus, string> = {
  wanted: 'Procurando',
  searching: 'Buscando agora',
  found: 'Encontrado em português',
  sent: 'Enviado para baixar',
  downloading: 'Baixando',
  available: 'Em cartaz',
  error: 'Com problema',
};

export const LANGUAGE_LABEL: Record<ReleaseLanguage, string> = {
  dual: 'Dual áudio',
  dublado: 'Dublado',
  ptbr: 'PT-BR',
  multi: 'Dual (idioma?)',
  legendado: 'Legendado',
  none: 'Sem português',
};

export function formatSize(bytes: number): string {
  if (!bytes) return '—';
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(gb >= 10 ? 0 : 1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

export function timeAgo(iso: string | null): string {
  if (!iso) return 'nunca';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'agora';
  if (diff < 3600) return `há ${Math.round(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.round(diff / 3600)} h`;
  return `há ${Math.round(diff / 86400)} d`;
}
