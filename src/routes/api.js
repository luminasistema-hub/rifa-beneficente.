const express = require('express');
const router = express.Router();
const db = require('../database');
const raffle = require('../services/raffle');
const asaas = require('../services/asaas');

// Obter dados públicos da rifa e grade de números
router.get('/raffle', async (req, res) => {
  try {
    const settings = await db.getSettings();
    const numbers = await db.getAllNumbers();

    let countAvailable = 0;
    let countReserved = 0;
    let countPaid = 0;

    for (const n of numbers) {
      if (n.status === 'paid') countPaid++;
      else if (n.status === 'reserved') countReserved++;
      else countAvailable++;
    }

    res.json({
      title: settings.title,
      description: settings.description,
      prize: settings.prize,
      pricePerNumber: Number(settings.price_per_number),
      minNumber: settings.min_number,
      maxNumber: settings.max_number,
      timeoutMinutes: settings.reservation_timeout_minutes,
      stats: {
        total: numbers.length,
        available: countAvailable,
        reserved: countReserved,
        paid: countPaid,
        totalRaised: countPaid * Number(settings.price_per_number)
      },
      numbers: numbers.map(n => ({
        number: n.number,
        status: n.status
      }))
    });
  } catch (err) {
    console.error('Erro ao buscar dados da rifa:', err);
    res.status(500).json({ error: 'Erro ao carregar dados da rifa: ' + err.message });
  }
});

