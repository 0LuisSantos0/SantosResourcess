const supabase = require('../supabase/client');

// Criar nova licença
async function createLicense(discordId, usuario, chave) {
  const { data, error } = await supabase
    .from('licencas')
    .insert([
      {
        discord_id: String(discordId),
        usuario: usuario,
        chave: chave,
        ip_permitido: '',
        ativa: true,
        criado_em: new Date().toISOString()
      }
    ])
    .select();

  if (error) {
    console.error('❌ Erro Supabase (createLicense):', error);
    throw error;
  }
  return data[0];
}

// Buscar licença por Discord ID
async function getLicenseByDiscordId(discordId) {
  const { data, error } = await supabase
    .from('licencas')
    .select('*')
    .eq('discord_id', String(discordId))
    .maybeSingle();

  if (error) {
    console.error('❌ Erro Supabase (getLicenseByDiscordId):', error);
    return null;
  }
  return data;
}

// Listar todas as licenças (ordenadas pelas mais recentes)
async function getAllLicenses() {
  const { data, error } = await supabase
    .from('licencas')
    .select('*')
    .order('criado_em', { ascending: false });

  if (error) {
    console.error('❌ Erro Supabase (getAllLicenses):', error);
    return [];
  }
  return data || [];
}

// Atualizar IP permitido
async function updateLicenseIP(discordId, ip) {
  const { data, error } = await supabase
    .from('licencas')
    .update({ ip_permitido: ip })
    .eq('discord_id', String(discordId))
    .select();

  if (error) {
    console.error('❌ Erro Supabase (updateLicenseIP):', error);
    throw error;
  }
  return data;
}

// Alternar estado de ativação (ativa / inativa)
async function toggleLicenseStatus(id) {
  const { data: current, error: fetchError } = await supabase
    .from('licencas')
    .select('ativa')
    .eq('id', id)
    .single();

  if (fetchError || !current) {
    console.error('❌ Licença não encontrada:', fetchError);
    return;
  }

  const { data, error } = await supabase
    .from('licencas')
    .update({ ativa: !current.ativa })
    .eq('id', id)
    .select();

  if (error) {
    console.error('❌ Erro Supabase (toggleLicenseStatus):', error);
    throw error;
  }
  return data;
}

// Apagar licença
async function deleteLicense(id) {
  const { error } = await supabase
    .from('licencas')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('❌ Erro Supabase (deleteLicense):', error);
    throw error;
  }
  return true;
}

module.exports = {
  createLicense,
  getLicenseByDiscordId,
  getAllLicenses,
  updateLicenseIP,
  toggleLicenseStatus,
  deleteLicense
};