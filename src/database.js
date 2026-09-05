const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

let supabase = null;
let isSupabaseConfigured = false;

// Memória local de fallback caso o Supabase não esteja configurado ainda
const memoryStore = {
  settings: {
    id: 1,
    title: 'Rifa Solidária Beneficente',
    description: 'Participe da nossa rifa beneficente em prol das nossas ações solidárias. Cada número nos ajuda a continuar esse trabalho essencial!',
    prize: 'iPhone 15 128GB ou R$ 3.500,00 no PIX',
    price_per_number: 10.00,
    min_number: 0,
    max_number: 600,
    reservation_timeout_minutes: 15,
    admin_password: process.env.ADMIN_PASSWORD || 'admin123'
  },
  numbers: [], // preenchido de 000 a 600
  orders: new Map()
};

// Inicializa a lista de 000 a 600 na memória
for (let i = 0; i <= 600; i++) {
  const numStr = String(i).padStart(3, '0');
  memoryStore.numbers.push({
    number: numStr,
    number_int: i,
    status: 'available', // available, reserved, paid
    order_id: null,
    updated_at: new Date().toISOString()
  });
}

if (SUPABASE_URL && SUPABASE_KEY && SUPABASE_URL.startsWith('http')) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false }
    });
    isSupabaseConfigured = true;
    console.log('✅ Supabase conectado com sucesso em:', SUPABASE_URL);
  } catch (err) {
    console.warn('⚠️ Erro ao inicializar cliente Supabase. Usando armazenamento local temporário:', err.message);
  }
} else {
  console.log('ℹ️ SUPABASE_URL / SUPABASE_KEY não configurados no .env. Operando em modo de demonstração local.');
}

// Inicializador de dados no Supabase (se necessário)
async function initDatabase() {
  if (!isSupabaseConfigured) return;

  try {
    // 1. Verifica tabela de números
    const { count, error: countError } = await supabase
      .from('raffle_numbers')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      console.warn('⚠️ Tabela raffle_numbers ainda não encontrada no Supabase. Execute o script supabase_schema.sql no SQL Editor.');
      return;
    }

    // Se estiver realmente vazio (count === 0), popula uma única vez
    if (count === 0) {
      console.log('🌱 Tabela vazia. Populando 601 números (000 a 600) no Supabase...');
      const batchSize = 100;
      const allNumbers = [];
      for (let i = 0; i <= 600; i++) {
        allNumbers.push({
          number: String(i).padStart(3, '0'),
          number_int: i,
          status: 'available'
        });
      }

      for (let i = 0; i < allNumbers.length; i += batchSize) {
        const batch = allNumbers.slice(i, i + batchSize);
        await supabase.from('raffle_numbers').insert(batch);
      }
      console.log('✅ Números de 000 a 600 criados com sucesso no Supabase!');
    }
  } catch (err) {
    console.error('Erro na verificação inicial do Supabase:', err.message);
  }
}

// Obter configurações
async function getSettings() {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase.from('raffle_settings').select('*').eq('id', 1).single();
    if (!error && data) return data;
  }
  return memoryStore.settings;
}

// Atualizar configurações
async function updateSettings(newSettings) {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from('raffle_settings')
      .upsert({ id: 1, ...newSettings, updated_at: new Date().toISOString() })
      .select()
      .single();
    if (!error) return data;
  }
  memoryStore.settings = { ...memoryStore.settings, ...newSettings };
  return memoryStore.settings;
}

// Obter todos os números
async function getAllNumbers() {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from('raffle_numbers')
      .select('number, number_int, status, order_id')
      .order('number_int', { ascending: true });
    if (!error && data && data.length > 0) return data;
  }
  return memoryStore.numbers;
}

// Obter dados de um pedido por ID
async function getOrderById(orderId) {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase.from('raffle_orders').select('*').eq('id', orderId).single();
    if (!error && data) return data;
  }
  return memoryStore.orders.get(orderId) || null;
}

