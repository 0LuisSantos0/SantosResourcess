const { Pool } = require('pg');
require('dotenv').config();

console.log('🔍 A tentar ligar ao PostgreSQL...');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.on('error', (err) => {
  console.error('❌ Erro inesperado no pool do banco de dados:', err);
});

const initDB = async () => {
  try {
    await pool.query('SELECT NOW()');
    console.log('✅ Ligação ao PostgreSQL estabelecida com sucesso!');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id SERIAL PRIMARY KEY,
        site_name TEXT,
        discord_link TEXT,
        logo_url TEXT
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        price REAL NOT NULL DEFAULT 0.00,
        category TEXT DEFAULT 'MTA',
        is_active INTEGER DEFAULT 1,
        is_featured INTEGER DEFAULT 0,
        thumbnail TEXT,
        video_link TEXT,
        features TEXT,
        badge TEXT,
        badge_color TEXT DEFAULT '#94a3b8'
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        discord_id TEXT UNIQUE NOT NULL,
        username TEXT NOT NULL,
        avatar TEXT,
        is_admin INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP,
        cart JSONB DEFAULT '[]'::jsonb
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS discounts (
        id SERIAL PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        description TEXT,
        percentage INTEGER NOT NULL,
        is_active INTEGER DEFAULT 1
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS payment_methods (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        icon TEXT, -- classe FontAwesome (ex: fa-credit-card)
        display_order INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id SERIAL PRIMARY KEY,
        admin_discord_id TEXT NOT NULL,
        admin_username TEXT NOT NULL,
        action TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "sid" varchar NOT NULL PRIMARY KEY,
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL
      );
    `);

    await pool.query(`
      INSERT INTO settings (id, site_name, discord_link)
      SELECT 1, 'Santos Resources', 'https://discord.gg/8GyNS5vRgt'
      WHERE NOT EXISTS (SELECT 1 FROM settings WHERE id = 1);
    `);

    console.log('✅ Tabelas verificadas/criadas com sucesso.');
  } catch (err) {
    console.error('❌ ERRO GRAVE AO CONECTAR OU CRIAR TABELAS:');
    console.error(err);
  }
};

module.exports = { pool, initDB };