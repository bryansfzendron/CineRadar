# CineRadar

Lista de desejos de filmes e séries que procura **versões em português** (dublado, dual áudio, nacional) e entrega ao
Radarr/Sonarr para baixar, acompanhando até o título chegar ao Plex e ao Jellyfin.

- **Lista própria:** busque pelo nome (TMDB, em pt-BR) e marque **Quero ver**.
- **Motor de busca em várias fontes:**
  - a busca interativa do Radarr/Sonarr;
  - o Prowlarr, com todos os indexadores que você cadastrar nele;
  - fontes Torznab extras, como o Jackett;
  - sites brasileiros lidos direto (hoje o **Rede Torrent**): o CineRadar abre a busca e as páginas dos títulos, confere
    pelo IMDb e pergunta os seeders aos trackers, já que o site não mostra.
- **Leitura dos releases:** detecta dublado, dual áudio, legendado, resolução, origem (WEB-DL, BluRay, CAM…), codec e
  temporada. Dá uma nota de 0 a 100 e descarta releases de outro título.
- **Envio automático com limite:** acima da nota mínima (e com seeders, tamanho e áudio em português), baixa sozinho;
  abaixo, espera você aprovar.
- **Acompanhamento:** fila do Radarr/Sonarr (progresso), webhooks e bibliotecas do Plex e do Jellyfin. Mostra
  "Em cartaz" com links para abrir em cada um.
- **Interface:** cartazes de cinema, Filmes e Séries separados, prateleiras por situação; funciona no celular.
- **Login** com usuário e senha, para acessar também de fora de casa.

## Como funciona

```
Quero ver ──► busca (Radarr/Sonarr + Prowlarr + Torznab + sites BR) ──► idioma/qualidade ──► nota
     │                                                                             │
     │                     nota ≥ limite e áudio PT ◄──────────────────────────────┤
     │                              │                                              │
     │            grab/push no Radarr/Sonarr ──► qBittorrent ──► import ──► Plex/Jellyfin
     │                                                                             │
     └── abaixo do limite: "Achados em português", você escolhe a versão ◄─────────┘
```

O CineRadar cadastra o filme ou a série no Radarr/Sonarr **sem monitorar**. Assim o RSS deles não baixa sozinho uma
versão sem português; quem escolhe o release é o CineRadar. Se o Radarr/Sonarr recusar um release vindo de fora e o
qBittorrent estiver configurado, o torrent vai direto para ele (categoria `cineradar`). Ao terminar, o CineRadar pede a
importação manual ao Radarr/Sonarr.

## Instalação (Docker)

```bash
git clone https://github.com/bryansfzendron/CineRadar.git /opt/cineradar
cd /opt/cineradar
cp .env.example .env    # preencha as chaves
docker compose up -d --build
```

Abra `http://<servidor>:7575` e entre com `CINERADAR_ADMIN_USER` / `CINERADAR_ADMIN_PASSWORD`.

**Atualizar:** `git pull && docker compose up -d --build`.

### Depois de instalar

1. **Webhooks:** em Ajustes aparecem os endereços. No Radarr e no Sonarr, vá em Configurações › Conectar › Webhook,
   marque "Ao baixar" e "Ao importar" e cole o endereço.
2. **Indexadores brasileiros no Prowlarr:** sem eles, quase tudo que aparece é em inglês. Os que você adicionar no
   Prowlarr entram no CineRadar sozinhos (Ajustes › Indexadores mostra quais estão funcionando).
3. **Sites brasileiros:** mudam de domínio com frequência. Em Ajustes › Sites brasileiros dá para trocar o endereço,
   e em Conexões aparece se o site está respondendo. Para incluir outro site, crie um leitor em
   `server/integrations/sites/` (um `SiteScraper`) e registre em `sites/index.ts`.
4. **Acesso de fora:** publique a porta 7575 por Tailscale ou por um hostname no Cloudflare Tunnel. O cookie de sessão
   vira `Secure` automaticamente atrás de HTTPS.

## Desenvolvimento

```bash
npm install
cp .env.example .env
npm run dev        # servidor em :7575
npm run dev:web    # interface em :5173 (proxy para a API)
npm test           # parser PT-BR e nota
```

Node 24+ (usa o `node:sqlite` embutido, sem dependências nativas).

## Segurança

- Senhas com scrypt; sessão em cookie HttpOnly guardado como hash; login limitado a 8 tentativas a cada 5 minutos.
- Pedidos que alteram dados exigem a mesma origem (contra CSRF). Os webhooks usam um token próprio.
- As chaves das integrações ficam só no `.env` do servidor; a interface nunca recebe chaves nem links de download.