// Obter pedidos por telefone ou CPF (para a tela "Meus Bilhetes")
async function getOrdersByCustomer(phoneOrCpf) {
  const cleaned = (phoneOrCpf || '').replace(/\D/g, '');
  const raw = (phoneOrCpf || '').trim().toLowerCase();

  if (!cleaned && !raw) return [];

  let orders = [];

  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from('raffle_orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      orders = data;
    }
  } else {
    orders = Array.from(memoryStore.orders.values());
  }

  // Compara normalizando dígitos (ignora pontos, traços, parênteses e espaços)
  return orders.filter(order => {
    const oPhoneClean = (order.customer_phone || '').replace(/\D/g, '');
    const oCpfClean = (order.customer_cpf || '').replace(/\D/g, '');
    const oPhoneRaw = (order.customer_phone || '').toLowerCase();
    const oCpfRaw = (order.customer_cpf || '').toLowerCase();

    return (
      (cleaned && (oPhoneClean.includes(cleaned) || oCpfClean.includes(cleaned))) ||
      (raw && (oPhoneRaw.includes(raw) || oCpfRaw.includes(raw)))
    );
  });
}

// Obter todos os pedidos (Admin)
async function getAllOrders() {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from('raffle_orders')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && data) return data;
  }
  return Array.from(memoryStore.orders.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// Criar pedido
async function createOrder(orderData) {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from('raffle_orders')
      .insert([orderData])
      .select()
      .single();
    if (error) throw new Error(`Erro ao salvar pedido no Supabase: ${error.message}`);
    return data;
  }
  memoryStore.orders.set(orderData.id, orderData);
  return orderData;
}

// Atualizar pedido
async function updateOrder(orderId, updateFields) {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from('raffle_orders')
      .update(updateFields)
      .eq('id', orderId)
      .select()
      .single();
    if (!error && data) return data;
  }
  const existing = memoryStore.orders.get(orderId);
  if (existing) {
    const updated = { ...existing, ...updateFields };
    memoryStore.orders.set(orderId, updated);
    return updated;
  }
  return null;
}

// Reserva atômica de números para um pedido
async function reserveNumbers(numberList, orderId) {
  if (isSupabaseConfigured) {
    // 1. Verifica se todos os números solicitados estão atualmente disponíveis
    const { data: checkData, error: checkError } = await supabase
      .from('raffle_numbers')
      .select('number, status')
      .in('number', numberList);

    if (checkError || !checkData) {
      console.error('Erro ao consultar números no Supabase:', checkError?.message);
      return false;
    }

    if (checkData.length !== numberList.length) {
      return false;
    }

    const allAvailable = checkData.every(n => n.status === 'available');
    if (!allAvailable) {
      return false;
    }

    // 2. Atualiza apenas os que continuam disponíveis (evita condição de corrida)
    const { data: updatedRows, error: updateError } = await supabase
      .from('raffle_numbers')
      .update({ 
        status: 'reserved', 
        order_id: orderId, 
        updated_at: new Date().toISOString() 
      })
      .in('number', numberList)
      .eq('status', 'available')
      .select('number');

    if (updateError) {
      console.error('Erro ao atualizar status para reserved no Supabase:', updateError.message);
      return false;
    }

    // Garante que todos os números foram atualizados com sucesso
    return updatedRows && updatedRows.length === numberList.length;
  }

  // Lógica na memória
  for (const num of numberList) {
    const item = memoryStore.numbers.find(n => n.number === num);
    if (!item || item.status !== 'available') {
      return false;
    }
  }

  for (const num of numberList) {
    const item = memoryStore.numbers.find(n => n.number === num);
    if (item) {
      item.status = 'reserved';
      item.order_id = orderId;
      item.updated_at = new Date().toISOString();
    }
  }
  return true;
}

