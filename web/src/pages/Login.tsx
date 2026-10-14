import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.ts';

export function Login() {
  const qc = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => api.login(username, password),
    onSuccess: (me) => qc.setQueryData(['me'], me),
  });

  return (
    <main className="login">
      <form
        className="ticket"
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate();
        }}
      >
        <h1 className="ticket-title">CineRadar</h1>
        <p className="ticket-sub">Entre para ver a sua programação.</p>
        <label className="field">
          <span className="field-label">Usuário</span>
          <input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">Senha</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {login.error && (
          <p className="error" role="alert">
            {login.error.message}
          </p>
        )}
        <button type="submit" className="btn btn-primary wide" disabled={login.isPending}>
          {login.isPending ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}
