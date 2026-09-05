const express = require('express');
const router = express.Router();
const db = require('../database');
const raffle = require('../services/raffle');
const evolution = require('../services/evolution');
const asaas = require('../services/asaas');

// Middleware de Autenticação do Admin
async function adminAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const customHeader = req.headers['x-admin-password'];
  const token = (authHeader ? authHeader.replace('Bearer ', '') : customHeader) || '';

  if (!token) {
    return res.status(401).json({ error: 'Token de autenticação não fornecido.' });
  }

  // 1. Valida se é um token JWT emitido pelo Supabase Auth
  if (db.isSupabaseConfigured() && token.length > 40 && db.supabase) {
    try {
      const { data, error } = await db.supabase.auth.getUser(token);
      if (!error && data?.user) {
        req.adminUser = data.user;
        return next();
      }
    } catch (err) {
      console.warn('Falha na validação de sessão Supabase:', err.message);
    }
  }

  // 2. Fallback para senha direta (admin_password)
  const settings = await db.getSettings();
  const validPassword = settings.admin_password || process.env.ADMIN_PASSWORD || 'admin123';

  if (token === validPassword) {
    return next();
  }
  return res.status(401).json({ error: 'Sessão expirada ou senha de administrador inválida.' });
}

// Login do Admin (Supabase Auth com usuário diogoalbuquerque38@gmail.com)
router.post('/login', async (req, res) => {
  const { password, email } = req.body;
  if (!password) {
    return res.status(400).json({ error: 'Informe a senha de administrador.' });
  }

  const targetEmail = (email && email.trim()) || 'diogoalbuquerque38@gmail.com';

  // 1. Tenta autenticação oficial no Supabase Auth com o usuário criado
  if (db.isSupabaseConfigured() && db.supabase) {
    try {
      const { data, error } = await db.supabase.auth.signInWithPassword({
        email: targetEmail,
        password: password
      });

      if (!error && data?.session?.access_token) {
        console.log(`🔐 Admin autenticado com sucesso via Supabase Auth (${targetEmail})`);
        return res.json({
          success: true,
          token: data.session.access_token,
          user: {
            email: data.user.email,
            id: data.user.id
          }
        });
      }
      if (error && error.message !== 'Invalid login credentials') {
        console.warn('Supabase Auth avisou:', error.message);
      }
    } catch (err) {
      console.warn('Erro ao conectar com Supabase Auth:', err.message);
    }
  }

  // 2. Fallback para a senha direta do sistema
  const settings = await db.getSettings();
  const validPassword = settings.admin_password || process.env.ADMIN_PASSWORD || 'admin123';

  if (password === validPassword) {
    console.log('🔐 Admin autenticado com sucesso via senha direta');
    return res.json({
      success: true,
      token: validPassword,
      user: { email: targetEmail }
    });
  }

  return res.status(401).json({ error: 'Senha incorreta para o usuário ' + targetEmail });
});

