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
