const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

console.log('Testando conexão com Supabase:', url);
const client = createClient(url, key);

async function test() {
  try {
    const { data: settings, error: sErr } = await client.from('raffle_settings').select('*');
    if (sErr) {
      console.log('⚠️ Tabela raffle_settings:', sErr.message);
    } else {
      console.log('✅ Tabela raffle_settings encontrada! Registros:', settings?.length);
    }

    const { data: numbers, error: nErr } = await client.from('raffle_numbers').select('number').limit(5);
    if (nErr) {
      console.log('⚠️ Tabela raffle_numbers:', nErr.message);
    } else {
      console.log('✅ Tabela raffle_numbers encontrada! Registros:', numbers?.length);
    }

    const { data: orders, error: oErr } = await client.from('raffle_orders').select('*').limit(5);
    if (oErr) {
      console.log('⚠️ Tabela raffle_orders:', oErr.message);
    } else {
      console.log('✅ Tabela raffle_orders encontrada! Registros:', orders?.length);
    }
  } catch (err) {
    console.error('Erro na conexão:', err.message);
  }
}

test();
