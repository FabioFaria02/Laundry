# 🧺 Money Laundry — reservas da lavandaria da casa

Web app (PWA) para as 18 pessoas da casa reservarem a **máquina de lavar (máquina 2)** e a **máquina de secar (máquina 1)**.
Funciona em iPhone e Android — abre-se no browser e pode ser adicionada ao ecrã inicial como se fosse uma app.

## O que faz

- **Estado em tempo real** de cada máquina: livre / em uso, por quem e quantos minutos faltam.
- **Próximas reservas** de toda a casa e **as minhas reservas**.
- **Horário do dia** (14 dias à frente): toca numa hora livre para reservar.
- **Usar agora** com um toque, e **"Secar logo a seguir"** reserva a secadora quando acaba a lavagem.
- Máximo **2 h por reserva** (50 CZK = 2 h, como diz a senhoria), sem sobreposições.
- **"Já acabei"** liberta a máquina mais cedo.
- **Editar** as tuas reservas (dia, hora, duração) e **acertar o tempo restante** com os minutos do visor da máquina.
- Ao **cancelar**, pergunta se queres cancelar também a reserva da outra máquina no mesmo dia.
- **Acertar tempo restante**: metes os minutos do visor e a reserva estende/encurta (mantém a hora de início).
- **Notificações** (sino no topo, ligadas por defeito), só para a pessoa escolhida no telemóvel:
  ~10 min antes de começar e ~5–10 min antes de acabar. Com a app fechada chegam por push (ver secção 4).
- **Adicionar ao calendário** (.ics) com lembrete 10 min antes e no fim do programa.
- Inglês e português (botão EN/PT), modo escuro automático.
- Regras da lavandaria (moedas de 50 CZK, portas entreabertas).

Na primeira vez cada pessoa escolhe o seu nome (fica guardado no telemóvel).

## 1. Ligar a base de dados partilhada (Firebase, grátis, ~5 min)

Sem isto a app funciona em **modo demo** (cada telemóvel só vê as suas reservas).

1. Vai a <https://console.firebase.google.com> → **Adicionar projeto** (podes desligar o Analytics).
2. **Build → Firestore Database → Criar base de dados** → escolhe a localização `eur3 (europe-west)` → modo de produção.
3. Separador **Regras**: cola o conteúdo de [`firestore.rules`](firestore.rules) e **Publicar**.
4. Página inicial do projeto → ícone **Web `</>`** → regista a app → copia o objeto `firebaseConfig`.
5. Cola-o em [`config.js`](config.js) em vez de `null`:
   ```js
   export const FIREBASE_CONFIG = { apiKey: "...", authDomain: "...", projectId: "...", ... };
   ```
   (Estas chaves são públicas por natureza — a proteção são as regras do passo 3.)

## 2. Pôr online (GitHub Pages)

Settings → Pages → Source: **Deploy from a branch** → branch `ccr-b2c91620-hm23d6`, pasta `/ (root)`.
Cada push publica sozinho em <https://fabiofaria02.github.io/Laundry/>. Partilha esse link no grupo da casa.

## 3. Instalar no telemóvel

- **iPhone (Safari):** botão Partilhar → **Adicionar ao ecrã principal**.
- **Android (Chrome):** menu ⋮ → **Instalar app** / **Adicionar ao ecrã inicial**.

## 4. Notificações com a app fechada (Web Push)

O workflow [`reminders.yml`](.github/workflows/reminders.yml) corre de 5 em 5 minutos e envia os avisos
com [`push/send.mjs`](push/send.mjs). Configuração (uma vez):

1. Firebase → Firestore → **Regras**: cola o [`firestore.rules`](firestore.rules) atualizado → **Publicar**.
2. GitHub → Settings → **Secrets and variables → Actions → New repository secret**:
   nome `VAPID_PRIVATE_KEY`, valor = chave privada (a pública está em `config.js`).
3. Actions → **Booking reminders** → **Run workflow** para testar.

Notas: o GitHub atrasa por vezes estes workflows alguns minutos; desativa-os se o repositório
não tiver atividade durante 60 dias (basta reativar em Actions). No iPhone só funciona com a app
no ecrã principal (iOS 16.4+).

## Pessoas

Fábio, Alina, Filipa, Francisco, Inês, Laura, Anna R., Anna N., Aslı, Charlélie, Clara, Maria, Martyna, Mimi, Ourania, Sudenaz, Umer, Veve.
Para mudar, edita a lista `PEOPLE` no topo de [`app.js`](app.js).

## Notas

- Não há login: qualquer pessoa com o link pode reservar. Para uma casa chega; não partilhes o link fora do grupo.
- Ficheiros: `index.html`, `styles.css`, `app.js` (interface), `store.js` (Firebase / modo local), `i18n.js` (textos EN/PT), `sw.js` (offline).
- Testar localmente: `python3 -m http.server` e abrir <http://localhost:8000>.
