const state = {
  raffle: null,
  numbers: [],
  selectedNumbers: new Set(),
  activeFilter: 'available', // Padrão: exibe apenas os disponíveis para compra
  currentOrder: null,
  pollTimer: null,
  countdownTimer: null
};

// Elementos do DOM
const elements = {
  raffleTitle: document.getElementById('raffleTitle'),
  raffleDesc: document.getElementById('raffleDesc'),
  rafflePrize: document.getElementById('rafflePrize'),
  pricePerNumber: document.getElementById('pricePerNumber'),
  progressBar: document.getElementById('progressBar'),
  progressPercent: document.getElementById('progressPercent'),
  progressRaised: document.getElementById('progressRaised'),
  numbersGrid: document.getElementById('numbersGrid'),
  countAll: document.getElementById('countAll'),
  countAvailable: document.getElementById('countAvailable'),
  countReserved: document.getElementById('countReserved'),
  countPaid: document.getElementById('countPaid'),
  floatingBar: document.getElementById('floatingBar'),
  selectedCountText: document.getElementById('selectedCountText'),
  selectedTotalText: document.getElementById('selectedTotalText'),
  btnCheckoutModal: document.getElementById('btnCheckoutModal'),
  btnClearSelection: document.getElementById('btnClearSelection'),
  // Modal Checkout
  checkoutModal: document.getElementById('checkoutModal'),
  checkoutForm: document.getElementById('checkoutForm'),
  modalSelectedBadges: document.getElementById('modalSelectedBadges'),
  modalTotalAmount: document.getElementById('modalTotalAmount'),
  btnCancelCheckout: document.getElementById('btnCancelCheckout'),
  btnSubmitOrder: document.getElementById('btnSubmitOrder'),
  // Modal PIX
  pixModal: document.getElementById('pixModal'),
  pixAmount: document.getElementById('pixAmount'),
  pixNumbers: document.getElementById('pixNumbers'),
  pixQrImage: document.getElementById('pixQrImage'),
  pixCodeInput: document.getElementById('pixCodeInput'),
  btnCopyPix: document.getElementById('btnCopyPix'),
  copyPixFeedback: document.getElementById('copyPixFeedback'),
  pixCountdown: document.getElementById('pixCountdown'),
  pixSimulationBox: document.getElementById('pixSimulationBox'),
  btnSimulatePayment: document.getElementById('btnSimulatePayment'),
  btnClosePixModal: document.getElementById('btnClosePixModal'),
  // Sucesso
  paymentSuccessView: document.getElementById('paymentSuccessView'),
  paymentPendingView: document.getElementById('paymentPendingView'),
  successBuyerName: document.getElementById('successBuyerName'),
  successNumbersList: document.getElementById('successNumbersList')
};

// Formatação de Moeda
function formatCurrency(val) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
}

// Máscaras de formulário
function setupInputMasks() {
  const phoneInput = document.getElementById('customerPhone');
  const cpfInput = document.getElementById('customerCpf');

  if (phoneInput) {
    phoneInput.addEventListener('input', (e) => {
      let v = e.target.value.replace(/\D/g, '');
      if (v.length > 11) v = v.slice(0, 11);
      if (v.length > 10) {
        v = v.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
      } else if (v.length > 5) {
        v = v.replace(/^(\d{2})(\d{4})(\d{0,4})$/, '($1) $2-$3');
      } else if (v.length > 2) {
        v = v.replace(/^(\d{2})(\d{0,5})$/, '($1) $2');
      }
      e.target.value = v;
    });
  }

  if (cpfInput) {
    cpfInput.addEventListener('input', (e) => {
      let v = e.target.value.replace(/\D/g, '');
      if (v.length > 11) v = v.slice(0, 11);
      if (v.length > 9) {
        v = v.replace(/^(\d{3})(\d{3})(\d{3})(\d{1,2})$/, '$1.$2.$3-$4');
      } else if (v.length > 6) {
        v = v.replace(/^(\d{3})(\d{3})(\d{0,3})$/, '$1.$2.$3');
      } else if (v.length > 3) {
        v = v.replace(/^(\d{3})(\d{0,3})$/, '$1.$2');
      }
      e.target.value = v;
    });
  }
}

