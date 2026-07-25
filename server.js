require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const { pool, initDB } = require('./database');
const config = require('./config');
const path = require('path');
const pgSession = require('connect-pg-simple')(session);

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.set('trust proxy', 1);

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

async function logActivity(req, action) {
  if (req.session.user) {
    await pool.query(
      `INSERT INTO activity_logs (admin_discord_id, admin_username, action) VALUES ($1, $2, $3)`,
      [req.session.user.id, req.session.user.username, action]
    );
  }
}

async function isAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/');
  if (config.ADMIN_IDS.includes(req.session.user.id)) return next();
  const result = await pool.query('SELECT is_admin FROM users WHERE discord_id = $1', [req.session.user.id]);
  const row = result.rows[0];
  if (!row || row.is_admin !== 1) return res.redirect('/');
  next();
}

async function ensureSessionTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "sid" varchar NOT NULL PRIMARY KEY,
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL
      );
    `);
    console.log('✅ Tabela "session" garantida.');
  } catch (err) {
    console.error('❌ ERRO FATAL na tabela session:', err);
    throw err;
  }
}

let appPromise = null;

async function getApp() {
  if (!appPromise) {
    appPromise = (async () => {
      console.log('⏳ A iniciar base de dados e sessão...');
      await initDB();        
      await ensureSessionTable(); 

      console.log('✅ A configurar middleware de sessão...');
      app.use(session({
        store: new pgSession({
          pool: pool,
          tableName: 'session',
          createTableIfNotExists: true
        }),
        secret: 'santos-resources-secret-key',
        resave: false,
        saveUninitialized: false,
        cookie: {
          secure: process.env.NODE_ENV === 'production',
          maxAge: 30 * 24 * 60 * 60 * 1000
        }
      }));

      // --- ROTAS PÚBLICAS ---
      app.get('/', async (req, res) => {
        try {
          const result = await pool.query('SELECT * FROM products WHERE is_active = 1 ORDER BY id ASC');
          res.render('home', {
            products: result.rows,
            user: req.session.user || null,
            isAdmin: req.session.user && config.ADMIN_IDS.includes(req.session.user.id)
          });
        } catch (err) {
          console.error("❌ ERRO NA ROTA HOME:", err);
          res.status(500).send('Erro ao carregar produtos: ' + err.message);
        }
      });

      app.get('/products', async (req, res) => {
        try {
          const result = await pool.query('SELECT * FROM products ORDER BY id ASC');
          res.render('products', {
            products: result.rows,
            user: req.session.user || null,
            isAdmin: req.session.user && config.ADMIN_IDS.includes(req.session.user.id),
            error: null
          });
        } catch (err) {
          res.render('products', { products: [], user: req.session.user || null, isAdmin: false, error: 'Erro ao carregar produtos' });
        }
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
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT_URI
          }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

          const accessToken = tokenResponse.data.access_token;
          const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
          });

          const user = userResponse.data;
          req.session.user = user;

          await new Promise((resolve, reject) => {
            req.session.save((err) => {
              if (err) reject(err);
              else resolve();
            });
          });
          console.log('✅ Sessão guardada com sucesso para o utilizador:', user.username);

          const now = new Date().toISOString();
          await pool.query(
            `INSERT INTO users (discord_id, username, avatar, last_login) VALUES ($1, $2, $3, $4)
             ON CONFLICT (discord_id) DO UPDATE SET username = EXCLUDED.username, avatar = EXCLUDED.avatar, last_login = EXCLUDED.last_login`,
            [user.id, user.username, user.avatar, now]
          );

          if (config.ADMIN_IDS.includes(user.id)) return res.redirect('/admin');

          const result = await pool.query('SELECT is_admin FROM users WHERE discord_id = $1', [user.id]);
          const row = result.rows[0];
          if (row && row.is_admin === 1) return res.redirect('/admin');
          else res.redirect('/');

        } catch (error) {
          console.error("❌ ERRO NO LOGIN DO DISCORD:", error);
          res.status(500).send(`
            <h2 style="font-family: sans-serif; color: #ef4444;">❌ Erro no Login com Discord</h2>
            <p><strong>Mensagem:</strong> ${error.message}</p>
            <p><strong>Detalhe:</strong> ${JSON.stringify(error.response?.data || 'Sem detalhes adicionais')}</p>
            <a href="/">Voltar para o início</a>
          `);
        }
      });

      app.get('/logout', (req, res) => { req.session.destroy(() => res.redirect('/')); });

      // --- ÁREA ADMINISTRATIVA ---
      app.get('/admin/dashboard', isAdmin, async (req, res) => {
        const total = await pool.query('SELECT COUNT(*) as total_products FROM products');
        const active = await pool.query('SELECT COUNT(*) as active_products FROM products WHERE is_active = 1');
        const users = await pool.query('SELECT COUNT(*) as total_users FROM users');
        res.render('admin/dashboard', {
          stats: {
            total_products: total.rows[0].total_products,
            active_products: active.rows[0].active_products,
            total_users: users.rows[0].total_users
          },
          activeTab: 'dashboard',
          user: req.session.user
        });
      });

      app.get('/admin', isAdmin, async (req, res) => {
        const result = await pool.query('SELECT * FROM products ORDER BY id ASC');
        res.render('admin/products', { products: result.rows, activeTab: 'products', error: null, user: req.session.user });
      });

      app.post('/admin/products/add', isAdmin, async (req, res) => {
        const { name, description, price, category } = req.body;
        if (!name || !description || !price) return res.redirect('/admin?error=missing_fields');
        await pool.query('INSERT INTO products (name, description, price, category, is_active) VALUES ($1, $2, $3, $4, 1)',
          [name, description, parseFloat(price), category || 'MTA']);
        await logActivity(req, `Criou o produto: ${name}`);
        await req.session.save();
        res.redirect(303, '/admin');
      });

      app.post('/admin/products/edit/:id', isAdmin, async (req, res) => {
        const { name, description, price, category } = req.body;
        await pool.query('UPDATE products SET name = $1, description = $2, price = $3, category = $4 WHERE id = $5',
          [name, description, parseFloat(price), category || 'MTA', req.params.id]);
        await logActivity(req, `Editou o produto: ${name}`);
        await req.session.save();
        res.redirect(303, '/admin');
      });

      app.post('/admin/products/delete/:id', isAdmin, async (req, res) => {
        const result = await pool.query('SELECT name FROM products WHERE id = $1', [req.params.id]);
        await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
        await logActivity(req, `Apagou o produto: ${result.rows[0]?.name || 'ID ' + req.params.id}`);
        await req.session.save();
        res.redirect(303, '/admin');
      });

      app.post('/admin/toggle/:id', isAdmin, async (req, res) => {
        await pool.query('UPDATE products SET is_active = NOT is_active WHERE id = $1', [req.params.id]);
        await req.session.save();
        res.redirect(303, '/admin');
      });

      app.get('/admin/users', isAdmin, async (req, res) => {
        const result = await pool.query('SELECT * FROM users ORDER BY id ASC');
        res.render('admin/users', { users: result.rows, activeTab: 'users', error: null, user: req.session.user });
      });

      // 🔥 CORREÇÃO DA ROTA DE ADMIN COM LOGS DETALHADOS
      app.post('/admin/users/toggle/:id', isAdmin, async (req, res) => {
        try {
          console.log(`⏳ A iniciar alteração de admin para o utilizador ID: ${req.params.id}`);
          
          // 1. Buscar o nome do utilizador antes de alterar
          const userResult = await pool.query('SELECT username FROM users WHERE id = $1', [req.params.id]);
          if (userResult.rows.length === 0) {
            throw new Error('Utilizador não encontrado');
          }
          const username = userResult.rows[0].username;

          // 2. Alterar o status de admin (NOT is_admin)
          await pool.query('UPDATE users SET is_admin = NOT is_admin WHERE id = $1', [req.params.id]);
          console.log(`✅ Admin status invertido para: ${username}`);

          // 3. Registar no log de atividades
          await logActivity(req, `Alterou o status de admin do utilizador: ${username}`);
          console.log(`📝 Log registado com sucesso.`);

          // 4. Redirecionar (sem esperar pela sessão)
          return res.redirect(303, '/admin/users');

        } catch (err) {
          console.error("❌ ERRO AO ALTERAR ADMIN:", err);
          // Se ocorrer um erro, mostra uma mensagem mais amigável e redireciona para a página de users
          return res.status(500).send(`
            <h3 style="font-family: sans-serif; color: #ef4444;">Erro ao alterar o status de administrador.</h3>
            <p><strong>Detalhe:</strong> ${err.message}</p>
            <p>Verifique os logs da Vercel para mais informações.</p>
            <a href="/admin/users">Voltar para a lista de utilizadores</a>
          `);
        }
      });

      app.get('/admin/discounts', isAdmin, async (req, res) => {
        const result = await pool.query('SELECT * FROM discounts ORDER BY id ASC');
        res.render('admin/discounts', { discounts: result.rows, activeTab: 'discounts', error: null, user: req.session.user });
      });

      app.post('/admin/discounts/add', isAdmin, async (req, res) => {
        const { code, description, percentage } = req.body;
        if (!code || !percentage) return res.redirect('/admin/discounts?error=missing_fields');
        await pool.query('INSERT INTO discounts (code, description, percentage, is_active) VALUES ($1, $2, $3, 1)',
          [code, description, parseInt(percentage)]);
        await logActivity(req, `Criou o desconto: ${code}`);
        await req.session.save();
        res.redirect(303, '/admin/discounts');
      });

      app.post('/admin/discounts/edit/:id', isAdmin, async (req, res) => {
        const { code, description, percentage } = req.body;
        await pool.query('UPDATE discounts SET code = $1, description = $2, percentage = $3 WHERE id = $4',
          [code, description, parseInt(percentage), req.params.id]);
        await logActivity(req, `Editou o desconto: ${code}`);
        await req.session.save();
        res.redirect(303, '/admin/discounts');
      });

      app.post('/admin/discounts/delete/:id', isAdmin, async (req, res) => {
        const result = await pool.query('SELECT code FROM discounts WHERE id = $1', [req.params.id]);
        await pool.query('DELETE FROM discounts WHERE id = $1', [req.params.id]);
        await logActivity(req, `Apagou o desconto: ${result.rows[0]?.code || 'ID ' + req.params.id}`);
        await req.session.save();
        res.redirect(303, '/admin/discounts');
      });

      app.post('/admin/discounts/toggle/:id', isAdmin, async (req, res) => {
        await pool.query('UPDATE discounts SET is_active = NOT is_active WHERE id = $1', [req.params.id]);
        await req.session.save();
        res.redirect(303, '/admin/discounts');
      });

      app.get('/admin/logs', isAdmin, async (req, res) => {
        const result = await pool.query('SELECT * FROM activity_logs ORDER BY id DESC LIMIT 100');
        res.render('admin/logs', { logs: result.rows, activeTab: 'logs', error: null, user: req.session.user });
      });

      app.get('/admin/settings', isAdmin, async (req, res) => {
        const result = await pool.query('SELECT * FROM settings WHERE id = 1');
        res.render('admin/settings', { settings: result.rows[0] || {site_name: 'Santos Resources', discord_link: 'https://discord.gg/8GyNS5vRgt'}, activeTab: 'settings', error: null, user: req.session.user });
      });

      app.post('/admin/settings/update', isAdmin, async (req, res) => {
        const { site_name, discord_link } = req.body;
        await pool.query('UPDATE settings SET site_name = $1, discord_link = $2 WHERE id = 1', [site_name, discord_link]);
        await logActivity(req, `Atualizou as configurações do site.`);
        await req.session.save();
        res.redirect(303, '/admin/settings');
      });

      console.log('🚀 Santos Resources configurado e a aguardar pedidos.');
      return app;
    })();
  }
  return appPromise;
}

module.exports = async (req, res) => {
  const readyApp = await getApp();
  return readyApp(req, res);
};