// Dados do Dashboard Admin
router.get('/dashboard', adminAuth, async (req, res) => {
  try {
    const settings = await db.getSettings();
    const numbers = await db.getAllNumbers();
    const orders = await db.getAllOrders();

    let countAvailable = 0;
    let countReserved = 0;
    let countPaid = 0;

    for (const n of numbers) {
      if (n.status === 'paid') countPaid++;
      else if (n.status === 'reserved') countReserved++;
      else countAvailable++;
    }

    const pricePerNumber = Number(settings.price_per_number);
    const totalRaised = countPaid * pricePerNumber;
    const targetAmount = numbers.length * pricePerNumber;

    res.json({
      settings: {
        title: settings.title,
        description: settings.description,
        prize: settings.prize,
        price_per_number: settings.price_per_number,
        min_number: settings.min_number,
        max_number: settings.max_number,
        reservation_timeout_minutes: settings.reservation_timeout_minutes,
        asaas_environment: settings.asaas_environment || 'sandbox',
        asaas_api_key_configured: Boolean(settings.asaas_api_key || process.env.ASAAS_API_KEY),
        evolution_configured: Boolean((settings.evolution_api_url || process.env.EVOLUTION_API_URL) && (settings.evolution_api_key || process.env.EVOLUTION_API_KEY)),
        evolution_api_url: settings.evolution_api_url,
        evolution_instance: settings.evolution_instance,
        is_supabase: db.isSupabaseConfigured()
      },
      stats: {
        totalNumbers: numbers.length,
        available: countAvailable,
        reserved: countReserved,
        paid: countPaid,
        percentSold: ((countPaid / numbers.length) * 100).toFixed(1),
        totalRaised,
        targetAmount
      },
      orders
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Baixa Manual de Pagamento (Ex: pagou em dinheiro em mãos)
router.post('/orders/:id/confirm', adminAuth, async (req, res) => {
  try {
    const result = await raffle.confirmOrderPayment(req.params.id, 'admin_manual');
    res.json({ success: true, order: result.order });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Cancelamento Manual de Pedido (Libera os números)
router.post('/orders/:id/cancel', adminAuth, async (req, res) => {
  try {
    await db.cancelOrder(req.params.id);
    res.json({ success: true, message: 'Pedido cancelado e números liberados com sucesso.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Realizar Sorteio Transparente
router.post('/draw', adminAuth, async (req, res) => {
  try {
    const drawResult = await raffle.drawWinner();
    res.json({ success: true, ...drawResult });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Atualizar Configurações da Rifa
router.post('/settings', adminAuth, async (req, res) => {
  try {
    const updateData = req.body;
    const updated = await db.updateSettings(updateData);
    res.json({ success: true, settings: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Venda Manual / Presencial (ex: pago em dinheiro em mãos)
router.post('/orders/manual', adminAuth, async (req, res) => {
  try {
    const { customerName, customerPhone, customerCpf, selectedNumbers, paymentMethod } = req.body;
    if (!customerName || !customerPhone || !selectedNumbers || selectedNumbers.length === 0) {
      return res.status(400).json({ error: 'Preencha Nome, Telefone e selecione ao menos 1 número.' });
    }

    const { v4: uuidv4 } = require('uuid');
    const orderId = uuidv4();
    const settings = await db.getSettings();
    const pricePerNumber = Number(settings.price_per_number) || 10;
    const normalizedNumbers = Array.from(new Set(selectedNumbers.map(n => String(n).padStart(3, '0'))));
    const totalAmount = Number((normalizedNumbers.length * pricePerNumber).toFixed(2));

    const orderData = {
      id: orderId,
      customer_name: customerName.trim(),
      customer_phone: customerPhone.trim(),
      customer_cpf: customerCpf ? customerCpf.trim() : 'VENDA-MANUAL',
      customer_email: null,
      total_amount: totalAmount,
      numbers_count: normalizedNumbers.length,
      selected_numbers: normalizedNumbers,
      asaas_payment_id: `manual_${paymentMethod || 'dinheiro'}`,
      asaas_invoice_url: null,
      pix_qr_code: null,
      pix_code: null,
      status: 'pending',
      whatsapp_notified: false,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      paid_at: null
    };

    // 1. Cria o pedido preliminar no banco para satisfazer a chave estrangeira (FK)
    await db.createOrder(orderData);

    // 2. Reserva os números atomicamente
    const reserved = await db.reserveNumbers(normalizedNumbers, orderId);
    if (!reserved) {
      await db.cancelOrder(orderId);
      return res.status(400).json({ error: 'Um ou mais números selecionados já estão ocupados por outra compra.' });
    }

    // 3. Marca como pago imediatamente (venda presencial confirmada)
    const paidOrder = await db.markOrderPaid(orderId);

    // Envia mensagem WhatsApp de agradecimento
    try {
      await evolution.sendPurchaseThankYouMessage(orderData);
    } catch (e) {
      console.warn('Erro ao enviar whats da venda manual:', e.message);
    }

    res.status(201).json({ success: true, order: orderData });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Exportar Participantes em CSV (para Excel / Prestação de Contas)
router.get('/export-csv', adminAuth, async (req, res) => {
  try {
    const orders = await db.getAllOrders();
    const paidOrders = orders.filter(o => o.status === 'paid');

    let csv = 'ID;Data;Comprador;Telefone;CPF;Quantidade;Cotas;Valor (R$);Forma de Pagamento\n';
    for (const o of paidOrders) {
      const dataStr = new Date(o.created_at).toLocaleString('pt-BR');
      const cotasStr = (o.selected_numbers || []).join(' - ');
      const valorStr = Number(o.total_amount).toFixed(2).replace('.', ',');
      const metodo = o.asaas_payment_id?.startsWith('manual') ? 'Dinheiro/Manual' : 'PIX Asaas';
      csv += `"${o.id}";"${dataStr}";"${o.customer_name}";"${o.customer_phone}";"${o.customer_cpf}";"${o.numbers_count}";"${cotasStr}";"${valorStr}";"${metodo}"\n`;
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="participantes_rifa_beneficente.csv"');
    // Envia com BOM UTF-8 para o Excel no Windows abrir com acentos corretos
    res.send('\uFEFF' + csv);
  } catch (err) {
    res.status(500).send('Erro ao gerar CSV: ' + err.message);
  }
});

// Mapa completo de números com detalhes do comprador
router.get('/numbers-map', adminAuth, async (req, res) => {
  try {
    const numbers = await db.getAllNumbers();
    const orders = await db.getAllOrders();
    const ordersMap = new Map();
    for (const o of orders) {
      ordersMap.set(o.id, o);
    }

    const map = numbers.map(n => {
      const order = n.order_id ? ordersMap.get(n.order_id) : null;
      return {
        number: n.number,
        status: n.status,
        buyerName: order ? order.customer_name : null,
        buyerPhone: order ? order.customer_phone : null,
        orderId: n.order_id
      };
    });

    res.json({ numbers: map });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Testar disparo de WhatsApp via Evolution API
router.post('/test-whatsapp', adminAuth, async (req, res) => {
  try {
    const { phone, message } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Informe um número de telefone com DDD.' });
    }
    const result = await evolution.testEvolutionConnection(phone, message);
    res.json({ success: true, result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Listar instâncias ativas da Evolution API
router.get('/evolution/instances', adminAuth, async (req, res) => {
  try {
    const instances = await evolution.fetchEvolutionInstances();
    res.json({ success: true, instances });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Obter QR Code de conexão para uma instância desconectada
router.get('/evolution/connect/:instance', adminAuth, async (req, res) => {
  try {
    const qr = await evolution.getInstanceQrCode(req.params.instance);
    res.json({ success: true, ...qr });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Testar chave de API do Asaas
router.post('/test-asaas', adminAuth, async (req, res) => {
  try {
    const { apiKey, environment } = req.body;
    const result = await asaas.testAsaasConnection(apiKey, environment);
    res.json({ success: true, result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Simular fluxo de automação completo para testes (Criação de pedido -> Pagamento PIX -> Notificação WhatsApp)
router.post('/simulate-automation', adminAuth, async (req, res) => {
  try {
    const { testPhone, testName } = req.body;
    if (!testPhone) {
      return res.status(400).json({ error: 'Informe um WhatsApp com DDD para receber o teste.' });
    }

    // Acha um número disponível
    const numbers = await db.getAllNumbers();
    const available = numbers.filter(n => n.status === 'available');
    if (available.length === 0) {
      return res.status(400).json({ error: 'Nenhum número disponível no momento para teste.' });
    }

    const testNumber = available[0].number;
    const order = await raffle.createRaffleOrder({
      customerName: testName || 'Teste de Automação',
      customerPhone: testPhone,
      customerCpf: '111.222.333-44',
      customerEmail: 'teste@rifabeneficente.org',
      selectedNumbers: [testNumber]
    });

    // Confirma pagamento do pedido simulado e dispara WhatsApp
    const confirmed = await raffle.confirmOrderPayment(order.id, 'teste_automacao_admin');

    res.json({
      success: true,
      message: `Automação executada com sucesso! Cota ${testNumber} reservada, paga e notificada para ${testPhone}.`,
      order: confirmed.order
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
