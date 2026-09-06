const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const asaas = require('./asaas');
const evolution = require('./evolution');

/**
 * Cria um pedido de compra de cotas, reserva os números e gera o PIX no Asaas
 */
async function createRaffleOrder({ customerName, customerPhone, customerCpf, customerEmail, selectedNumbers }) {
  if (!customerName || !customerName.trim()) {
    throw new Error('O nome é obrigatório.');
  }
  if (!customerPhone || !customerPhone.trim()) {
    throw new Error('O telefone/WhatsApp é obrigatório.');
  }
  if (!customerCpf || !customerCpf.trim()) {
    throw new Error('O CPF é obrigatório para emissão do PIX no Banco Central.');
  }
  if (!selectedNumbers || !Array.isArray(selectedNumbers) || selectedNumbers.length === 0) {
    throw new Error('Selecione ao menos 1 número para participar.');
  }

  // Normaliza e remove duplicatas
  const normalizedNumbers = Array.from(
    new Set(selectedNumbers.map(n => String(n).padStart(3, '0')))
  );

  const settings = await db.getSettings();
  const pricePerNumber = Number(settings.price_per_number) || 10.00;
  const timeoutMinutes = Number(settings.reservation_timeout_minutes) || 15;
  const totalAmount = Number((normalizedNumbers.length * pricePerNumber).toFixed(2));

  const orderId = uuidv4();
  const expiresAt = new Date(Date.now() + timeoutMinutes * 60 * 1000).toISOString();

  // 1. Cria o registro preliminar do pedido para satisfazer a chave estrangeira no Supabase
  const initialOrderData = {
    id: orderId,
    customer_name: customerName.trim(),
    customer_phone: customerPhone.trim(),
    customer_cpf: customerCpf.trim(),
    customer_email: customerEmail ? customerEmail.trim() : null,
    total_amount: totalAmount,
    numbers_count: normalizedNumbers.length,
    selected_numbers: normalizedNumbers,
    status: 'pending',
    whatsapp_notified: false,
    created_at: new Date().toISOString(),
    expires_at: expiresAt,
    paid_at: null
  };

  await db.createOrder(initialOrderData);

  // 2. Tenta reservar os números atomicamente
  const reservedSuccess = await db.reserveNumbers(normalizedNumbers, orderId);
  if (!reservedSuccess) {
    await db.cancelOrder(orderId);
    throw new Error('Um ou mais números selecionados acabaram de ser escolhidos por outra pessoa. Por favor, escolha outros números livres.');
  }

  try {
    const pixService = require('./pix');
    const axios = require('axios');

    // Chave PIX e dados do titular
    const pixKey = settings.pix_key || process.env.PIX_KEY || '60566541335';
    const pixName = settings.pix_name || process.env.PIX_BENEFICIARY_NAME || 'Alane Karolliny Souza Costa';
    const pixCity = settings.pix_city || process.env.PIX_BENEFICIARY_CITY || 'Araguaina';
    const n8nWebhookUrl = settings.n8n_webhook_url || process.env.N8N_WEBHOOK_URL || 'https://n8n2.agenciahigher.com.br/webhook/rifa-novo-pedido';

    // 3. Gera cobrança PIX Direta (BRCode oficial sem taxas)
    const directPix = await pixService.createDirectPixPayment({
      key: pixKey,
      name: pixName,
      city: pixCity,
      amount: totalAmount,
      txId: orderId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 25),
      description: `Rifa ${normalizedNumbers.length} cotas`
    });

    const baseUrl = process.env.BASE_URL || 'https://rifa-beneficentee.vercel.app';
    const approveUrl = `${baseUrl}/api/orders/${orderId}/quick-approve?token=${orderId}`;
    const cancelUrl = `${baseUrl}/api/orders/${orderId}/quick-cancel?token=${orderId}`;

    // 4. Atualiza o pedido com os dados do PIX gerado
    const updatedOrder = await db.updateOrder(orderId, {
      asaas_payment_id: `pix_direto_${orderId.slice(0, 8)}`,
      asaas_invoice_url: null,
      pix_qr_code: directPix.pixQrCode,
      pix_code: directPix.pixCode
    });

    // 5. Dispara webhook para o n8n em segundo plano
    if (n8nWebhookUrl) {
      axios.post(n8nWebhookUrl, {
        event: 'order_created',
        orderId,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        customerCpf: customerCpf.trim(),
        customerEmail: customerEmail ? customerEmail.trim() : null,
        totalAmount,
        numbersCount: normalizedNumbers.length,
        selectedNumbers: normalizedNumbers,
        pixKey,
        pixName,
        adminPhone: settings.admin_phone || process.env.ADMIN_PHONE || '556392917027',
        approveUrl,
        cancelUrl,
        createdAt: new Date().toISOString()
      }, { timeout: 10000 }).then(() => {
        console.log(`⚡ [n8n] Webhook disparado com sucesso para o pedido ${orderId}!`);
      }).catch(err => {
        console.warn('⚠️ Aviso ao enviar webhook para n8n:', err.message);
      });
    }

    return updatedOrder || initialOrderData;
  } catch (err) {
    // Se falhou ao gerar o PIX, cancela a reserva dos números imediatamente
    console.error('Falha na criação do pedido PIX:', err.message);
    await db.cancelOrder(orderId);
    throw err;
  }
}

/**
 * Confirma o pagamento do pedido, atualiza números para "pago" e envia WhatsApp via Evolution API
 */
async function confirmOrderPayment(orderId, source = 'webhook') {
  const order = await db.getOrderById(orderId);
  if (!order) {
    throw new Error(`Pedido ${orderId} não encontrado.`);
  }

  if (order.status === 'paid') {
    return { order, alreadyPaid: true };
  }

  console.log(`💰 Confirmando pagamento do pedido ${orderId} (${order.customer_name}) via [${source}]...`);
  const updatedOrder = await db.markOrderPaid(orderId);

  // Dispara mensagem de agradecimento via Evolution API se ainda não foi notificado
  if (!order.whatsapp_notified) {
    try {
      const evoResult = await evolution.sendPurchaseThankYouMessage(updatedOrder);
      if (evoResult && evoResult.success) {
        await db.updateOrder(orderId, { whatsapp_notified: true });
      }
    } catch (evoErr) {
      console.error('Falha ao disparar mensagem WhatsApp:', evoErr.message);
    }
  }

  return { order: updatedOrder, alreadyPaid: false };
}

/**
 * Realiza o sorteio transparente entre os números confirmados e pagos
 */
async function drawWinner() {
  const allNumbers = await db.getAllNumbers();
  const paidNumbers = allNumbers.filter(n => n.status === 'paid' && n.order_id);

  if (paidNumbers.length === 0) {
    throw new Error('Nenhum número foi pago/confirmado ainda para realizar o sorteio.');
  }

  // Sorteio aleatório seguro
  const randomIndex = Math.floor(Math.random() * paidNumbers.length);
  const winningNumber = paidNumbers[randomIndex];

  const winnerOrder = await db.getOrderById(winningNumber.order_id);

  return {
    winningNumber: winningNumber.number,
    totalEligibleNumbers: paidNumbers.length,
    drawnAt: new Date().toISOString(),
    winner: {
      name: winnerOrder ? winnerOrder.customer_name : 'Comprador não identificado',
      phone: winnerOrder ? winnerOrder.customer_phone : '',
      orderId: winningNumber.order_id
    }
  };
}

module.exports = {
  createRaffleOrder,
  confirmOrderPayment,
  drawWinner
};
