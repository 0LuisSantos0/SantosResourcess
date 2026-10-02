const supabase = require('../supabase/client');
const logger = require('../utils/logger'); // Se não tiveres o logger no site, podes usar console.log

async function createLicense(discordId, usuario, chave) {
    if (!supabase) throw new Error('Supabase não configurado');
    const { data, error } = await supabase
        .from('licencas')
        .insert([{ discord_id: discordId, usuario, chave, ativa: true }])
        .select();

    if (error) {
        console.error('Erro ao criar licença:', error);
        throw error;
    }
    return data[0];
}

async function getLicenseByDiscordId(discordId) {
    if (!supabase) return null;
    const { data, error } = await supabase
        .from('licencas')
        .select('*')
        .eq('discord_id', discordId)
        .eq('ativa', true)
        .single();

    if (error && error.code !== 'PGRST116') {
        console.error('Erro ao buscar licença por Discord ID:', error);
        throw error;
    }
    return data;
}

async function getAllLicenses() {
    if (!supabase) return [];
    const { data, error } = await supabase
        .from('licencas')
        .select('*')
        .order('id', { ascending: false });

    if (error) {
        console.error('Erro ao buscar todas as licenças:', error);
        throw error;
    }
    return data;
}

async function updateLicenseIP(discordId, ip) {
    if (!supabase) throw new Error('Supabase não configurado');
    const { data, error } = await supabase
        .from('licencas')
        .update({ ip_permitido: ip })
        .eq('discord_id', discordId)
        .eq('ativa', true)
        .select();

    if (error) {
        console.error('Erro ao atualizar IP:', error);
        throw error;
    }
    return data[0];
}

async function toggleLicenseStatus(id) {
    if (!supabase) throw new Error('Supabase não configurado');
    // Primeiro obtém o estado atual
    const { data: current, error: fetchError } = await supabase
        .from('licencas')
        .select('ativa')
        .eq('id', id)
        .single();
    
    if (fetchError) throw fetchError;

    const { data, error } = await supabase
        .from('licencas')
        .update({ ativa: !current.ativa })
        .eq('id', id)
        .select();

    if (error) throw error;
    return data[0];
}

async function deleteLicense(id) {
    if (!supabase) throw new Error('Supabase não configurado');
    const { error } = await supabase
        .from('licencas')
        .delete()
        .eq('id', id);

    if (error) throw error;
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