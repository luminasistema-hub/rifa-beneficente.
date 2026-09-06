const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const db = require('./database');
const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Inicialização sob demanda do banco (essencial para ambientes Serverless como Vercel)
let dbInitialized = false;
app.use(async (req, res, next) => {
  if (!dbInitialized) {
    try {
      await db.initDatabase();
      dbInitialized = true;
    } catch (err) {
      console.warn('Aviso na inicialização do DB:', err.message);
    }
  }
  next();
});

// Servir arquivos estáticos do frontend
app.use(express.static(path.join(__dirname, '../public')));

// Rotas da API
app.use('/api', apiRoutes);
app.use('/api/admin', adminRoutes);

// Redirecionamento amigável para SPA ou rotas
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

app.get('/meus-bilhetes', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/meus-bilhetes.html'));
});

// Inicialização do Servidor e Banco de Dados
async function startServer() {
  await db.initDatabase();

  // Worker periódico de expiração de reservas (a cada 60 segundos)
  setInterval(async () => {
    try {
      const expiredCount = await db.expireOverdueOrders();
      if (expiredCount > 0) {
        console.log(`⏱️ Rotina de expiração: ${expiredCount} pedido(s) vencido(s) liberado(s) de volta para a rifa.`);
      }
    } catch (err) {
      console.warn('Erro na rotina de expiração periódica:', err.message);
    }
  }, 60 * 1000);

  // Worker periódico de sincronização automática com Asaas e disparo de automações (a cada 15 segundos)
  const raffle = require('./services/raffle');
  const asaas = require('./services/asaas');
  setInterval(async () => {
    try {
      const orders = await db.getAllOrders();
      const pendingOrders = orders.filter(o => 
        o.status === 'pending' && 
        o.asaas_payment_id && 
        !o.asaas_payment_id.startsWith('pay_simulado_') &&
        !o.asaas_payment_id.startsWith('manual_') &&
        !o.asaas_payment_id.startsWith('pix_direto_')
      );

      for (const order of pendingOrders) {
        try {
          const asaasData = await asaas.getPaymentStatus(order.asaas_payment_id);
          if (asaasData && (asaasData.status === 'RECEIVED' || asaasData.status === 'CONFIRMED')) {
            console.log(`⚡ [AUTOMAÇÃO] Pagamento PIX identificado no Asaas! Confirmando pedido ${order.id} (${order.customer_name})...`);
            await raffle.confirmOrderPayment(order.id, 'asaas_auto_sync');
          }
        } catch (pollErr) {
          // Erro pontual de conexão com Asaas para esse pedido
        }
      }
    } catch (err) {
      // Ignora erro geral
    }
  }, 15 * 1000);

  app.listen(PORT, () => {
    console.log('\n======================================================');
    console.log(`🎉 SISTEMA DE RIFA BENEFICENTE ONLINE NA PORTA ${PORT}`);
    console.log(`👉 Página Pública da Rifa: http://localhost:${PORT}`);
    console.log(`👉 Meus Bilhetes:           http://localhost:${PORT}/meus-bilhetes.html`);
    console.log(`👉 Painel de Administração: http://localhost:${PORT}/admin.html`);
    console.log('------------------------------------------------------');
    console.log(`📦 Banco de Dados: ${db.isSupabaseConfigured() ? 'Supabase (Nuvem)' : 'Memória Local (Demo)'}`);
    console.log(`💳 Asaas PIX:      ${process.env.ASAAS_API_KEY ? 'Configurado (' + (process.env.ASAAS_ENVIRONMENT || 'sandbox') + ')' : 'Modo Demonstração / Simulado'}`);
    console.log(`📱 Evolution API:  ${process.env.EVOLUTION_API_URL ? 'Configurado' : 'Modo Demonstração / Simulado'}`);
    console.log('======================================================\n');
  });
}

if (require.main === module) {
  startServer().catch(err => {
    console.error('Falha crítica ao iniciar o servidor:', err);
    process.exit(1);
  });
}

module.exports = app;
