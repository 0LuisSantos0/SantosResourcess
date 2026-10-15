const axios = require('axios');
const config = require('../../config');

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

async function addRoleToUser(discordId, roleId) {
  if (!BOT_TOKEN || !GUILD_ID) {
    console.error('❌ [Discord] BOT_TOKEN ou GUILD_ID não configurados — cargo ignorado.');
    return false;
  }
  if (!roleId || roleId.startsWith('INSERIR_')) {
    console.error('❌ [Discord] roleId inválido/não configurado:', roleId);
    return false;
  }

  try {
    await axios.put(
      `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${discordId}/roles/${roleId}`,
      {},
      { headers: { Authorization: `Bot ${BOT_TOKEN}` } }
    );
    console.log(`✅ [Discord] Cargo ${roleId} atribuído a ${discordId}`);
    return true;
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error(`❌ [Discord] Falha ao atribuir cargo ${roleId} a ${discordId}:`, detail);
    return false;
  }
}

async function giveClientRole(discordId) {
  return addRoleToUser(discordId, config.CLIENT_ROLE_ID);
}

async function giveClientFreeRole(discordId) {
  return addRoleToUser(discordId, config.CLIENT_FREE_ROLE_ID);
}

module.exports = { addRoleToUser, giveClientRole, giveClientFreeRole };