// Carregar dados da Rifa
async function loadRaffleData() {
  try {
    const res = await fetch('/api/raffle');
    if (!res.ok) throw new Error('Falha ao obter dados da rifa');
    const data = await res.json();

    state.raffle = data;
    state.numbers = data.numbers;

    // Atualiza cabeçalho e cause
    if (elements.raffleTitle) elements.raffleTitle.textContent = data.title;
    if (elements.raffleDesc) elements.raffleDesc.textContent = data.description;
    if (elements.rafflePrize) elements.rafflePrize.textContent = data.prize;
    if (elements.pricePerNumber) elements.pricePerNumber.textContent = formatCurrency(data.pricePerNumber);

    // Contadores
    if (elements.countAll) elements.countAll.textContent = data.stats.total;
    if (elements.countAvailable) elements.countAvailable.textContent = data.stats.available;
    if (elements.countReserved) elements.countReserved.textContent = data.stats.reserved;
    if (elements.countPaid) elements.countPaid.textContent = data.stats.paid;

    // Progresso
    const percent = ((data.stats.paid / data.stats.total) * 100).toFixed(1);
    if (elements.progressBar) elements.progressBar.style.width = `${percent}%`;
    if (elements.progressPercent) elements.progressPercent.textContent = `${percent}% vendido`;
    if (elements.progressRaised) elements.progressRaised.textContent = formatCurrency(data.stats.totalRaised);

    // Limpa seleções de números que não estejam mais livres
    for (const num of state.selectedNumbers) {
      const found = state.numbers.find(n => n.number === num);
      if (!found || found.status !== 'available') {
        state.selectedNumbers.delete(num);
      }
    }

    renderNumbersGrid();
    updateFloatingBar();
  } catch (err) {
    console.error('Erro ao carregar dados:', err);
  }
}

// Renderizar Grade de Números
function renderNumbersGrid() {
  if (!elements.numbersGrid) return;
  elements.numbersGrid.innerHTML = '';

  const fragment = document.createDocumentFragment();

  state.numbers.forEach(item => {
    // Filtro ativo
    if (state.activeFilter !== 'all' && item.status !== state.activeFilter) {
      return;
    }

    const isSelected = state.selectedNumbers.has(item.number);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.number = item.number;
    btn.textContent = item.number;

    let baseClass = 'number-btn h-11 w-full rounded-lg font-bold text-sm flex items-center justify-center cursor-pointer transition-all ';

    if (item.status === 'paid') {
      baseClass += 'number-paid';
      btn.title = `Número ${item.number} (Pago)`;
      btn.disabled = true;
    } else if (item.status === 'reserved') {
      baseClass += 'number-reserved';
      btn.title = `Número ${item.number} (Reservado aguardando PIX)`;
      btn.disabled = true;
    } else {
      // Available
      if (isSelected) {
        baseClass += 'number-selected';
      } else {
        baseClass += 'number-available';
      }
      btn.addEventListener('click', () => toggleNumber(item.number));
    }

    btn.className = baseClass;
    fragment.appendChild(btn);
  });

  elements.numbersGrid.appendChild(fragment);
}

// Alternar Seleção de Número
function toggleNumber(numStr) {
  const item = state.numbers.find(n => n.number === numStr);
  if (!item || item.status !== 'available') {
    return; // Segurança: impede seleção de cotas ocupadas
  }

  if (state.selectedNumbers.has(numStr)) {
    state.selectedNumbers.delete(numStr);
  } else {
    state.selectedNumbers.add(numStr);
  }
  renderNumbersGrid();
  updateFloatingBar();
}

// Seleção Rápida Aleatória (+1, +5, +10, etc.)
function addRandomNumbers(count) {
  const available = state.numbers.filter(
    n => n.status === 'available' && !state.selectedNumbers.has(n.number)
  );

  if (available.length === 0) {
    alert('Não há mais números disponíveis livres para selecionar!');
    return;
  }

  // Embaralha números livres
  const shuffled = [...available].sort(() => 0.5 - Math.random());
  const selected = shuffled.slice(0, count);

  selected.forEach(n => state.selectedNumbers.add(n.number));
  renderNumbersGrid();
  updateFloatingBar();
}

// Atualizar Barra Flutuante de Compra
function updateFloatingBar() {
  const count = state.selectedNumbers.size;
  if (count === 0) {
    elements.floatingBar.classList.add('translate-y-32', 'opacity-0');
    elements.floatingBar.classList.remove('translate-y-0', 'opacity-100');
    return;
  }

  elements.floatingBar.classList.remove('translate-y-32', 'opacity-0');
  elements.floatingBar.classList.add('translate-y-0', 'opacity-100');

  const price = state.raffle ? state.raffle.pricePerNumber : 10;
  const total = count * price;

  elements.selectedCountText.textContent = `${count} cota${count > 1 ? 's' : ''}`;
  elements.selectedTotalText.textContent = formatCurrency(total);
}

