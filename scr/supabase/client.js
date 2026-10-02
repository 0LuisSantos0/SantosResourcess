const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

console.log('🔍 [Supabase] Verificando variáveis de ambiente:');
console.log('   SUPABASE_URL:', SUPABASE_URL ? `✅ definida (${SUPABASE_URL.substring(0, 30)}...)` : '❌ NÃO DEFINIDA');
console.log('   SUPABASE_KEY:', SUPABASE_KEY ? `✅ definida (${SUPABASE_KEY.substring(0, 15)}...)` : '❌ NÃO DEFINIDA');

let supabase = null;

if (SUPABASE_URL && SUPABASE_KEY) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('✅ [Supabase] Cliente criado com sucesso.');
  } catch (err) {
    console.error('❌ [Supabase] Erro ao criar cliente:', err.message);
  }
} else {
  console.error('❌ [Supabase] Cliente NÃO criado — variáveis em falta.');
}

module.exports = supabase;