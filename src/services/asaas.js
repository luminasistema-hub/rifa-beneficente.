const axios = require('axios');
const db = require('../database');

/**
 * Retorna as credenciais ativas do Asaas (do Supabase/Settings ou do .env)
 */
async function getAsaasConfig() {
  const settings = await db.getSettings();
  const apiKey = (settings.asaas_api_key && settings.asaas_api_key.trim()) || process.env.ASAAS_API_KEY || '';
  let env = (settings.asaas_environment && settings.asaas_environment.trim()) || process.env.ASAAS_ENVIRONMENT || 'sandbox';

  // Detecção automática inteligente baseada no prefixo da chave Asaas
  if (apiKey.startsWith('$aact_prod_')) {
    env = 'production';
  } else if (apiKey.startsWith('$aact_sand_')) {
    env = 'sandbox';
  }

  const baseUrl = env === 'production' 
    ? 'https://api.asaas.com/v3' 
    : 'https://sandbox.asaas.com/api/v3';

  return {
    apiKey,
    env,
    baseUrl,
    isConfigured: Boolean(apiKey && apiKey.trim().length > 10)
  };
}

/**
 * Cria ou recupera cliente no Asaas
 */
async function getOrCreateCustomer({ name, cpfCnpj, mobilePhone, email }) {
  const config = await getAsaasConfig();
  if (!config.isConfigured) {
    return 'cus_simulado_' + Math.random().toString(36).substring(2, 9);
  }

  const cleanCpf = (cpfCnpj || '').replace(/\D/g, '');
  let cleanPhone = (mobilePhone || '').replace(/\D/g, '');
  // Remove código do país 55 se o usuário digitou com DDI (ex: 5563999998888 -> 63999998888)
  if ((cleanPhone.length === 12 || cleanPhone.length === 13) && cleanPhone.startsWith('55')) {
    cleanPhone = cleanPhone.substring(2);
  }

  try {
    // 1. Tenta buscar cliente existente por CPF
    if (cleanCpf) {
      const searchRes = await axios.get(`${config.baseUrl}/customers`, {
        headers: { access_token: config.apiKey },
        params: { cpfCnpj: cleanCpf }
      });
      if (searchRes.data && searchRes.data.data && searchRes.data.data.length > 0) {
        const existingCustomer = searchRes.data.data[0];
        // Se o nome atual do cliente for diferente, atualiza no Asaas
        if (existingCustomer.name !== name.trim()) {
          try {
            await axios.put(`${config.baseUrl}/customers/${existingCustomer.id}`, {
              name: name.trim(),
              mobilePhone: cleanPhone || existingCustomer.mobilePhone,
              email: (email && email.trim()) || existingCustomer.email
            }, {
              headers: { access_token: config.apiKey }
            });
          } catch (updateErr) {
            console.warn('Aviso ao atualizar nome do cliente existente no Asaas:', updateErr.message);
          }
        }
        return existingCustomer.id;
      }
    }

    // 2. Cria novo cliente
    const createRes = await axios.post(`${config.baseUrl}/customers`, {
      name: name.trim(),
      cpfCnpj: cleanCpf,
      mobilePhone: cleanPhone,
      email: email ? email.trim() : undefined
    }, {
      headers: { access_token: config.apiKey }
    });

    return createRes.data.id;
  } catch (err) {
    console.error('Erro na API Asaas ao criar/buscar cliente:', err.response ? err.response.data : err.message);
    const ipError = err.response?.data?.errors?.find(e => e.code === 'not_allowed_ip');
    if (ipError) {
      throw new Error(`Asaas bloqueou o acesso por IP. No Asaas, acesse Minha Conta > Integrações > Chaves de API e remova a restrição de IP para permitir chamadas da nuvem.`);
    }
    const errorMsg = err.response?.data?.errors?.map(e => e.description).join(', ') || err.message;
    throw new Error('Falha ao registrar cliente no Asaas: ' + errorMsg);
  }
}

/**
 * Cria cobrança PIX no Asaas
 */
