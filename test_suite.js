const assert = require('assert');

const BASE_URL = 'http://localhost:3000';

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const response = await fetch(url, options);
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

async function runTests() {
  console.log('🧪 Iniciando bateria de testes do Sistema de Rifa Beneficente...\n');

  // 1. Teste de listagem da rifa
  console.log('1. Testando GET /api/raffle...');
  const raffleRes = await request('/api/raffle');
  assert.strictEqual(raffleRes.status, 200, 'Status deve ser 200');
  assert.strictEqual(raffleRes.data.numbers.length, 601, 'Devem existir 601 números (000 a 600)');
  assert.strictEqual(raffleRes.data.numbers[0].number, '000', 'Primeiro número deve ser 000');
  assert.strictEqual(raffleRes.data.numbers[600].number, '600', 'Último número deve ser 600');
  console.log(`✓ 601 números verificados com sucesso! Disponíveis: ${raffleRes.data.stats.available}\n`);

  // Pega números livres dinamicamente
  const availableNums = raffleRes.data.numbers
    .filter(n => n.status === 'available')
    .slice(0, 2)
    .map(n => n.number);

  assert.ok(availableNums.length >= 2, 'Devem haver ao menos 2 números disponíveis para teste');
  const [num1, num2] = availableNums;

  // 2. Teste de criação de pedido
  console.log(`2. Testando POST /api/orders (Reserva de cotas ${num1} e ${num2})...`);
  const orderPayload = {
    customerName: 'Carlos Oliveira Teste',
    customerPhone: '63984861923',
    customerCpf: '123.456.789-00',
    customerEmail: 'carlos@teste.com',
    selectedNumbers: [num1, num2]
  };

  const orderRes = await request('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(orderPayload)
  });

  assert.strictEqual(orderRes.status, 201, 'Pedido deve ser criado com status 201');
  assert.ok(orderRes.data.order.id, 'Deve retornar ID do pedido');
  assert.strictEqual(orderRes.data.order.totalAmount, 20.00, 'Total deve ser R$ 20,00 para 2 cotas');
  assert.ok(orderRes.data.order.pixCode, 'Deve retornar código PIX copia e cola');
  const createdOrderId = orderRes.data.order.id;
  console.log(`✓ Pedido criado com sucesso: ${createdOrderId} | PIX gerado!\n`);

  // 3. Teste de prevenção de colisão / concorrência
  console.log(`3. Testando tentativa de compra simultânea do número ${num1}...`);
  const duplicateRes = await request('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerName: 'Outro Comprador',
      customerPhone: '63999998888',
      customerCpf: '987.654.321-00',
      selectedNumbers: [num1]
    })
  });
  assert.strictEqual(duplicateRes.status, 400, 'Tentativa de reservar número já ocupado deve ser rejeitada');
  console.log('✓ Concorrência bloqueada com sucesso! Números protegidos contra colisão.\n');

  // 4. Teste de consulta "Meus Bilhetes"
  console.log('4. Testando GET /api/my-tickets para o comprador...');
  const ticketsRes = await request('/api/my-tickets?search=63984861923');
  assert.strictEqual(ticketsRes.status, 200);
  assert.ok(ticketsRes.data.orders.length >= 1, 'Deve encontrar o pedido criado');
  console.log('✓ Meus Bilhetes retornou as cotas corretas do participante!\n');

  // 5. Teste de Confirmação de Pagamento PIX
  console.log('5. Testando confirmação de pagamento do pedido...');
  const confirmRes = await request(`/api/orders/${createdOrderId}/simulate-payment`, {
    method: 'POST'
  });
  assert.strictEqual(confirmRes.status, 200);
  assert.strictEqual(confirmRes.data.order.status, 'paid');
  console.log('✓ Pagamento confirmado com sucesso! Status atualizado para "paid".\n');

  // 6. Teste de Login e Painel Admin
  console.log('6. Testando autenticação e métricas do Admin...');
  const loginRes = await request('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'admin123' })
  });
  assert.strictEqual(loginRes.status, 200);
  const token = loginRes.data.token;

  const dashRes = await request('/api/admin/dashboard', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  assert.strictEqual(dashRes.status, 200);
  assert.ok(dashRes.data.stats.paid >= 2, 'Devem constar cotas pagas');
  console.log(`✓ Dashboard Admin verificado! Arrecadado: R$ ${dashRes.data.stats.totalRaised}, Pagos: ${dashRes.data.stats.paid}\n`);

  // 7. Teste de consulta de instâncias da Evolution API
  console.log('7. Testando integração com Evolution API (GET /api/admin/evolution/instances)...');
  const evoRes = await request('/api/admin/evolution/instances', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  assert.strictEqual(evoRes.status, 200);
  assert.ok(Array.isArray(evoRes.data.instances), 'Deve retornar array de instâncias da Evolution API');
  console.log(`✓ Evolution API online! ${evoRes.data.instances.length} instâncias identificadas no servidor.\n`);

  // 8. Teste de Sorteio Transparente
  console.log('8. Testando Sorteador Oficial com números pagos...');
  const drawRes = await request('/api/admin/draw', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  assert.strictEqual(drawRes.status, 200);
  assert.ok(drawRes.data.winningNumber, 'Deve sortear um número');
  console.log(`✓ Sorteio realizado com sucesso! Cota vencedora: ${drawRes.data.winningNumber} (${drawRes.data.winner.name})\n`);

  console.log('==================================================');
  console.log('🎉 TODOS OS TESTES PASSARAM COM 100% DE SUCESSO!');
  console.log('==================================================');
}

async function main() {
  let serverRunning = false;
  try {
    const check = await fetch('http://localhost:3000/api/raffle');
    if (check.ok) serverRunning = true;
  } catch (e) {}

  if (!serverRunning) {
    console.log('Iniciando servidor local...');
    require('./src/server');
    await new Promise(r => setTimeout(r, 2000));
  }

  try {
    await runTests();
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Falha no teste:', err);
    process.exit(1);
  }
}

main();