// Abrir Modal de Checkout
function openCheckoutModal() {
  if (state.selectedNumbers.size === 0) return;

  const price = state.raffle ? state.raffle.pricePerNumber : 10;
  const total = state.selectedNumbers.size * price;

  // Crachás dos números selecionados
  elements.modalSelectedBadges.innerHTML = '';
  const sorted = Array.from(state.selectedNumbers).sort((a, b) => Number(a) - Number(b));
  sorted.forEach(num => {
    const badge = document.createElement('span');
    badge.className = 'inline-block bg-emerald-100 text-emerald-800 text-xs font-bold px-2.5 py-1 rounded-md';
    badge.textContent = num;
    elements.modalSelectedBadges.appendChild(badge);
  });

  elements.modalTotalAmount.textContent = formatCurrency(total);
  elements.checkoutModal.classList.remove('hidden');
}

// Fechar Modal de Checkout
function closeCheckoutModal() {
  elements.checkoutModal.classList.add('hidden');
}

// Submeter Pedido e Gerar PIX
async function submitOrder(e) {
  e.preventDefault();

  const name = document.getElementById('customerName').value.trim();
  const phone = document.getElementById('customerPhone').value.trim();
  const cpf = document.getElementById('customerCpf').value.trim();
  const email = document.getElementById('customerEmail').value.trim();

  if (!name || !phone || !cpf) {
    alert('Por favor, preencha Nome, WhatsApp e CPF.');
    return;
  }

  elements.btnSubmitOrder.disabled = true;
  elements.btnSubmitOrder.innerHTML = `
    <svg class="animate-spin h-5 w-5 mr-2 inline" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
    </svg>
    Gerando Cobrança PIX...
  `;

  try {
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: name,
        customerPhone: phone,
        customerCpf: cpf,
        customerEmail: email,
        selectedNumbers: Array.from(state.selectedNumbers)
      })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Erro ao processar o pedido');
    }

    state.currentOrder = result.order;
    closeCheckoutModal();
    openPixModal(result.order);

    // Recarrega grade para mostrar os números reservados
    loadRaffleData();
  } catch (err) {
    alert(err.message);
  } finally {
    elements.btnSubmitOrder.disabled = false;
    elements.btnSubmitOrder.textContent = 'Gerar PIX e Finalizar Compra';
  }
}

// Abrir Modal do PIX
function openPixModal(order) {
  state.currentOrder = order;

  // Reseta visualização
  elements.paymentPendingView.classList.remove('hidden');
  elements.paymentSuccessView.classList.add('hidden');

  elements.pixAmount.textContent = formatCurrency(order.totalAmount);
  elements.pixNumbers.textContent = order.selectedNumbers.join(', ');
  elements.pixQrImage.src = order.pixQrCode;
  elements.pixCodeInput.value = order.pixCode;

  // Se for simulado, exibe botão de teste rápido
  if (order.pixQrCode && order.pixQrCode.includes('svg')) {
    elements.pixSimulationBox.classList.remove('hidden');
  } else {
    elements.pixSimulationBox.classList.add('hidden');
  }

  // Timer de expiração
  startCountdown(order.expiresAt);

  // Inicia polling de confirmação
  startPaymentPolling(order.id);

  elements.pixModal.classList.remove('hidden');
}

// Fechar Modal do PIX
function closePixModal() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  if (state.countdownTimer) clearInterval(state.countdownTimer);
  elements.pixModal.classList.add('hidden');
  loadRaffleData();
}