// Criar novo pedido de cotas e gerar cobrança PIX
router.post('/orders', async (req, res) => {
  try {
    const { customerName, customerPhone, customerCpf, customerEmail, selectedNumbers } = req.body;
    const order = await raffle.createRaffleOrder({
      customerName,
      customerPhone,
      customerCpf,
      customerEmail,
      selectedNumbers
    });

    res.status(201).json({
      success: true,
      order: {
        id: order.id,
        customerName: order.customer_name,
        customerPhone: order.customer_phone,
        totalAmount: order.total_amount,
        selectedNumbers: order.selected_numbers,
        pixQrCode: order.pix_qr_code,
        pixCode: order.pix_code,
        expiresAt: order.expires_at,
        status: order.status
      }
    });
  } catch (err) {
    console.warn('Erro ao processar pedido:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// Consultar status de um pedido específico (para polling da tela de PIX)
router.get('/orders/:id', async (req, res) => {
  try {
    const order = await db.getOrderById(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Pedido não encontrado.' });
    }

    // Se estiver pendente, verifica se expirou
    if (order.status === 'pending' && new Date(order.expires_at) < new Date()) {
      await db.expireOverdueOrders();
      const reloaded = await db.getOrderById(req.params.id);
      return res.json({ order: reloaded });
    }

    // Se ainda pendente e tem asaas_payment_id real, consulta API do Asaas como fallback
    if (order.status === 'pending' && order.asaas_payment_id && !order.asaas_payment_id.startsWith('pay_simulado_')) {
      try {
        const asaasData = await asaas.getPaymentStatus(order.asaas_payment_id);
        if (asaasData && (asaasData.status === 'RECEIVED' || asaasData.status === 'CONFIRMED')) {
          const { order: confirmedOrder } = await raffle.confirmOrderPayment(order.id, 'asaas_polling');
          return res.json({ order: confirmedOrder });
        }
      } catch (err) {
        console.warn('Fallback polling Asaas error:', err.message);
      }
    }

    res.json({ order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Aprovação com 1 clique (para o link enviado no WhatsApp do Admin)
router.get('/orders/:id/quick-approve', async (req, res) => {
  try {
    const { token } = req.query;
    const orderId = req.params.id;
    const order = await db.getOrderById(orderId);

    if (!order) {
      return res.status(404).send('<h2>Pedido não encontrado.</h2>');
    }

    // Valida token de segurança
    if (token !== order.id && token !== process.env.ADMIN_PASSWORD) {
      return res.status(403).send('<h2>Token de autorização inválido.</h2>');
    }

    if (order.status === 'paid') {
      return res.send(`
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Pedido Já Confirmado</title><script src="https://cdn.tailwindcss.com"></script></head>
        <body class="bg-slate-900 text-white flex items-center justify-center min-h-screen p-4 text-center">
          <div class="bg-slate-800 p-8 rounded-3xl max-w-sm w-full border border-slate-700 shadow-2xl">
            <div class="text-5xl mb-4">💚</div>
            <h1 class="text-xl font-bold text-emerald-400 mb-2">Pedido Já Foi Aprovado!</h1>
            <p class="text-sm text-slate-300 mb-6">As cotas <strong>${order.selected_numbers.join(', ')}</strong> de <strong>${order.customer_name}</strong> já estão confirmadas e ativas no sorteio.</p>
            <a href="/admin" class="inline-block bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-6 rounded-xl text-sm transition-all">Ir para o Painel Admin</a>
          </div>
        </body>
        </html>
      `);
    }

    const { order: confirmedOrder } = await raffle.confirmOrderPayment(orderId, 'whatsapp_1click_approve');

    return res.send(`
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>PIX Aprovado!</title><script src="https://cdn.tailwindcss.com"></script></head>
      <body class="bg-slate-900 text-white flex items-center justify-center min-h-screen p-4 text-center">
        <div class="bg-slate-800 p-8 rounded-3xl max-w-sm w-full border border-emerald-500/30 shadow-2xl">
          <div class="text-6xl mb-4">🎉</div>
          <h1 class="text-2xl font-black text-emerald-400 mb-2">Pagamento Confirmado!</h1>
          <p class="text-sm text-slate-300 mb-4">O pagamento de <strong>R$ ${Number(confirmedOrder.total_amount).toFixed(2).replace('.', ',')}</strong> de <strong>${confirmedOrder.customer_name}</strong> foi aprovado com sucesso!</p>
          <div class="bg-slate-900 p-4 rounded-2xl mb-6 border border-slate-700">
            <span class="text-xs text-slate-400 block mb-1 font-semibold">Cotas Liberadas:</span>
            <div class="flex flex-wrap justify-center gap-1.5 font-black text-emerald-400 text-base">
              ${confirmedOrder.selected_numbers.map(n => `<span class="bg-emerald-950 border border-emerald-500/30 px-2 py-0.5 rounded-lg">${n}</span>`).join('')}
            </div>
          </div>
          <p class="text-xs text-emerald-300 font-semibold mb-6">📱 Mensagem e bilhetes enviados no WhatsApp do comprador!</p>
          <a href="/admin" class="inline-block bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-6 rounded-xl text-sm transition-all">Voltar ao Painel Admin</a>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send(`<h2>Erro ao aprovar pedido: ${err.message}</h2>`);
  }
});

// Endpoint POST para o n8n aprovar o pedido programaticamente
router.post('/orders/:id/approve', async (req, res) => {
  try {
    const orderId = req.params.id;
    const { order } = await raffle.confirmOrderPayment(orderId, 'n8n_automation');
    res.json({ success: true, message: 'Pedido aprovado com sucesso via n8n!', order });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Cancelamento de pedido (libera as cotas de volta para a rifa)
router.get('/orders/:id/quick-cancel', async (req, res) => {
  try {
    const { token } = req.query;
    const orderId = req.params.id;
    const order = await db.getOrderById(orderId);

    if (!order) {
      return res.status(404).send('<h2>Pedido não encontrado.</h2>');
    }

    if (token !== order.id && token !== process.env.ADMIN_PASSWORD) {
      return res.status(403).send('<h2>Token inválido.</h2>');
    }

    await db.cancelOrder(orderId);
    return res.send(`
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Pedido Cancelado</title><script src="https://cdn.tailwindcss.com"></script></head>
      <body class="bg-slate-900 text-white flex items-center justify-center min-h-screen p-4 text-center">
        <div class="bg-slate-800 p-8 rounded-3xl max-w-sm w-full border border-rose-500/30 shadow-2xl">
          <div class="text-5xl mb-4">❌</div>
          <h1 class="text-xl font-bold text-rose-400 mb-2">Pedido Cancelado</h1>
          <p class="text-sm text-slate-300 mb-6">As cotas foram liberadas imediatamente de volta para a rifa.</p>
          <a href="/admin" class="inline-block bg-slate-700 hover:bg-slate-600 text-white font-bold py-3 px-6 rounded-xl text-sm transition-all">Ir para o Painel Admin</a>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send(`<h2>Erro ao cancelar: ${err.message}</h2>`);
  }
});

// Simulação de pagamento para testes (quando em ambiente local/demonstração)
router.post('/orders/:id/simulate-payment', async (req, res) => {
  try {
    const { order } = await raffle.confirmOrderPayment(req.params.id, 'simulacao_manual');
    res.json({ success: true, order });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Consulta de bilhetes por Telefone ou CPF ("Meus Bilhetes")
router.get('/my-tickets', async (req, res) => {
  try {
    const query = req.query.search || '';
    if (!query || query.trim().length < 3) {
      return res.status(400).json({ error: 'Informe ao menos 3 dígitos do telefone ou CPF.' });
    }

    const orders = await db.getOrdersByCustomer(query);
    res.json({ orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Webhook do Asaas para confirmação automática de PIX
router.post('/webhooks/asaas', async (req, res) => {
  try {
    const webhookTokenHeader = req.headers['asaas-access-token'];
    const settings = await db.getSettings();
    const expectedToken = settings.asaas_webhook_token || process.env.ASAAS_WEBHOOK_TOKEN;

    // Se o token foi configurado, valida
    if (expectedToken && webhookTokenHeader && webhookTokenHeader !== expectedToken) {
      console.warn('⚠️ Webhook Asaas recebido com token inválido!');
      return res.status(401).json({ error: 'Token inválido' });
    }

    const event = req.body.event;
    const payment = req.body.payment;

    console.log(`📥 Webhook Asaas recebido: Evento = ${event}, PaymentID = ${payment?.id}`);

    if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
      const orderId = payment.externalReference;
      if (orderId) {
        await raffle.confirmOrderPayment(orderId, 'asaas_webhook');
      } else {
        // Tenta achar pedido pelo asaas_payment_id
        const allOrders = await db.getAllOrders();
        const found = allOrders.find(o => o.asaas_payment_id === payment.id);
        if (found) {
          await raffle.confirmOrderPayment(found.id, 'asaas_webhook');
        }
      }
    }

    // O Asaas exige status 200 como confirmação de recebimento
    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Erro no processamento do Webhook Asaas:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
