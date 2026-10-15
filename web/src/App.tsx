import { useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink, Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { api, ApiError } from './api.ts';
import { DetailSheet } from './components/DetailSheet.tsx';
import { Marquee } from './components/Marquee.tsx';
import { Discover } from './pages/Discover.tsx';
import { Library } from './pages/Library.tsx';
import { Login } from './pages/Login.tsx';
import { Owned } from './pages/Owned.tsx';
import { SettingsPage } from './pages/Settings.tsx';

export function App() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false, staleTime: 60_000 });

  if (me.isPending) return <div className="boot" aria-busy="true" />;
  if (me.error instanceof ApiError && me.error.status === 401) return <Login />;
  if (me.error) return <div className="boot boot-error">Não consegui falar com o servidor do CineRadar. Recarregue a página.</div>;

  return <Shell username={me.data.username} />;
}

function Shell({ username }: { username: string }) {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const openId = Number(params.get('item')) || null;

  const items = useQuery({ queryKey: ['items'], queryFn: () => api.items(), refetchInterval: 10_000 });

  async function logout() {
    await api.logout().catch(() => undefined);
    qc.clear();
    qc.setQueryData(['me'], undefined);
    await qc.invalidateQueries({ queryKey: ['me'] });
  }

  const closeDetail = () => {
    params.delete('item');
    setParams(params, { replace: true });
  };

  return (
    <div className="shell">
      <header className="top">
        <Marquee items={items.data ?? []} />
        <nav className="nav" aria-label="Seções">
          <NavLink to="/filmes">Filmes</NavLink>
          <NavLink to="/series">Séries</NavLink>
          <NavLink to="/buscar">Buscar</NavLink>
          <NavLink to="/biblioteca">Biblioteca</NavLink>
          <NavLink to="/ajustes">Ajustes</NavLink>
          <span className="nav-spacer" />
          <button type="button" className="nav-user" onClick={logout} title={`Sair (${username})`}>
            Sair
          </button>
        </nav>
      </header>

      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/filmes" replace />} />
          <Route path="/filmes" element={<Library kind="movie" items={items.data} loading={items.isPending} />} />
          <Route path="/series" element={<Library kind="series" items={items.data} loading={items.isPending} />} />
          <Route path="/buscar" element={<Discover />} />
          <Route path="/biblioteca" element={<Owned />} />
          <Route path="/ajustes" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/filmes" replace />} />
        </Routes>
      </main>

      {openId && <DetailSheet id={openId} onClose={closeDetail} />}
    </div>
  );
}
