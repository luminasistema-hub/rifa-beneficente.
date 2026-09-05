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
    // 3. Cria cliente no Asaas
    const asaasCustomerId = await asaas.getOrCreateCustomer({
      name: customerName,
      cpfCnpj: customerCpf,
      mobilePhone: customerPhone,
      email: customerEmail
    });

    // 4. Cria cobrança PIX no Asaas
    const description = `${settings.title} - ${normalizedNumbers.length} cota(s): ${normalizedNumbers.slice(0, 5).join(', ')}${normalizedNumbers.length > 5 ? '...' : ''}`;
    const pixCharge = await asaas.createPixCharge({
      customerId: asaasCustomerId,
      value: totalAmount,
      description,
      externalReference: orderId
    });

    // 5. Atualiza o pedido com os dados do PIX gerado
    const updatedOrder = await db.updateOrder(orderId, {
      asaas_payment_id: pixCharge.paymentId,
      asaas_invoice_url: pixCharge.invoiceUrl,
      pix_qr_code: pixCharge.pixQrCode,
      pix_code: pixCharge.pixCode
    });

    return updatedOrder || initialOrderData;
  } catch (err) {
    // Se falhou ao comunicar com Asaas, cancela a reserva dos números imediatamente
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
