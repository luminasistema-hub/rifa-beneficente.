const axios = require('axios');
const db = require('../database');

/**
 * Normaliza o número de telefone para o padrão do WhatsApp (DDI 55 + DDD + Número)
 */
function formatWhatsAppNumber(phone) {
  let clean = (phone || '').replace(/\D/g, '');
  if (!clean) return null;

  // Se o usuário digitou sem o 55 do Brasil (ex: 11999998888), adiciona 55
  if (clean.length === 10 || clean.length === 11) {
    clean = '55' + clean;
  }
  return clean;
}

/**
 * Retorna as credenciais ativas da Evolution API
 */
async function getEvolutionConfig() {
  const settings = await db.getSettings();
  const apiUrl = settings.evolution_api_url || process.env.EVOLUTION_API_URL || '';
  const apiKey = settings.evolution_api_key || process.env.EVOLUTION_API_KEY || '';
  const instance = settings.evolution_instance || process.env.EVOLUTION_INSTANCE_NAME || '';

  return {
    apiUrl: apiUrl.replace(/\/+$/, ''), // remove barra final se houver
    apiKey,
    instance,
    isConfigured: Boolean(apiUrl && apiKey && instance)
  };
}

/**
 * Dispara mensagem de agradecimento pelo WhatsApp via Evolution API
 */
async function sendPurchaseThankYouMessage(order) {
  const config = await getEvolutionConfig();
  const settings = await db.getSettings();
  const targetNumber = formatWhatsAppNumber(order.customer_phone);

  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const myTicketsLink = `${baseUrl}/meus-bilhetes.html?search=${encodeURIComponent(order.customer_phone)}`;

  const numbersListFormatted = order.selected_numbers
    .map(n => `*${n}*`)
    .join(', ');

  const messageText = `🎉 *PAGAMENTO CONFIRMADO!* 🎉\n\n` +
    `Olá, *${order.customer_name}*!\n\n` +
    `Recebemos o seu pagamento de *R$ ${Number(order.total_amount).toFixed(2).replace('.', ',')}* com sucesso! 💚\n\n` +
    `Muito obrigado por apoiar nossa *${settings.title}*! A sua contribuição é fundamental para o sucesso da nossa causa solidária.\n\n` +
    `📋 *SEUS NÚMEROS DA SORTE:*\n` +
    `👉 ${numbersListFormatted}\n\n` +
    `🏆 *Prêmio:* ${settings.prize}\n\n` +
    `Consulte seus bilhetes a qualquer momento neste link:\n` +
    `🔗 ${myTicketsLink}\n\n` +
    `Boa sorte e que Deus abençoe sua generosidade! 🙏✨`;

  if (!config.isConfigured) {
    console.log(`\n📢 [EVOLUTION API - SIMULAÇÃO] (Configurações não preenchidas no .env ou Admin)`);
    console.log(`Para: ${targetNumber} (${order.customer_name})`);
    console.log(`Mensagem:\n${messageText}\n---------------------------------------------`);
    return { success: true, simulated: true };
  }

  try {
    const endpoint = `${config.apiUrl}/message/sendText/${encodeURIComponent(config.instance)}`;
    const payload = {
      number: targetNumber,
      text: messageText,
      options: {
        delay: 1200,
        presence: 'composing',
        linkPreview: true
      }
    };

    const response = await axios.post(endpoint, payload, {
      headers: {
        apikey: config.apiKey,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    console.log(`✅ Mensagem de agradecimento enviada via WhatsApp para ${targetNumber}!`);
    return { success: true, data: response.data };
  } catch (err) {
    console.error(`❌ Erro ao enviar WhatsApp via Evolution API (${targetNumber}):`, err.response ? err.response.data : err.message);
    return { success: false, error: err.response?.data || err.message };
  }
}

/**
 * Consulta todas as instâncias existentes na Evolution API e seus status
 */
async function fetchEvolutionInstances() {
  const config = await getEvolutionConfig();
  if (!config.apiUrl || !config.apiKey) {
    throw new Error('URL e API Key da Evolution API não estão configuradas.');
  }

  const endpoint = `${config.apiUrl}/instance/fetchInstances`;
  const response = await axios.get(endpoint, {
    headers: { apikey: config.apiKey },
    timeout: 10000
  });

  const instances = Array.isArray(response.data) ? response.data : [];
  return instances.map(inst => ({
    name: inst.name,
    status: inst.connectionStatus, // 'open', 'close', 'connecting'
    profileName: inst.profileName || null,
    ownerJid: inst.ownerJid || null,
    profilePicUrl: inst.profilePicUrl || null
  }));
}

/**
 * Consulta o estado de conexão de uma instância específica
 */
async function getInstanceConnectionState(instanceName) {
  const config = await getEvolutionConfig();
  const name = instanceName || config.instance;
  if (!config.apiUrl || !config.apiKey || !name) {
    throw new Error('Evolution API ou instância não configurada.');
  }

  const endpoint = `${config.apiUrl}/instance/connectionState/${encodeURIComponent(name)}`;
  const response = await axios.get(endpoint, {
    headers: { apikey: config.apiKey },
    timeout: 10000
  });

  return response.data?.instance?.state || 'unknown';
}

/**
 * Obtém o QR Code em base64 para conexão do WhatsApp caso a instância esteja desconectada
 */
async function getInstanceQrCode(instanceName) {
  const config = await getEvolutionConfig();
  const name = instanceName || config.instance;
  if (!config.apiUrl || !config.apiKey || !name) {
    throw new Error('Evolution API ou instância não configurada.');
  }

  const endpoint = `${config.apiUrl}/instance/connect/${encodeURIComponent(name)}`;
  const response = await axios.get(endpoint, {
    headers: { apikey: config.apiKey },
    timeout: 15000
  });

  return {
    base64: response.data?.base64 || null,
    code: response.data?.code || null,
    pairingCode: response.data?.pairingCode || null
  };
}

/**
 * Testa a conexão com a Evolution API enviando uma mensagem de teste
 */
async function testEvolutionConnection(targetPhone, testMessage) {
  const config = await getEvolutionConfig();
  if (!config.isConfigured) {
    throw new Error('Evolution API não configurada. Preencha URL, API Key e Nome da Instância.');
  }

  const targetNumber = formatWhatsAppNumber(targetPhone);
  if (!targetNumber) {
    throw new Error('Número de telefone inválido.');
  }

  const endpoint = `${config.apiUrl}/message/sendText/${encodeURIComponent(config.instance)}`;
  const response = await axios.post(endpoint, {
    number: targetNumber,
    text: testMessage || '🧪 Teste de integração do Sistema de Rifa com a Evolution API funcionando com sucesso!'
  }, {
    headers: {
      apikey: config.apiKey,
      'Content-Type': 'application/json'
    },
    timeout: 15000
  });

  return response.data;
}

module.exports = {
  getEvolutionConfig,
  formatWhatsAppNumber,
  sendPurchaseThankYouMessage,
  fetchEvolutionInstances,
  getInstanceConnectionState,
  getInstanceQrCode,
  testEvolutionConnection
};