// Liberar pedidos vencidos
async function expireOverdueOrders() {
  const nowIso = new Date().toISOString();

  if (isSupabaseConfigured) {
    // Tenta RPC
    const { data: rpcResult, error: rpcError } = await supabase.rpc('expire_overdue_orders');
    if (!rpcError) return rpcResult || 0;

    // Fallback se não tiver RPC
    const { data: expiredOrders } = await supabase
      .from('raffle_orders')
      .select('id, selected_numbers')
      .eq('status', 'pending')
      .lt('expires_at', nowIso);

    if (expiredOrders && expiredOrders.length > 0) {
      const orderIds = expiredOrders.map(o => o.id);
      await supabase.from('raffle_orders').update({ status: 'expired' }).in('id', orderIds);
      await supabase.from('raffle_numbers').update({ status: 'available', order_id: null }).in('order_id', orderIds);
      return expiredOrders.length;
    }
    return 0;
  }

  let count = 0;
  for (const order of memoryStore.orders.values()) {
    if (order.status === 'pending' && new Date(order.expires_at) < new Date()) {
      order.status = 'expired';
      count++;
      for (const num of order.selected_numbers) {
        const item = memoryStore.numbers.find(n => n.number === num);
        if (item && item.order_id === order.id && item.status === 'reserved') {
          item.status = 'available';
          item.order_id = null;
          item.updated_at = new Date().toISOString();
        }
      }
    }
  }
  return count;
}

// Confirmar pagamento
async function markOrderPaid(orderId) {
  const paidAt = new Date().toISOString();
  if (isSupabaseConfigured) {
    const { data: order } = await supabase
      .from('raffle_orders')
      .update({ status: 'paid', paid_at: paidAt })
      .eq('id', orderId)
      .select()
      .single();

    if (order) {
      if (order.selected_numbers && order.selected_numbers.length > 0) {
        await supabase
          .from('raffle_numbers')
          .update({ status: 'paid', order_id: orderId, updated_at: paidAt })
          .in('number', order.selected_numbers);
      }
      await supabase
        .from('raffle_numbers')
        .update({ status: 'paid', updated_at: paidAt })
        .eq('order_id', orderId);
      return order;
    }
  }

  const order = memoryStore.orders.get(orderId);
  if (order) {
    order.status = 'paid';
    order.paid_at = paidAt;
    for (const num of order.selected_numbers) {
      const item = memoryStore.numbers.find(n => n.number === num);
      if (item) {
        item.status = 'paid';
        item.order_id = order.id;
        item.updated_at = paidAt;
      }
    }
    return order;
  }
  return null;
}

// Cancelar/Liberar pedido manualmente
async function cancelOrder(orderId) {
  if (isSupabaseConfigured) {
    const { data: order } = await supabase
      .from('raffle_orders')
      .select('selected_numbers')
      .eq('id', orderId)
      .single();

    await supabase.from('raffle_orders').update({ status: 'cancelled' }).eq('id', orderId);

    if (order?.selected_numbers?.length > 0) {
      await supabase
        .from('raffle_numbers')
        .update({ status: 'available', order_id: null, updated_at: new Date().toISOString() })
        .in('number', order.selected_numbers);
    }
    await supabase
      .from('raffle_numbers')
      .update({ status: 'available', order_id: null, updated_at: new Date().toISOString() })
      .eq('order_id', orderId);
    return true;
  }

  const order = memoryStore.orders.get(orderId);
  if (order) {
    order.status = 'cancelled';
    for (const num of order.selected_numbers) {
      const item = memoryStore.numbers.find(n => n.number === num);
      if (item && item.order_id === order.id) {
        item.status = 'available';
        item.order_id = null;
      }
    }
    return true;
  }
  return false;
}

module.exports = {
  supabase,
  isSupabaseConfigured: () => isSupabaseConfigured,
  initDatabase,
  getSettings,
  updateSettings,
  getAllNumbers,
  getOrderById,
  getOrdersByCustomer,
  getAllOrders,
  createOrder,
  updateOrder,
  reserveNumbers,
  expireOverdueOrders,
  markOrderPaid,
  cancelOrder
};