async function createPixCharge({ customerId, value, description, externalReference }) {
  const config = await getAsaasConfig();

  // Se não estiver configurado, retorna payload simulado para testes imediatos
  if (!config.isConfigured) {
    console.log('ℹ️ Asaas API não configurada. Gerando cobrança PIX em modo de teste/simulação.');
    const mockPaymentId = 'pay_simulado_' + Date.now();
    const mockPixCode = `00020126580014br.gov.bcb.pix0136${externalReference}520400005303986540${value.toFixed(2)}5802BR5925RIFA SOLIDARIA BENEFICENTE6009SAO PAULO62070503***6304ABCD`;
    
    // QR Code SVG em data URI para renderizar sem bibliotecas externas
    const mockQrImage = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220" viewBox="0 0 220 220"><rect width="220" height="220" fill="%23ffffff"/><rect x="20" y="20" width="60" height="60" fill="%23000000"/><rect x="30" y="30" width="40" height="40" fill="%23ffffff"/><rect x="40" y="40" width="20" height="20" fill="%23000000"/><rect x="140" y="20" width="60" height="60" fill="%23000000"/><rect x="150" y="30" width="40" height="40" fill="%23ffffff"/><rect x="160" y="40" width="20" height="20" fill="%23000000"/><rect x="20" y="140" width="60" height="60" fill="%23000000"/><rect x="30" y="150" width="40" height="40" fill="%23ffffff"/><rect x="40" y="160" width="20" height="20" fill="%23000000"/><circle cx="110" cy="110" r="16" fill="%23059669"/><text x="110" y="114" font-family="sans-serif" font-size="10" font-weight="bold" fill="%23ffffff" text-anchor="middle">PIX</text></svg>`;

    return {
      paymentId: mockPaymentId,
      invoiceUrl: `https://sandbox.asaas.com/i/${mockPaymentId}`,
      pixQrCode: mockQrImage,
      pixCode: mockPixCode,
      isSimulated: true
    };
  }

  try {
    const today = new Date();
    const dueDate = today.toISOString().split('T')[0];

    // 1. Cria cobrança PIX
    const paymentRes = await axios.post(`${config.baseUrl}/payments`, {
      customer: customerId,
      billingType: 'PIX',
      value: parseFloat(value.toFixed(2)),
      dueDate: dueDate,
      description: description,
      externalReference: externalReference
    }, {
      headers: { access_token: config.apiKey }
    });

    const paymentId = paymentRes.data.id;
    const invoiceUrl = paymentRes.data.invoiceUrl;

    // 2. Busca o QR Code e o Copia e Cola PIX
    const qrRes = await axios.get(`${config.baseUrl}/payments/${paymentId}/pixQrCode`, {
      headers: { access_token: config.apiKey }
    });

    const encodedImage = qrRes.data.encodedImage;
    // Asaas retorna encodedImage em base64 puro
    const pixQrCode = encodedImage.startsWith('data:') 
      ? encodedImage 
      : `data:image/png;base64,${encodedImage}`;

    return {
      paymentId,
      invoiceUrl,
      pixQrCode,
      pixCode: qrRes.data.payload,
      isSimulated: false
    };
  } catch (err) {
    console.error('Erro na API Asaas ao gerar cobrança PIX:', err.response ? err.response.data : err.message);
    const ipError = err.response?.data?.errors?.find(e => e.code === 'not_allowed_ip');
    if (ipError) {
      throw new Error(`Asaas bloqueou o acesso por IP. No Asaas, acesse Minha Conta > Integrações > Chaves de API e remova a restrição de IP para permitir chamadas da nuvem.`);
    }
    const errorMsg = err.response?.data?.errors?.[0]?.description || err.message;
    throw new Error('Falha ao gerar cobrança PIX no Asaas: ' + errorMsg);
  }
}

/**
 * Consulta status de um pagamento no Asaas
 */
async function getPaymentStatus(paymentId) {
  if (paymentId.startsWith('pay_simulado_')) {
    return { status: 'PENDING', isSimulated: true };
  }

  const config = await getAsaasConfig();
  if (!config.isConfigured) return null;

  try {
    const res = await axios.get(`${config.baseUrl}/payments/${paymentId}`, {
      headers: { access_token: config.apiKey }
    });
    return res.data;
  } catch (err) {
    console.error('Erro ao consultar status no Asaas:', err.response?.data || err.message);
    return null;
  }
}

/**
 * Valida a conexão com o Asaas consultando o saldo da conta
 */
async function testAsaasConnection(customApiKey, customEnv) {
  const config = await getAsaasConfig();
  const apiKey = (customApiKey && customApiKey.trim()) || config.apiKey;
  const env = (customEnv && customEnv.trim()) || config.env || 'sandbox';
  const baseUrl = env === 'production' 
    ? 'https://api.asaas.com/v3' 
    : 'https://sandbox.asaas.com/api/v3';

  if (!apiKey || apiKey.length < 10) {
    throw new Error('Chave de API do Asaas não fornecida ou inválida.');
  }

  try {
    const res = await axios.get(`${baseUrl}/finance/balance`, {
      headers: { access_token: apiKey },
      timeout: 10000
    });
    return {
      success: true,
      environment: env,
      balance: res.data?.balance || 0,
      raw: res.data
    };
  } catch (err) {
    console.error('Erro na validação do Asaas:', err.response?.data || err.message);
    const msg = err.response?.data?.errors?.map(e => e.description).join(', ') || err.message;
    throw new Error('Falha ao autenticar no Asaas: ' + msg);
  }
}

module.exports = {
  getAsaasConfig,
  getOrCreateCustomer,
  createPixCharge,
  getPaymentStatus,
  testAsaasConnection
};

