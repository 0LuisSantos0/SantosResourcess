const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('⚠️️ AVISO: SUPABASE_URL ou SUPABASE_KEY não estão configurados no ficheiro .env');
}

const supabase = createClient(supabaseUrl || '', supabaseKey || '');

module.exports = supabase;