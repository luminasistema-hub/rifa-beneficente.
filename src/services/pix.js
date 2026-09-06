const QRCode = require('qrcode');

/**
 * Normaliza strings para o padrão EMV (sem acentos, maiúsculas, tamanho limitado)
 */
function cleanString(str, maxLength) {
  if (!str) return '';
  const cleaned = str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
  return maxLength ? cleaned.substring(0, maxLength) : cleaned;
}

/**
 * Formata campo no padrão TLV (Tag - Length - Value) do EMV QRCPS / BRCode
 */
function formatTLV(id, value) {
  const len = String(value.length).padStart(2, '0');
  return `${id}${len}${value}`;
}

/**
 * Calcula CRC-16 (CCITT-FALSE, Poly 0x1021, Init 0xFFFF) para fechamento do BRCode
 */
function calculateCRC16(payload) {
  let crc = 0xFFFF;
  const polynomial = 0x1021;

  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ polynomial) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Gera o código PIX Copia e Cola Oficial (BRCode do Banco Central)
 */
function generatePixCode({ key, name, city, amount, txId, description }) {
  const cleanedKey = key.trim();
  const cleanedName = cleanString(name || 'RIFA BENEFICENTE', 25);
  const cleanedCity = cleanString(city || 'BRASILIA', 15);
  const formattedAmount = Number(amount).toFixed(2);
  const cleanedTxId = cleanString(txId ? txId.replace(/[^a-zA-Z0-9]/g, '') : '***', 25) || '***';

  // Subtags da Conta Merchant (Tag 26)
  let merchantAccountInfo = formatTLV('00', 'br.gov.bcb.pix');
  merchantAccountInfo += formatTLV('01', cleanedKey);
  if (description) {
    merchantAccountInfo += formatTLV('02', cleanString(description, 25));
  }

  // Subtags do Campo Adicional (Tag 62)
  const additionalData = formatTLV('05', cleanedTxId);

  // Monta payload preliminar sem o CRC16
  let payload = '';
  payload += formatTLV('00', '01'); // Payload Format Indicator
  payload += formatTLV('01', '12'); // Point of Initiation: Dinâmico/Específico
  payload += formatTLV('26', merchantAccountInfo); // Merchant Account Information
  payload += formatTLV('52', '0000'); // Merchant Category Code
  payload += formatTLV('53', '986'); // Currency: BRL (986)
  payload += formatTLV('54', formattedAmount); // Transaction Amount
  payload += formatTLV('58', 'BR'); // Country Code
  payload += formatTLV('59', cleanedName); // Merchant Name
  payload += formatTLV('60', cleanedCity); // Merchant City
  payload += formatTLV('62', additionalData); // Additional Data (TxId)
  payload += '6304'; // Tag do CRC16 com tamanho 04

  // Calcula CRC16 e anexa
  const crc = calculateCRC16(payload);
  return `${payload}${crc}`;
}

/**
 * Gera QR Code em Data URI (PNG base64) para renderização direta no frontend
 */
async function generateQrCodeDataUrl(pixCode) {
  return await QRCode.toDataURL(pixCode, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320,
    color: {
      dark: '#0f172a',
      light: '#ffffff'
    }
  });
}

/**
 * Gera pacote completo do PIX (Copia e Cola + Imagem QR Code)
 */
async function createDirectPixPayment({ key, name, city, amount, txId, description }) {
  const pixCode = generatePixCode({ key, name, city, amount, txId, description });
  const pixQrCode = await generateQrCodeDataUrl(pixCode);

  return {
    pixCode,
    pixQrCode
  };
}

module.exports = {
  generatePixCode,
  generateQrCodeDataUrl,
  createDirectPixPayment,
  calculateCRC16
};
