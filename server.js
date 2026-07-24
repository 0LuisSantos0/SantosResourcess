require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const db = require('./database');
const config = require('./config');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: 'santos-resources-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

// Função para registar logs de atividade
function logActivity(req, action) {
  if (req.session.user) {
    db.run(`INSERT INTO activity_logs (admin_discord_id, admin_username, action) VALUES (?, ?, ?)`, 
      [req.session.user.id, req.session.user.username, action]);
  }
}

function isAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/');
  if (config.ADMIN_IDS.includes(req.session.user.id)) return next();
  db.get('SELECT is_admin FROM users WHERE discord_id = ?', [req.session.user.id], (err, row) => {
    if (err || !row || row.is_admin !== 1) return res.redirect('/');
    next();
  });
}

app.get('/', (req, res) => {
  db.all('SELECT * FROM products WHERE is_active = 1 ORDER BY id ASC', (err, products) => {
    if (err) return res.send('Erro ao carregar produtos.');
    res.render('home', { products, user: req.session.user || null, isAdmin: req.session.user && config.ADMIN_IDS.includes(req.session.user.id) });
  });
});

app.get('/products', (req, res) => {
  db.all('SELECT * FROM products ORDER BY id ASC', (err, products) => {
    if (err) return res.render('products', { products: [], user: req.session.user || null, isAdmin: req.session.user && config.ADMIN_IDS.includes(req.session.user.id), error: 'Erro ao carregar produtos: ' + err.message });
    res.render('products', { products, user: req.session.user || null, isAdmin: req.session.user && config.ADMIN_IDS.includes(req.session.user.id), error: null });
  });
});

app.get('/about', (req, res) => {
  res.render('about', { user: req.session.user || null, isAdmin: req.session.user && config.ADMIN_IDS.includes(req.session.user.id) });
});

app.get('/auth/discord', (req, res) => {
  res.redirect(`https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=identify`);
});

app.get('/auth/discord/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/');
  try {
    const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI
    }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const accessToken = tokenResponse.data.access_token;
    const userResponse = await axios.get('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${accessToken}` } });
    const user = userResponse.data;
    req.session.user = user;
    const now = new Date().toISOString();
    await new Promise((resolve, reject) => {
      db.run(`INSERT INTO users (discord_id, username, avatar, last_login) VALUES (?, ?, ?, ?) ON CONFLICT(discord_id) DO UPDATE SET username = excluded.username, avatar = excluded.avatar, last_login = excluded.last_login`, [user.id, user.username, user.avatar, now], function(err) { if (err) reject(err); else resolve(); });
    });
    if (config.ADMIN_IDS.includes(user.id)) return res.redirect('/admin');
    db.get('SELECT is_admin FROM users WHERE discord_id = ?', [user.id], (err, row) => {
      if (err || !row) return res.redirect('/');
      if (row.is_admin === 1) res.redirect('/admin'); else res.redirect('/');
    });
  } catch (error) {
    console.error('Erro no login Discord:', error);
    res.redirect('/?error=auth_failed');
  }
});

app.get('/logout', (req, res) => { req.session.destroy(() => res.redirect('/')); });

// =========================================================================
// ÁREA ADMINISTRATIVA
// =========================================================================
app.get('/admin/dashboard', isAdmin, (req, res) => {
  // Queries para as novas estatísticas
  db.get('SELECT COUNT(*) as total_users FROM users', (err, userCount) => {
    db.get('SELECT COUNT(*) as mta_scripts FROM products WHERE category = "MTA"', (err, mtaCount) => {
      db.get('SELECT COUNT(*) as discord_bots FROM products WHERE category = "Discord Bot"', (err, botCount) => {
        db.get('SELECT COUNT(*) as total_discounts FROM discounts', (err, discountCount) => {
          res.render('admin/dashboard', { 
            stats: { 
              total_users: userCount?.total_users || 0,
              mta_scripts: mtaCount?.mta_scripts || 0,
              discord_bots: botCount?.discord_bots || 0,
              total_discounts: discountCount?.total_discounts || 0
            }, 
            activeTab: 'dashboard', 
            user: req.session.user 
          });
        });
      });
    });
  });
});

// ------------------------ PRODUTOS ------------------------
app.get('/admin', isAdmin, (req, res) => {
  db.all('SELECT * FROM products ORDER BY id ASC', (err, products) => {
    if (err) return res.render('admin/products', { products: [], activeTab: 'products', error: 'Erro: ' + err.message, user: req.session.user });
    res.render('admin/products', { products, activeTab: 'products', error: null, user: req.session.user });
  });
});

app.post('/admin/products/add', isAdmin, (req, res) => {
  const { name, description, price, category } = req.body;
  if (!name || !description || !price) return res.redirect('/admin?error=missing_fields');
  db.run('INSERT INTO products (name, description, price, category, is_active) VALUES (?, ?, ?, ?, 1)', [name, description, parseFloat(price), category || 'MTA'], (err) => {
    if (!err) logActivity(req, `Criou o produto: ${name}`);
    else console.error(err);
    res.redirect('/admin');
  });
});

app.post('/admin/products/edit/:id', isAdmin, (req, res) => {
  const { name, description, price, category } = req.body;
  db.run('UPDATE products SET name = ?, description = ?, price = ?, category = ? WHERE id = ?', [name, description, parseFloat(price), category || 'MTA', req.params.id], (err) => {
    if (!err) logActivity(req, `Editou o produto: ${name}`);
    else console.error(err);
    res.redirect('/admin');
  });
});