// Timer regressivo de expiração
function startCountdown(expiresAt) {
  if (state.countdownTimer) clearInterval(state.countdownTimer);

  const target = new Date(expiresAt).getTime();

  function update() {
    const now = Date.now();
    const diff = target - now;

    if (diff <= 0) {
      clearInterval(state.countdownTimer);
      elements.pixCountdown.textContent = 'Tempo expirado!';
      alert('O tempo de reserva dos seus números expirou. Eles foram liberados novamente na rifa.');
      closePixModal();
      return;
    }

    const minutes = Math.floor(diff / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);
    elements.pixCountdown.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  update();
  state.countdownTimer = setInterval(update, 1000);
}

// Polling de Pagamento (verifica a cada 3 segundos)
function startPaymentPolling(orderId) {
  if (state.pollTimer) clearInterval(state.pollTimer);

  state.pollTimer = setInterval(async () => {
    try {
      const res = await fetch(`/api/orders/${orderId}`);
      if (!res.ok) return;

      const data = await res.json();
      if (data.order && data.order.status === 'paid') {
        clearInterval(state.pollTimer);
        clearInterval(state.countdownTimer);
        onPaymentSuccess(data.order);
      } else if (data.order && (data.order.status === 'expired' || data.order.status === 'cancelled')) {
        clearInterval(state.pollTimer);
        clearInterval(state.countdownTimer);
        alert('Este pedido foi cancelado ou expirou.');
        closePixModal();
      }
    } catch (err) {
      console.warn('Erro ao consultar status:', err);
    }
  }, 3000);
}

// Simulação Manual de Pagamento (botão de teste)
async function simulatePayment() {
  if (!state.currentOrder) return;
  try {
    elements.btnSimulatePayment.disabled = true;
    elements.btnSimulatePayment.textContent = 'Processando...';

    const res = await fetch(`/api/orders/${state.currentOrder.id}/simulate-payment`, {
      method: 'POST'
    });
    const data = await res.json();

    if (data.success) {
      onPaymentSuccess(data.order);
    }
  } catch (err) {
    alert('Erro ao simular: ' + err.message);
  } finally {
    elements.btnSimulatePayment.disabled = false;
    elements.btnSimulatePayment.textContent = '⚡ Simular Pagamento Concluído (Teste)';
  }
}

// Tela de Sucesso após Pagamento Confirmado
function onPaymentSuccess(order) {
  // Dispara confetes se a lib existir
  if (typeof confetti === 'function') {
    confetti({
      particleCount: 120,
      spread: 70,
      origin: { y: 0.6 }
    });
  }

  elements.paymentPendingView.classList.add('hidden');
  elements.paymentSuccessView.classList.remove('hidden');

  elements.successBuyerName.textContent = order.customer_name;
  elements.successNumbersList.innerHTML = order.selected_numbers
    .map(n => `<span class="bg-emerald-600 text-white font-black px-3 py-1.5 rounded-lg text-lg shadow-sm">${n}</span>`)
    .join('');

  // Limpa seleção da tela principal
  state.selectedNumbers.clear();
  updateFloatingBar();
  loadRaffleData();
}

// Copiar Código Pix Copia e Cola
function copyPixCode() {
  const code = elements.pixCodeInput.value;
  if (!code) return;

  navigator.clipboard.writeText(code).then(() => {
    elements.copyPixFeedback.classList.remove('hidden');
    elements.btnCopyPix.classList.add('bg-emerald-700');
    setTimeout(() => {
      elements.copyPixFeedback.classList.add('hidden');
      elements.btnCopyPix.classList.remove('bg-emerald-700');
    }, 3000);
  }).catch(() => {
    // Fallback
    elements.pixCodeInput.select();
    document.execCommand('copy');
    alert('Código PIX copiado!');
  });
}

// Inicialização dos Ouvintes de Eventos
function setupEventListeners() {
  setupInputMasks();

  // Filtros de visualização
  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-tab').forEach(t => {
        t.classList.remove('bg-emerald-600', 'text-white');
        t.classList.add('bg-slate-100', 'text-slate-700');
      });
      tab.classList.remove('bg-slate-100', 'text-slate-700');
      tab.classList.add('bg-emerald-600', 'text-white');

      state.activeFilter = tab.dataset.filter;
      renderNumbersGrid();
    });
  });

  // Botões de Seleção Rápida (+1, +5, +10, +20)
  document.querySelectorAll('.btn-quick-add').forEach(btn => {
    btn.addEventListener('click', () => {
      const amount = parseInt(btn.dataset.amount, 10);
      addRandomNumbers(amount);
    });
  });

  // Botão Limpar Seleção
  if (elements.btnClearSelection) {
    elements.btnClearSelection.addEventListener('click', () => {
      state.selectedNumbers.clear();
      renderNumbersGrid();
      updateFloatingBar();
    });
  }

  // Abertura e fechamento de modais
  if (elements.btnCheckoutModal) elements.btnCheckoutModal.addEventListener('click', openCheckoutModal);
  if (elements.btnCancelCheckout) elements.btnCancelCheckout.addEventListener('click', closeCheckoutModal);
  if (elements.checkoutForm) elements.checkoutForm.addEventListener('submit', submitOrder);
  if (elements.btnCopyPix) elements.btnCopyPix.addEventListener('click', copyPixCode);
  if (elements.btnClosePixModal) elements.btnClosePixModal.addEventListener('click', closePixModal);
  if (elements.btnSimulatePayment) elements.btnSimulatePayment.addEventListener('click', simulatePayment);

  // Recarregar dados periodicamente a cada 15 segundos para atualizar números tomados por outros
  setInterval(loadRaffleData, 15000);
}

// Inicializar quando DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadRaffleData();
});
