# 🎗️ Sistema de Rifa Beneficente Automática (000 a 600)

Sistema web completo, moderno e responsivo desenvolvido especialmente para rifas e ações solidárias, com suporte a **601 números (000 a 600)**, processamento automático via **PIX no Asaas**, banco de dados em tempo real no **Supabase** e disparo automático de comprovante/agradecimento no **WhatsApp via Evolution API**.

---

## 🚀 Como Iniciar o Projeto

### 1. Pré-requisitos
- Node.js instalado (v18 ou superior).

### 2. Instalação e Execução
Na pasta do projeto (`rifa-beneficente`), execute no terminal:

```bash
# Instalar dependências (caso ainda não tenha feito)
npm install

# Iniciar o servidor
npm start
```

O servidor estará rodando em:
- **Página Principal da Rifa:** [http://localhost:3000](http://localhost:3000)
- **Consulta de Bilhetes Comprados:** [http://localhost:3000/meus-bilhetes.html](http://localhost:3000/meus-bilhetes.html)
- **Painel de Controle Administrativo:** [http://localhost:3000/admin.html](http://localhost:3000/admin.html)
  - **Senha inicial de administrador:** `admin123`

---

## 🗄️ 1. Configurando o Supabase (Banco de Dados)

1. Crie ou acesse seu projeto no [Supabase](https://supabase.com).
2. No menu lateral esquerdo, vá em **SQL Editor** -> **New query**.
3. Abra o arquivo [supabase_schema.sql](file:///C:/Users/diogo/.gemini/antigravity/scratch/rifa-beneficente/supabase_schema.sql), copie todo o seu conteúdo, cole no SQL Editor do Supabase e clique em **Run**.
4. No Supabase, acesse **Project Settings** -> **API**:
   - Copie a **Project URL**
   - Copie a chave **service_role** (recomendado para o backend) ou a **anon public**
5. Preencha no arquivo `.env`:
   ```env
   SUPABASE_URL=https://seu-projeto.supabase.co
   SUPABASE_SERVICE_KEY=sua-service-role-key
   ```

*(Nota: Caso você rode o sistema antes de preencher o Supabase, ele iniciará automaticamente em modo de demonstração com armazenamento em memória, sem travar o sistema).*

---

## 💳 2. Configurando o PIX no Asaas

1. Acesse sua conta no [Asaas](https://www.asaas.com) (ou no Sandbox para testes: [sandbox.asaas.com](https://sandbox.asaas.com)).
2. No menu lateral, acesse **Minha Conta** -> **Integrações** -> **Gerar Chave de API**.
3. Preencha no `.env` ou direto na aba **Configurações & APIs** do [Painel Admin](http://localhost:3000/admin.html):
   ```env
   ASAAS_API_KEY=$aact_...
   ASAAS_ENVIRONMENT=sandbox  # ou production quando for para o ar
   ```
4. **Webhook para Confirmação Instantânea:**
   - No Asaas, acesse **Integrações** -> **Webhooks para Cobranças**.
   - Insira a URL: `https://seu-dominio.com/api/webhooks/asaas`
   - Marque os eventos:
     - `Cobrança recebida` (`PAYMENT_RECEIVED`)
     - `Cobrança confirmada` (`PAYMENT_CONFIRMED`)
   - Se desejar cadastrar um Token de autenticação de webhook, informe no campo `ASAAS_WEBHOOK_TOKEN`.

---

## 📱 3. Configurando a Evolution API (WhatsApp)

A Evolution API permite enviar no WhatsApp do comprador uma mensagem acolhedora com os números que ele adquiriu e o link do comprovante.

1. Na sua instância da **Evolution API**, obtenha:
   - **URL da API**: Ex: `https://api.seuevolution.com`
   - **API Key**: A sua chave global de autenticação.
   - **Nome da Instância**: Nome da sessão conectada ao WhatsApp.
2. Preencha no `.env` ou na aba de configurações do painel admin:
   ```env
   EVOLUTION_API_URL=https://api.seuevolution.com
   EVOLUTION_API_KEY=sua-api-key
   EVOLUTION_INSTANCE_NAME=rifa-beneficente
   ```
3. Você pode testar o disparo imediatamente através do botão **"Testar Envio"** dentro do Painel Admin!

---

## 🌟 Funcionalidades em Destaque

- **Grade Interativa de 000 a 600**: Com seleção rápida (Surpresinha +1, +5, +10, +20 cotas) e visualização de status por cores (Livre, Reservado, Pago).
- **Controle de Concorrência Atômico**: Se duas pessoas tentarem reservar o mesmo número no mesmo segundo, o sistema garante que apenas a primeira reserva é confirmada, impedindo números duplicados.
- **Expiração Automática de Reservas**: Pedidos não pagos em até 15 minutos são automaticamente cancelados e os números voltam para a rifa.
- **Polling e Atualização em Tempo Real**: Assim que o comprador faz o PIX, a tela identifica o pagamento e comemora com chuva de confetes.
- **Sorteador Oficial Embutido**: Roleta animada que sorteia de forma transparente exclusivamente entre os números que já foram pagos.
- **Baixa Manual**: Permite ao administrador aprovar pagamentos em dinheiro físico ou transferências diretas.

---

## 🚀 Deploy na Vercel

1. Suba o repositório para o seu **GitHub**.
2. Acesse [vercel.com](https://vercel.com) e clique em **Add New... -> Project**.
3. Importe o repositório `rifa-beneficente`.
4. Em **Environment Variables**, adicione as variáveis:
   - `BASE_URL`: URL gerada pela Vercel (ex: `https://sua-rifa.vercel.app`)
   - `SUPABASE_URL`: sua URL do Supabase
   - `SUPABASE_SERVICE_KEY`: sua Service Role Key do Supabase
   - `ASAAS_API_KEY`: sua chave de API de produção do Asaas
   - `ASAAS_ENVIRONMENT`: `production`
   - `ASAAS_WEBHOOK_TOKEN`: token secreto do webhook
   - `EVOLUTION_API_URL`: URL da sua Evolution API
   - `EVOLUTION_API_KEY`: Chave da Evolution API
   - `EVOLUTION_INSTANCE_NAME`: Nome da instância
   - `ADMIN_PASSWORD`: Senha de acesso ao painel
5. Clique em **Deploy**!
6. No Asaas, configure a URL do Webhook apontando para: `https://sua-rifa.vercel.app/api/webhooks/asaas`.