app.post('/admin/products/delete/:id', isAdmin, (req, res) => {
  db.get('SELECT name FROM products WHERE id = ?', [req.params.id], (err, row) => {
    db.run('DELETE FROM products WHERE id = ?', [req.params.id], (err) => {
      if (!err) logActivity(req, `Apagou o produto: ${row?.name || 'ID ' + req.params.id}`);
      else console.error(err);
      res.redirect('/admin');
    });
  });
});

app.post('/admin/toggle/:id', isAdmin, (req, res) => {
  db.run('UPDATE products SET is_active = NOT is_active WHERE id = ?', [req.params.id], (err) => {
    if (err) console.error(err);
    res.redirect('/admin');
  });
});

// ------------------------ UTILIZADORES ------------------------
app.get('/admin/users', isAdmin, (req, res) => {
  db.all('SELECT * FROM users ORDER BY id ASC', (err, users) => {
    if (err) return res.render('admin/users', { users: [], activeTab: 'users', error: 'Erro: Apague o "database.db" e reinicie.', user: req.session.user });
    res.render('admin/users', { users, activeTab: 'users', error: null, user: req.session.user });
  });
});

app.post('/admin/users/toggle/:id', isAdmin, (req, res) => {
  db.get('SELECT username FROM users WHERE id = ?', [req.params.id], (err, row) => {
    db.run('UPDATE users SET is_admin = NOT is_admin WHERE id = ?', [req.params.id], (err) => {
      if (!err) logActivity(req, `Alterou o status de admin do utilizador: ${row?.username || 'ID ' + req.params.id}`);
      else console.error(err);
      res.redirect('/admin/users');
    });
  });
});

// ------------------------ DESCONTOS ------------------------
app.get('/admin/discounts', isAdmin, (req, res) => {
  db.all('SELECT * FROM discounts ORDER BY id ASC', (err, discounts) => {
    if (err) return res.render('admin/discounts', { discounts: [], activeTab: 'discounts', error: 'Erro: Apague o "database.db" e reinicie.', user: req.session.user });
    res.render('admin/discounts', { discounts, activeTab: 'discounts', error: null, user: req.session.user });
  });
});

app.post('/admin/discounts/add', isAdmin, (req, res) => {
  const { code, description, percentage } = req.body;
  if (!code || !percentage) return res.redirect('/admin/discounts?error=missing_fields');
  db.run('INSERT INTO discounts (code, description, percentage, is_active) VALUES (?, ?, ?, 1)', [code, description, parseInt(percentage)], (err) => {
    if (!err) logActivity(req, `Criou o desconto: ${code}`);
    else console.error(err);
    res.redirect('/admin/discounts');
  });
});

app.post('/admin/discounts/edit/:id', isAdmin, (req, res) => {
  const { code, description, percentage } = req.body;
  db.run('UPDATE discounts SET code = ?, description = ?, percentage = ? WHERE id = ?', [code, description, parseInt(percentage), req.params.id], (err) => {
    if (!err) logActivity(req, `Editou o desconto: ${code}`);
    else console.error(err);
    res.redirect('/admin/discounts');
  });
});

app.post('/admin/discounts/delete/:id', isAdmin, (req, res) => {
  db.get('SELECT code FROM discounts WHERE id = ?', [req.params.id], (err, row) => {
    db.run('DELETE FROM discounts WHERE id = ?', [req.params.id], (err) => {
      if (!err) logActivity(req, `Apagou o desconto: ${row?.code || 'ID ' + req.params.id}`);
      else console.error(err);
      res.redirect('/admin/discounts');
    });
  });
});

app.post('/admin/discounts/toggle/:id', isAdmin, (req, res) => {
  db.run('UPDATE discounts SET is_active = NOT is_active WHERE id = ?', [req.params.id], (err) => {
    if (err) console.error(err);
    res.redirect('/admin/discounts');
  });
});

// ------------------------ LOGS DE ATIVIDADE ------------------------
app.get('/admin/logs', isAdmin, (req, res) => {
  db.all('SELECT * FROM activity_logs ORDER BY id DESC LIMIT 100', (err, logs) => {
    if (err) return res.render('admin/logs', { logs: [], activeTab: 'logs', error: 'Erro: ' + err.message, user: req.session.user });
    res.render('admin/logs', { logs, activeTab: 'logs', error: null, user: req.session.user });
  });
});

// ------------------------ CONFIGURAÇÕES ------------------------
app.get('/admin/settings', isAdmin, (req, res) => {
  db.get('SELECT * FROM settings WHERE id = 1', (err, row) => {
    if (err) return res.render('admin/settings', { settings: {site_name: 'Erro', discord_link: '#'}, activeTab: 'settings', error: 'Erro: ' + err.message, user: req.session.user });
    res.render('admin/settings', { settings: row || {site_name: 'Santos Resources', discord_link: 'https://discord.gg/8GyNS5vRgt'}, activeTab: 'settings', error: null, user: req.session.user });
  });
});

app.post('/admin/settings/update', isAdmin, (req, res) => {
  const { site_name, discord_link } = req.body;
  db.run('UPDATE settings SET site_name = ?, discord_link = ? WHERE id = 1', [site_name, discord_link], (err) => {
    if (!err) logActivity(req, `Atualizou as configurações do site.`);
    else console.error(err);
    res.redirect('/admin/settings');
  });
});

app.listen(PORT, () => { console.log(`🚀 Santos Resources rodando em http://localhost:${PORT}`); });