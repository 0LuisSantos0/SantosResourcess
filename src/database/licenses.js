const supabase = require('../supabase/client');

async function getLicenseByDiscordId(discordId) {
    console.log('🔍 [Licenses] Buscando licença para discord_id:', discordId, '(tipo:', typeof discordId + ')');
    if (!supabase) {
        console.error('❌ [Licenses] Supabase não configurado — impossível buscar licença.');
        return null;
    }
    const idStr = String(discordId).trim();
    try {
        let { data, error } = await supabase
            .from('licencas')
            .select('*')
            .eq('discord_id', idStr)
            .maybeSingle();

        if (error) {
            console.error('❌ [Licenses] Erro na query:', error.message);
        }
        if (data) {
            if (data.ativa === false || data.ativa === 0) {
                console.warn('⚠️ [Licenses] Licença encontrada mas está inativa.');
                return null;
            }
            return data;
        }
        return null;
    } catch (err) {
        console.error('❌ [Licenses] Exceção na busca:', err.message);
        return null;
    }
}

async function getAllLicenses() {
    if (!supabase) return [];
    const { data, error } = await supabase
        .from('licencas')
        .select('*')
        .order('id', { ascending: false });

    if (error) {
        console.error('Erro ao buscar todas as licenças:', error);
        return [];
    }
    return data || [];
}

async function createLicense(discordId, usuario, chave) {
    if (!supabase) throw new Error('Supabase não configurado');
    
    // 🔥 CORREÇÃO: Adicionado .single() no final para retornar um objeto em vez de array
    const { data, error } = await supabase
        .from('licencas')
        .insert([{ discord_id: String(discordId), usuario, chave, ativa: true }])
        .select()
        .single(); 

    if (error) {
        console.error('❌ Erro ao criar licença no Supabase:', error);
        throw new Error(`Supabase Error: ${error.message} (Código: ${error.code})`);
    }
    return data;
}

async function updateLicenseIP(discordId, ip) {
    if (!supabase) throw new Error('Supabase não configurado');
    const { data, error } = await supabase
        .from('licencas')
        .update({ ip_permitido: ip })
        .eq('discord_id', String(discordId))
        .select()
        .single(); // 🔥 Adicionado .single()

    if (error) {
        console.error('Erro ao atualizar IP:', error);
        throw error;
    }
    return data;
}

async function toggleLicenseStatus(id) {
    if (!supabase) throw new Error('Supabase não configurado');

    const numericId = parseInt(id, 10);
    if (isNaN(numericId)) throw new Error('ID da licença inválido');

    // 1. Buscar o valor atual
    const { data: current, error: fetchError } = await supabase
        .from('licencas')
        .select('ativa')
        .eq('id', numericId)
        .single();
    
    if (fetchError) {
        console.error('❌ Erro ao buscar licença:', fetchError);
        throw new Error(`Erro ao buscar licença: ${fetchError.message}`);
    }

    // 2. Atualizar SEM tentar ler de volta (evita erro de RLS)
    const { error: updateError } = await supabase
        .from('licencas')
        .update({ ativa: !current.ativa })
        .eq('id', numericId);

    if (updateError) {
        console.error('❌ Erro ao atualizar status:', updateError);
        throw new Error(`Erro ao atualizar status: ${updateError.message}`);
    }

    // 3. Retornar o novo valor
    return { id: numericId, ativa: !current.ativa };
}

async function deleteLicense(id) {
    if (!supabase) throw new Error('Supabase não configurado');
    
    const numericId = parseInt(id, 10);
    if (isNaN(numericId)) throw new Error('ID da licença inválido');

    const { error } = await supabase
        .from('licencas')
        .delete()
        .eq('id', numericId);

    if (error) {
        console.error('❌ Erro ao apagar licença:', error);
        throw new Error(`Erro ao apagar licença: ${error.message}`);
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