const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'database.db'));

db.serialize(() => {
  // 1. Tabela de Produtos (Sem imagem!)
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    name TEXT NOT NULL, 
    description TEXT NOT NULL, 
    price REAL NOT NULL DEFAULT 0.00, 
    category TEXT DEFAULT 'MTA',
    is_active INTEGER DEFAULT 1
  )`);
  
  // 2. Tabela de Utilizadores
  db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, discord_id TEXT UNIQUE NOT NULL, username TEXT NOT NULL, avatar TEXT, is_admin INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, last_login DATETIME)`);
  
  // 3. Tabela de Descontos
  db.run(`CREATE TABLE IF NOT EXISTS discounts (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, description TEXT, percentage INTEGER NOT NULL, is_active INTEGER DEFAULT 1)`);

  // 4. Tabela de Logs de Atividade (NOVO!)
  db.run(`CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_discord_id TEXT NOT NULL,
    admin_username TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // 5. Tabela de Configurações (NOVO!)
  db.run(`CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY AUTOINCREMENT, site_name TEXT, discord_link TEXT)`);
  db.run(`INSERT OR IGNORE INTO settings (id, site_name, discord_link) VALUES (1, 'Santos Resources', 'https://discord.gg/8GyNS5vRgt')`);
});

console.log('✅ Banco de dados atualizado com sucesso!');
module.exports = db;