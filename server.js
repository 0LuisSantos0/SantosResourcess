require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const { pool, initDB } = require('./database');
const config = require('./config');
const path = require('path');
const ejs = require('ejs');
const pgSession = require('connect-pg-simple')(session);

const app = express();
const PORT = process.env.PORT || 3000;

let licensesModule = null;
let loadError = null;
try {
  licensesModule = require('./src/database/licenses');
} catch (err) {
  loadError = err;
  console.error('⚠️ AVISO: Não foi possível carregar o módulo de licenças. O site vai continuar sem essa funcionalidade.', err.message);
}

const createLicense = licensesModule?.createLicense || (async () => { throw new Error(`Licenças indisponíveis: ${loadError ? loadError.message : 'Módulo não carregado'}`); });
const getLicenseByDiscordId = licensesModule?.getLicenseByDiscordId || (async () => null);
const getLicenseByDiscordIdRaw = licensesModule?.getLicenseByDiscordIdRaw || (async () => null); // 🔥 NOVO
const getAllLicenses = licensesModule?.getAllLicenses || (async () => []);
const updateLicenseIP = licensesModule?.updateLicenseIP || (async () => { throw new Error(`Licenças indisponíveis: ${loadError ? loadError.message : 'Módulo não carregado'}`); });
const toggleLicenseStatus = licensesModule?.toggleLicenseStatus || (async () => { throw new Error(`Licenças indisponíveis: ${loadError ? loadError.message : 'Módulo não carregado'}`); });
const deleteLicense = licensesModule?.deleteLicense || (async () => { throw new Error(`Licenças indisponíveis: ${loadError ? loadError.message : 'Módulo não carregado'}`); });

// ══════════════════════════════════════════
// VIEW ENGINE - Usa .html mas processa EJS
// ══════════════════════════════════════════
app.set('view engine', 'html');
app.engine('html', ejs.renderFile);
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.set('trust proxy', 1);

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

async function logActivity(req, action) {
  try {
    if (req.session.user) {
      await pool.query(
        `INSERT INTO activity_logs (admin_discord_id, admin_username, action) VALUES ($1, $2, $3)`,
        [req.session.user.id, req.session.user.username, action]
      );
    }
  } catch (err) {
    console.error('⚠️ Erro ao registar atividade (ignorado para não quebrar a ação principal):', err.message);
  }
}

async function getWebhookAvatarUrl(webhookUrl) {
  try {
    const response = await axios.get(webhookUrl);
    const { id, avatar } = response.data;
    if (id && avatar) {
      return `https://cdn.discordapp.com/avatars/${id}/${avatar}.png?size=128`;
    }
    return null;
  } catch (err) {
    console.error('⚠️ Não foi possível obter o avatar do webhook:', err.message);
    return null;
  }
}

async function sendPurchaseWebhook(user, cartItems) {
  try {
    const result = await pool.query('SELECT discord_webhook_url FROM settings WHERE id = 1');
    const webhookUrl = result.rows[0]?.discord_webhook_url;

    if (!webhookUrl || webhookUrl.trim() === '') {
      console.log('ℹ️ Webhook Discord não configurado. Log do pedido ignorado.');
      return;
    }

    // 🔥 Vai buscar o avatar definido no Discord para este webhook
    const avatarUrl = await getWebhookAvatarUrl(webhookUrl);

    const itemsList = cartItems
      .map(item => `• **${item.name}** x${item.quantity} — €${(item.price * item.quantity).toFixed(2)}`)
      .join('\n');

    const total = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    const payload = {
      username: 'Compras Pendentes', // 👈 NOME definido no SCRIPT
      ...(avatarUrl ? { avatar_url: avatarUrl } : {}), // 👈 AVATAR vem do Discord
      embeds: [
        {
          title: '🛒 Novo Pedido de Compra!',
          description: 'Um novo pedido foi registado e aguarda pagamento/confirmação.',
          color: 0x22d3ee,
          fields: [
            {
              name: '👤 Cliente',
              value: `${user.username}\n\`${user.id}\``,
              inline: true
            },
            {
              name: '📦 Produtos',
              value: itemsList || '—',
              inline: false
            },
            {
              name: '💰 Total',
              value: `**€${total.toFixed(2)}**`,
              inline: true
            },
            {
              name: '📊 Estado',
              value: '⏳ Pendente',
              inline: true
            }
          ],
          footer: { text: 'Santos Resources • ' },
          timestamp: new Date().toISOString()
        }
      ]
    };

    await axios.post(webhookUrl, payload);
    console.log(`✅ Log do pedido enviado para o Discord (${user.username}).`);
  } catch (err) {
    console.error('⚠️ Erro ao enviar webhook do Discord:', err.response?.data || err.message);
  }
}

async function sendPurchaseApprovedWebhook(user, purchase, paymentMethod) {
  try {
    const result = await pool.query('SELECT discord_purchase_webhook_url FROM settings WHERE id = 1');
    const webhookUrl = result.rows[0]?.discord_purchase_webhook_url;

    if (!webhookUrl || webhookUrl.trim() === '') {
      console.log('ℹ️ Webhook de compras aprovadas não configurado. Log ignorado.');
      return;
    }

    // 🔥 Vai buscar o avatar definido no Discord para este webhook
    const avatarUrl = await getWebhookAvatarUrl(webhookUrl);

    const metodo = paymentMethod || 'Discord Ticket';

    const payload = {
      username: 'Compras',
      ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
      embeds: [
        {
          title: '- Nova compra Realizada!',
          description: `Obrigado **${user.username}** pela preferência! Esperemos que desfrute do seu produto e volte sempre!`,
          color: 0x6366f1,
          thumbnail: user.avatar
            ? { url: `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` }
            : undefined,
          fields: [
            { name: 'Status', value: '**Pago**', inline: true },
            { name: 'Método', value: metodo, inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: 'Produtos', value: `\`\`\`\n${purchase.product_name}\n\`\`\``, inline: false }
          ],
          footer: { text: 'Santos Resources • ' },
          timestamp: new Date().toISOString()
        }
      ]
    };

    await axios.post(webhookUrl, payload);
    console.log(`✅ Log de compra aprovada enviado para o Discord (${user.username}).`);
  } catch (err) {
    console.error('⚠️ Erro ao enviar webhook de compra aprovada:', err.response?.data || err.message);
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
    console.error('❌ ERRO NA TABELA SESSION (mas o site continua):', err);
  }
}

let appPromise = null;

async function getApp() {
  if (!appPromise) {
    appPromise = (async () => {
      console.log('⏳ A iniciar base de dados e sessão...');
      try {
        await initDB();
        await ensureSessionTable();
      } catch (dbError) {
        console.error('⚠️ AVISO: Falha ao ligar à base de dados PostgreSQL. O site vai continuar, mas algumas funções podem falhar.', dbError);
      }

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

      app.use(async (req, res, next) => {
        try {
          const result = await pool.query('SELECT * FROM settings WHERE id = 1');
          let settings = result.rows[0];
          if (!settings) {
            settings = { site_name: 'Santos Resources', discord_link: 'https://discord.gg/8GyNS5vRgt', logo_url: '', maintenance_mode: 0 };
          }
          res.locals.siteSettings = settings;
          next();
        } catch (err) {
          console.error("⚠️ Erro ao carregar configurações:", err);
          res.locals.siteSettings = { site_name: 'Santos Resources', discord_link: 'https://discord.gg/8GyNS5vRgt', logo_url: '', maintenance_mode: 0 };
          next();
        }
      });

      app.use(async (req, res, next) => {
        try {
          const maintenance = Number(res.locals.siteSettings?.maintenance_mode) === 1;
          if (!maintenance) return next();

          const alwaysAllowed = ['/auth/discord', '/auth/discord/callback', '/logout'];
          if (alwaysAllowed.some(p => req.path === p || req.path.startsWith(p + '/'))) {
            return next();
          }

          let isAdmin = false;
          if (req.session?.user) {
            if (config.ADMIN_IDS.includes(req.session.user.id)) {
              isAdmin = true;
            } else {
              try {
                const r = await pool.query(
                  'SELECT is_admin FROM users WHERE discord_id = $1',
                  [req.session.user.id]
                );
                if (r.rows[0]?.is_admin === 1) isAdmin = true;
              } catch (e) { /* ignora */ }
            }
          }

          if (isAdmin) return next();

          if (req.path.startsWith('/api/')) {
            return res.status(503).json({ error: 'Site em manutenção. Volte em breve.' });
          }

          return res.status(503).render('maintenance', {
            siteSettings: res.locals.siteSettings,
            user: req.session?.user || null
          });
        } catch (err) {
          console.error('⚠️ Erro no middleware de manutenção (ignorado):', err.message);
          next();
        }
      });

      // ══════════════════════════════════════════
      // ROTAS PÚBLICAS
      // ══════════════════════════════════════════

      app.get('/api/cart', async (req, res) => {
        if (!req.session.user) return res.json([]);
        const result = await pool.query('SELECT cart FROM users WHERE discord_id = $1', [req.session.user.id]);
        res.json(result.rows[0]?.cart || []);
      });

      app.post('/api/cart', async (req, res) => {
        if (!req.session.user) return res.status(401).json({ error: 'Não logado' });
        const { cart } = req.body;
        await pool.query('UPDATE users SET cart = $1 WHERE discord_id = $2', [JSON.stringify(cart), req.session.user.id]);
        res.json({ success: true });
      });

      app.get('/api/coupon/status', async (req, res) => {
        if (!req.session.user) return res.json({ coupon: null });
        res.json({ coupon: req.session.coupon || null });
      });

      app.post('/api/coupon/apply', async (req, res) => {
        if (!req.session.user) return res.status(401).json({ error: 'Não logado' });
        const { code } = req.body;
        try {
          const result = await pool.query('SELECT * FROM discounts WHERE code = $1 AND is_active = 1', [code.toUpperCase()]);
          if (result.rows.length === 0) {
            return res.status(400).json({ error: 'Cupom inválido ou inativo' });
          }
          const discount = result.rows[0];
          req.session.coupon = { code: discount.code, percentage: discount.percentage };
          await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
          res.json({ success: true, percentage: discount.percentage, code: discount.code });
        } catch (err) {
          console.error('Erro ao validar cupom:', err);
          res.status(500).json({ error: 'Erro ao validar cupom' });
        }
      });

      app.post('/api/coupon/remove', async (req, res) => {
        if (!req.session.user) return res.status(401).json({ error: 'Não logado' });
        req.session.coupon = null;
        await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
        res.json({ success: true });
      });

      app.get('/api/wishlist', async (req, res) => {
        if (!req.session.user) return res.json([]);
        try {
          const result = await pool.query('SELECT wishlist FROM users WHERE discord_id = $1', [req.session.user.id]);
          res.json(result.rows[0]?.wishlist || []);
        } catch (err) { res.json([]); }
      });

      app.post('/api/wishlist/toggle', async (req, res) => {
        if (!req.session.user) return res.status(401).json({ error: 'Não logado' });
        try {
          const { id, name, price, category, thumbnail } = req.body;
          const result = await pool.query('SELECT wishlist FROM users WHERE discord_id = $1', [req.session.user.id]);
          let wishlist = result.rows[0]?.wishlist || [];
          const idx = wishlist.findIndex(w => w.id === id);
          let added = false;
          if (idx >= 0) {
            wishlist.splice(idx, 1);
          } else {
            wishlist.push({ id, name, price, category, thumbnail: thumbnail || '' });
            added = true;
          }
          await pool.query('UPDATE users SET wishlist = $1 WHERE discord_id = $2', [JSON.stringify(wishlist), req.session.user.id]);
          res.json({ success: true, added, wishlist });
        } catch (err) {
          console.error('Erro wishlist:', err);
          res.status(500).json({ error: 'Erro' });
        }
      });

      app.get('/api/notifications', async (req, res) => {
        if (!req.session.user) return res.json({ count: 0, products: [] });
        try {
          const userResult = await pool.query('SELECT last_seen_products_at FROM users WHERE discord_id = $1', [req.session.user.id]);
          const lastSeen = userResult.rows[0]?.last_seen_products_at;

          let query, params = [];
          if (lastSeen) {
            query = 'SELECT id, name, price, category, thumbnail FROM products WHERE is_active = 1 AND created_at > $1 ORDER BY created_at DESC LIMIT 10';
            params = [lastSeen];
          } else {
            query = 'SELECT id, name, price, category, thumbnail FROM products WHERE is_active = 1 ORDER BY created_at DESC LIMIT 10';
          }
          const result = await pool.query(query, params);
          res.json({ count: result.rows.length, products: result.rows });
        } catch (err) {
          console.error('Erro notificações:', err);
          res.json({ count: 0, products: [] });
        }
      });

      app.post('/api/notifications/seen', async (req, res) => {
        if (!req.session.user) return res.status(401).json({ error: 'Não logado' });
        try {
          await pool.query('UPDATE users SET last_seen_products_at = CURRENT_TIMESTAMP WHERE discord_id = $1', [req.session.user.id]);
          res.json({ success: true });
        } catch (err) { res.status(500).json({ error: 'Erro' }); }
      });

      app.get('/', async (req, res) => {
        try {
          const result = await pool.query('SELECT * FROM products WHERE is_active = 1 ORDER BY id ASC');
          let isAdmin = false;
          if (req.session.user) {
            if (config.ADMIN_IDS.includes(req.session.user.id)) {
              isAdmin = true;
            } else {
              const dbCheck = await pool.query('SELECT is_admin FROM users WHERE discord_id = $1', [req.session.user.id]);
              if (dbCheck.rows.length > 0 && dbCheck.rows[0].is_admin === 1) {
                isAdmin = true;
              }
            }
          }

          res.render('home', { products: result.rows, user: req.session.user || null, isAdmin: isAdmin });
        } catch (err) {
          console.error("❌ ERRO NA ROTA HOME:", err);
          res.status(500).send('Erro ao carregar produtos: ' + err.message);
        }
      });

      app.get('/products', async (req, res) => {
        try {
          // 1) Verificar primeiro se é admin
          let isAdmin = false;
          if (req.session.user) {
            if (config.ADMIN_IDS.includes(req.session.user.id)) {
              isAdmin = true;
            } else {
              const dbCheck = await pool.query('SELECT is_admin FROM users WHERE discord_id = $1', [req.session.user.id]);
              if (dbCheck.rows.length > 0 && dbCheck.rows[0].is_admin === 1) {
                isAdmin = true;
              }
            }
          }

          // 2) Admin vê tudo (para gerir). Cliente vê só os ativos.
          const query = isAdmin
            ? 'SELECT * FROM products ORDER BY id ASC'
            : 'SELECT * FROM products WHERE is_active = 1 ORDER BY id ASC';

          const result = await pool.query(query);

          res.render('products', {
            products: result.rows,
            user: req.session.user || null,
            isAdmin: isAdmin,
            error: null
          });
        } catch (err) {
          console.error('❌ Erro ao carregar produtos:', err);
          res.render('products', { products: [], user: req.session.user || null, isAdmin: false, error: 'Erro ao carregar produtos' });
        }
      });

      app.get('/about', async (req, res) => {
        let isAdmin = false;
        if (req.session.user) {
          if (config.ADMIN_IDS.includes(req.session.user.id)) {
            isAdmin = true;
          } else {
            const dbCheck = await pool.query('SELECT is_admin FROM users WHERE discord_id = $1', [req.session.user.id]);
            if (dbCheck.rows.length > 0 && dbCheck.rows[0].is_admin === 1) {
              isAdmin = true;
            }
          }
        }
        res.render('about', { user: req.session.user || null, isAdmin: isAdmin });
      });

      app.get('/payment-methods', async (req, res) => {
        let isAdmin = false;
        if (req.session.user) {
          if (config.ADMIN_IDS.includes(req.session.user.id)) {
            isAdmin = true;
          } else {
            const dbCheck = await pool.query('SELECT is_admin FROM users WHERE discord_id = $1', [req.session.user.id]);
            if (dbCheck.rows.length > 0 && dbCheck.rows[0].is_admin === 1) {
              isAdmin = true;
            }
          }
        }

        try {
          const result = await pool.query('SELECT * FROM payment_methods WHERE is_active = 1 ORDER BY display_order ASC');
          res.render('payment-methods', { methods: result.rows, user: req.session.user || null, isAdmin: isAdmin });
        } catch (err) {
          res.render('payment-methods', { methods: [], user: req.session.user || null, isAdmin: isAdmin });
        }
      });

      // ══════════════════════════════════════════
      // ÁREA DO CLIENTE
      // ══════════════════════════════════════════

      // Helpers
      async function getClientData(req) {
        const isAdmin = config.ADMIN_IDS.includes(req.session.user.id)
          || (await pool.query('SELECT is_admin FROM users WHERE discord_id = $1', [req.session.user.id])).rows[0]?.is_admin === 1;

        const systemsResult = await pool.query(
          `SELECT DISTINCT ON (product_id) *
           FROM purchases
           WHERE user_discord_id = $1 AND status = 'completed'
           ORDER BY product_id, purchased_at DESC`,
          [req.session.user.id]
        );

        const purchasesResult = await pool.query(
          `SELECT * FROM purchases
           WHERE user_discord_id = $1
           ORDER BY purchased_at DESC`,
          [req.session.user.id]
        );

        return {
          user: req.session.user,
          isAdmin,
          systems: systemsResult.rows,
          purchases: purchasesResult.rows
        };
      }

      // Redireciona para a tab padrão
      app.get('/client-area', (req, res) => {
        if (!req.session.user) return res.redirect('/');
        res.redirect('/client-area/systems');
      });

      // Tab: Meus Sistemas
      app.get('/client-area/systems', async (req, res) => {
        if (!req.session.user) return res.redirect('/');
        try {
          const data = await getClientData(req);
          res.render('client/systems', data);
        } catch (err) {
          console.error('❌ Erro ao carregar sistemas:', err);
          res.render('client/systems', { user: req.session.user, isAdmin: false, systems: [], purchases: [] });
        }
      });

      // Tab: Histórico de Compras
      app.get('/client-area/purchases', async (req, res) => {
        if (!req.session.user) return res.redirect('/');
        try {
          const data = await getClientData(req);
          res.render('client/purchases', data);
        } catch (err) {
          console.error('❌ Erro ao carregar histórico:', err);
          res.render('client/purchases', { user: req.session.user, isAdmin: false, systems: [], purchases: [] });
        }
      });

      app.get('/client-area/wishlist', async (req, res) => {
        if (!req.session.user) return res.redirect('/');
        try {
          const data = await getClientData(req);
          const w = await pool.query('SELECT wishlist FROM users WHERE discord_id = $1', [req.session.user.id]);
          data.wishlist = w.rows[0]?.wishlist || [];
          res.render('client/wishlist', data);
        } catch (err) {
          console.error('❌ Erro ao carregar favoritos:', err);
          res.render('client/wishlist', { user: req.session.user, isAdmin: false, systems: [], purchases: [], wishlist: [] });
        }
      });

      // ══════════════════════════════════════════
      // ADMIN — GESTÃO DE LICENÇAS
      // ══════════════════════════════════════════
      app.get('/admin/licenses', isAdmin, async (req, res) => {
          try {
              const licenses = await getAllLicenses();
              res.render('admin/licenses', { 
                  licenses: licenses || [], 
                  activeTab: 'licenses', 
                  error: null, 
                  user: req.session.user 
              });
          } catch (err) {
              console.error('❌ Erro ao carregar licenças:', err);
              res.render('admin/licenses', { 
                  licenses: [], 
                  activeTab: 'licenses', 
                  error: 'Erro ao carregar licenças', 
                  user: req.session.user 
              });
          }
      });

      app.get('/api/debug/license', async (req, res) => {
          if (!req.session.user) return res.status(401).json({ error: 'Não logado' });

          const supabase = require('./src/supabase/client');
          const result = {
              supabase_url_defined: !!process.env.SUPABASE_URL,
              supabase_key_defined: !!process.env.SUPABASE_KEY,
              supabase_client_ok: !!supabase,
              user_id: req.session.user.id,
              user_id_type: typeof req.session.user.id,
          };

          if (supabase) {
              const { data, error } = await supabase.from('licencas').select('*').limit(5);
              result.raw_query = { data, error: error ? { message: error.message, code: error.code } : null };

              const { data: specific } = await supabase
                  .from('licencas')
                  .select('*')
                  .eq('discord_id', String(req.session.user.id))
                  .maybeSingle();
              result.specific_license = specific;
          }

          res.json(result);
      });
      
      app.post('/admin/licenses/generate', isAdmin, async (req, res) => {
          const { discord_id } = req.body;
          if (!discord_id) return res.redirect('/admin/licenses?error=missing_fields');

          try {
              const existing = await getLicenseByDiscordId(discord_id);
              if (existing) return res.redirect('/admin/licenses?error=user_has_license');

              const usuario = `${Date.now()}${Math.floor(Math.random() * 1000000)}`;
              const randomPart = () => Math.random().toString(36).substring(2, 10);
              const chave = `SR-${randomPart()}-${randomPart()}-${randomPart()}`;

              await createLicense(discord_id, usuario, chave);
              await logActivity(req, `Gerou licença para Discord ID: ${discord_id}`);
              res.redirect('/admin/licenses?success=generated');
          } catch (err) {
              console.error('❌ Erro ao gerar licença:', err);
              // 🔥 Passa a mensagem de erro real para o URL para saberes o que se passa
              const errorMsg = encodeURIComponent(err.message || 'Erro desconhecido');
              res.redirect(`/admin/licenses?error=generation_failed&reason=${errorMsg}`);
          }
      });

      app.post('/admin/licenses/toggle/:id', isAdmin, async (req, res) => {
          try {
              const result = await toggleLicenseStatus(req.params.id);
              res.json({ success: true, data: result });
          } catch (err) {
              console.error('❌ Erro ao alternar licença:', err);
              res.status(500).json({ error: err.message || 'Erro desconhecido' });
          }
      });

      app.post('/admin/licenses/delete/:id', isAdmin, async (req, res) => {
          try {
              await deleteLicense(req.params.id);
              await logActivity(req, `Apagou a licença ID: ${req.params.id}`);
              res.json({ success: true });
          } catch (err) {
              console.error('❌ Erro ao apagar licença:', err);
              res.status(500).json({ error: err.message || 'Erro desconhecido' });
          }
      });

      app.get('/admin/users/:id/details', isAdmin, async (req, res) => {
          try {
              const userId = req.params.id;
              const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
              if (userResult.rows.length === 0) return res.status(404).json({ error: 'Utilizador não encontrado' });
              const user = userResult.rows[0];

              const systemsResult = await pool.query(
                  `SELECT DISTINCT ON (product_id) * FROM purchases 
                  WHERE user_discord_id = $1 AND status = 'completed' 
                  ORDER BY product_id, purchased_at DESC`,
                  [user.discord_id]
              );

              const license = await getLicenseByDiscordIdRaw(user.discord_id);
              const mta_config = license ? { ip: license.ip_permitido } : null;

              // 🔥 NOVO: lista de todos os produtos (ativos e inativos) para o select
              const productsResult = await pool.query(
                  'SELECT id, name, price, category, is_active FROM products ORDER BY name ASC'
              );

              res.json({
                  user_discord_id: user.discord_id,
                  systems: systemsResult.rows,
                  license: license || null,
                  mta_config: mta_config,
                  all_products: productsResult.rows  // 🔥 NOVO
              });
          } catch (err) {
              console.error('❌ Erro ao buscar detalhes do utilizador:', err);
              res.status(500).json({ error: 'Erro interno do servidor.' });
          }
      });

      app.post('/admin/users/:id/add-product', isAdmin, async (req, res) => {
          try {
              const userId = req.params.id;
              const { product_id } = req.body;

              if (!product_id) return res.status(400).json({ error: 'Produto não especificado' });

              const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
              if (userResult.rows.length === 0) return res.status(404).json({ error: 'Utilizador não encontrado' });
              const user = userResult.rows[0];

              const productResult = await pool.query('SELECT * FROM products WHERE id = $1', [product_id]);
              if (productResult.rows.length === 0) return res.status(404).json({ error: 'Produto não encontrado' });
              const product = productResult.rows[0];

              // Verificar se o utilizador já tem este produto
              const existing = await pool.query(
                  `SELECT id FROM purchases WHERE user_discord_id = $1 AND product_id = $2 AND status = 'completed'`,
                  [user.discord_id, product.id]
              );
              if (existing.rows.length > 0) {
                  return res.status(400).json({ error: 'Este utilizador já possui este produto' });
              }

              // Inserir na tabela purchases com status = completed
              await pool.query(
                  `INSERT INTO purchases (user_discord_id, product_id, product_name, product_category, price, status)
                  VALUES ($1, $2, $3, $4, $5, 'completed')`,
                  [user.discord_id, product.id, product.name, product.category, product.price]
              );

              // 🔥 Se for MTA, gerar licença automática (só se NÃO existir nenhuma — mesmo inativa)
              if (product.category === 'MTA') {
                  // Usar a versão RAW que devolve a licença mesmo quando está inativa
                  const existingLicenseRaw = await getLicenseByDiscordIdRaw(user.discord_id);

                  if (!existingLicenseRaw) {
                      // Não existe licença nenhuma → cria uma nova
                      try {
                          const usuario = `${Date.now()}${Math.floor(Math.random() * 1000000)}`;
                          const randomPart = () => Math.random().toString(36).substring(2, 10);
                          const chave = `SR-${randomPart()}-${randomPart()}-${randomPart()}`;
                          await createLicense(user.discord_id, usuario, chave);
                          console.log(`✅ Licença MTA gerada automaticamente para o utilizador ${user.discord_id}`);
                      } catch (licErr) {
                          // Nunca deixa o erro da licença estragar a adição do produto
                          console.error('⚠️ Erro ao gerar licença MTA (produto continua adicionado):', licErr.message);
                      }
                  } else if (existingLicenseRaw.ativa === false || existingLicenseRaw.ativa === 0) {
                      console.log(`ℹ️ Utilizador ${user.discord_id} já tem licença (inativa). Produto adicionado sem criar nova.`);
                  } else {
                      console.log(`ℹ️ Utilizador ${user.discord_id} já tem licença ativa. Produto adicionado sem criar nova.`);
                  }
              }

              await logActivity(req, `Adicionou o produto "${product.name}" ao utilizador ${user.username}`);
              res.json({ success: true, message: `Produto "${product.name}" adicionado com sucesso!` });
          } catch (err) {
              console.error('❌ Erro ao adicionar produto ao utilizador:', err);
              res.status(500).json({ error: err.message || 'Erro interno' });
          }
      });

      // ══════════════════════════════════════════
      // ÁREA DO CLIENTE — LICENÇA E CONFIGURAÇÃO MTA
      // ══════════════════════════════════════════
      app.get('/client-area/license', async (req, res) => {
          if (!req.session.user) return res.redirect('/');
          try {
              const data = await getClientData(req);

              // 🔥 Usa a versão "raw" que devolve a licença mesmo quando inativa
              const license = await getLicenseByDiscordIdRaw(req.session.user.id);
              const mta_config = license ? { ip: license.ip_permitido } : null;

              res.render('client/license', {
                  user: req.session.user,
                  isAdmin: data.isAdmin,
                  systems: data.systems,
                  purchases: data.purchases,
                  license: license || null,
                  mta_config: mta_config || null
              });
          } catch (err) {
              console.error('❌ Erro ao carregar licença:', err);
              res.render('client/license', {
                  user: req.session.user,
                  isAdmin: false, systems: [], purchases: [], license: null, mta_config: null
              });
          }
      });

      app.get('/api/download/:productId', async (req, res) => {
        if (!req.session.user) return res.status(401).send('Não autorizado.');

        try {
          const { productId } = req.params;

          // 1) Verificar se o utilizador tem direito ao produto
          const hasProduct = await pool.query(
            `SELECT 1 FROM purchases 
            WHERE user_discord_id = $1 AND product_id = $2 AND status = 'completed' 
            LIMIT 1`,
            [req.session.user.id, productId]
          );

          // Admins podem sempre descarregar
          let isAdmin = false;
          if (config.ADMIN_IDS.includes(req.session.user.id)) {
            isAdmin = true;
          } else {
            const dbCheck = await pool.query(
              'SELECT is_admin FROM users WHERE discord_id = $1',
              [req.session.user.id]
            );
            if (dbCheck.rows[0]?.is_admin === 1) isAdmin = true;
          }

          if (hasProduct.rows.length === 0 && !isAdmin) {
            return res.status(403).send('Não tens acesso a este produto.');
          }

          // 2) Buscar o URL do produto
          const productResult = await pool.query(
            'SELECT name, download_url FROM products WHERE id = $1',
            [productId]
          );
          if (productResult.rows.length === 0) {
            return res.status(404).send('Produto não encontrado.');
          }

          const product = productResult.rows[0];
          if (!product.download_url || product.download_url.trim() === '') {
            return res.status(404).send('Este produto não tem ficheiro associado.');
          }

          // 3) Converter links especiais para links de download direto
          let downloadUrl = product.download_url.trim();

          // Google Drive → transformar para download direto
          const gdMatch = downloadUrl.match(/drive\.google\.com\/file\/d\/([^/]+)/);
          if (gdMatch) {
            downloadUrl = `https://drive.google.com/uc?export=download&id=${gdMatch[1]}`;
          } else {
            const gdMatch2 = downloadUrl.match(/drive\.google\.com\/open\?id=([^&]+)/);
            if (gdMatch2) {
              downloadUrl = `https://drive.google.com/uc?export=download&id=${gdMatch2[1]}`;
            }
          }

          // Dropbox → adicionar ?dl=1
          if (downloadUrl.includes('dropbox.com') && !downloadUrl.includes('dl=1')) {
            downloadUrl = downloadUrl.includes('?')
              ? downloadUrl + '&dl=1'
              : downloadUrl + '?dl=1';
          }

          // 4) Fetch do ficheiro original
          const fileRes = await axios.get(downloadUrl, {
            responseType: 'stream',
            maxRedirects: 10,
            timeout: 120000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; SantosResources/1.0)'
            },
            validateStatus: () => true
          });

          if (fileRes.status >= 400) {
            console.error('❌ Download falhou com status', fileRes.status);
            return res.status(fileRes.status).send('Não foi possível obter o ficheiro de origem.');
          }

          // 5) Nome de ficheiro para o download
          const safeName = String(product.name).replace(/[^a-zA-Z0-9._-]/g, '_');
          const filename = `${safeName}.zip`;

          // 6) Devolver como download
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          if (fileRes.headers['content-type']) {
            res.setHeader('Content-Type', fileRes.headers['content-type']);
          } else {
            res.setHeader('Content-Type', 'application/octet-stream');
          }
          if (fileRes.headers['content-length']) {
            res.setHeader('Content-Length', fileRes.headers['content-length']);
          }

          fileRes.data.pipe(res);

        } catch (err) {
          console.error('❌ Erro no proxy de download:', err.message);
          res.status(500).send('Erro ao preparar o download.');
        }
      });

      app.post('/api/client/mta-config', async (req, res) => {
          if (!req.session.user) return res.status(401).json({ error: 'Não logado' });
          const { ip } = req.body;
          if (!ip || !/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
              return res.status(400).json({ error: 'IP inválido. Formato: xxx.xxx.xxx.xxx' });
          }
          try {
              await updateLicenseIP(req.session.user.id, ip);
              res.json({ success: true });
          } catch (err) {
              console.error('Erro ao atualizar IP:', err);
              res.status(500).json({ error: 'Erro ao guardar as configurações.' });
          }
      });

      // ══════════════════════════════════════════
      // CHECKOUT (regista como PENDENTE)
      // ══════════════════════════════════════════
      app.post('/api/checkout', async (req, res) => {
        if (!req.session.user) return res.status(401).json({ error: 'Não logado' });

        try {
          const userResult = await pool.query('SELECT cart FROM users WHERE discord_id = $1', [req.session.user.id]);
          const cart = userResult.rows[0]?.cart || [];

          if (cart.length === 0) return res.status(400).json({ error: 'Carrinho vazio' });

          for (const item of cart) {
            await pool.query(
              `INSERT INTO purchases (user_discord_id, product_id, product_name, product_category, price, status)
               VALUES ($1, $2, $3, $4, $5, 'pending')`,
              [req.session.user.id, item.id, item.name, item.category, item.price]
            );
          }

          await pool.query('UPDATE users SET cart = $1 WHERE discord_id = $2', ['[]', req.session.user.id]);
          req.session.coupon = null;

          // 🔥 Enviar log para o Discord
          await sendPurchaseWebhook(req.session.user, cart);

          res.json({ success: true, message: 'Pedido registado! Abre Ticket no Discord para pagar.' });
        } catch (err) {
          console.error('❌ Erro no checkout:', err);
          res.status(500).json({ error: 'Erro ao processar a compra' });
        }
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

      // ══════════════════════════════════════════
      // ADMIN DASHBOARD
      // ══════════════════════════════════════════

      app.get('/admin/dashboard', isAdmin, async (req, res) => {
        const total = await pool.query('SELECT COUNT(*) as total_products FROM products');
        const active = await pool.query('SELECT COUNT(*) as active_products FROM products WHERE is_active = 1');
        const users = await pool.query('SELECT COUNT(*) as total_users FROM users');
        const mta = await pool.query('SELECT COUNT(*) as mta_scripts FROM products WHERE category = $1', ['MTA']);
        const bots = await pool.query('SELECT COUNT(*) as discord_bots FROM products WHERE category = $1', ['Discord Bot']);
        const site = await pool.query('SELECT COUNT(*) as site_scripts FROM products WHERE category = $1', ['Site']);
        const discounts = await pool.query('SELECT COUNT(*) as total_discounts FROM discounts');
        const paymentMethods = await pool.query('SELECT COUNT(*) as total_payment_methods FROM payment_methods');

        res.render('admin/dashboard', {
          stats: {
            total_products: total.rows[0].total_products,
            active_products: active.rows[0].active_products,
            total_users: users.rows[0].total_users,
            mta_scripts: mta.rows[0].mta_scripts,
            discord_bots: bots.rows[0].discord_bots,
            site_scripts: site.rows[0].site_scripts,
            total_discounts: discounts.rows[0].total_discounts,
            total_payment_methods: paymentMethods.rows[0].total_payment_methods
          },
          activeTab: 'dashboard',
          user: req.session.user
        });
      });

      // ══════════════════════════════════════════
      // ADMIN PRODUTOS
      // ══════════════════════════════════════════

      app.get('/admin', isAdmin, async (req, res) => {
        const result = await pool.query('SELECT * FROM products ORDER BY id ASC');
        res.render('admin/products', { products: result.rows, activeTab: 'products', error: null, user: req.session.user });
      });

      app.post('/admin/products/add', isAdmin, async (req, res) => {
        try {
          const { name, description, price, category, thumbnail, video_link, features, badge, badge_color, download_url } = req.body;
          if (!name || !description || !price) return res.redirect('/admin?error=missing_fields');

          await pool.query(
            'INSERT INTO products (name, description, price, category, is_active, thumbnail, video_link, features, badge, badge_color, download_url) VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8, $9, $10)',
            [name, description, parseFloat(price), category || 'MTA', thumbnail, video_link, features, badge, badge_color || '#94a3b8', download_url || null]
          );
          await logActivity(req, `Criou o produto: ${name}`);
          res.redirect(303, '/admin');
        } catch (err) {
          console.error('❌ Erro ao adicionar produto:', err);
          res.status(500).send(`<h3>Erro ao adicionar</h3><p>${err.message}</p><a href="/admin">Voltar</a>`);
        }
      });

      app.post('/admin/products/edit/:id', isAdmin, async (req, res) => {
        try {
          const { name, description, price, category, thumbnail, video_link, features, badge, badge_color, download_url } = req.body;

          await pool.query(
            'UPDATE products SET name = $1, description = $2, price = $3, category = $4, thumbnail = $5, video_link = $6, features = $7, badge = $8, badge_color = $9, download_url = $10 WHERE id = $11',
            [name, description, parseFloat(price), category || 'MTA', thumbnail, video_link, features, badge, badge_color || '#94a3b8', download_url || null, req.params.id]
          );
          await logActivity(req, `Editou o produto: ${name}`);
          res.redirect(303, '/admin'); 
        } catch (err) {
          console.error('❌ Erro ao editar produto:', err);
          res.status(500).send(`<h3>Erro ao salvar as alterações</h3><p><strong>Detalhe:</strong> ${err.message}</p><a href="/admin">Voltar</a>`);
        }
      });

      app.post('/admin/products/delete/:id', isAdmin, async (req, res) => {
        const result = await pool.query('SELECT name FROM products WHERE id = $1', [req.params.id]);
        await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
        await logActivity(req, `Apagou o produto: ${result.rows[0]?.name || 'ID ' + req.params.id}`);
        res.redirect(303, '/admin');
      });

      app.post('/admin/toggle/:id', isAdmin, async (req, res) => {
        try {
          await pool.query('UPDATE products SET is_active = 1 - is_active WHERE id = $1', [req.params.id]);
          res.redirect(303, '/admin');
        } catch (err) {
          console.error('❌ Erro ao alternar produto:', err);
          res.redirect(303, '/admin');
        }
      });

      app.post('/admin/products/feature/:id', isAdmin, async (req, res) => {
        const id = req.params.id;
        const countResult = await pool.query('SELECT COUNT(*) as count FROM products WHERE is_featured = 1');
        const currentCount = parseInt(countResult.rows[0].count);
        const currentResult = await pool.query('SELECT is_featured FROM products WHERE id = $1', [id]);
        const isCurrentlyFeatured = currentResult.rows[0]?.is_featured === 1;

        if (!isCurrentlyFeatured && currentCount >= 3) {
          return res.redirect(303, '/admin?error=max_featured');
        }

        await pool.query('UPDATE products SET is_featured = 1 - is_featured WHERE id = $1', [id]);
        await logActivity(req, `Alterou o destaque do produto ID ${id}`);
        res.redirect(303, '/admin');
      });

      // ══════════════════════════════════════════
      // ADMIN UTILIZADORES
      // ══════════════════════════════════════════

      app.get('/admin/users', isAdmin, async (req, res) => {
        const result = await pool.query('SELECT * FROM users ORDER BY id ASC');
        res.render('admin/users', { users: result.rows, activeTab: 'users', error: null, user: req.session.user });
      });

      app.post('/admin/users/toggle/:id', isAdmin, async (req, res) => {
        try {
          console.log(`⏳ A iniciar alteração de admin para o utilizador ID: ${req.params.id}`);
          const userResult = await pool.query('SELECT username FROM users WHERE id = $1', [req.params.id]);
          if (userResult.rows.length === 0) {
            throw new Error('Utilizador não encontrado');
          }
          const username = userResult.rows[0].username;
          await pool.query('UPDATE users SET is_admin = 1 - is_admin WHERE id = $1', [req.params.id]);
          console.log(`✅ Admin status invertido para: ${username}`);
          await logActivity(req, `Alterou o status de admin do utilizador: ${username}`);
          return res.redirect(303, '/admin/users');
        } catch (err) {
          console.error("❌ ERRO AO ALTERAR ADMIN:", err);
          return res.status(500).send(`
            <h3 style="font-family: sans-serif; color: #ef4444;">Erro ao alterar o status de administrador.</h3>
            <p><strong>Detalhe:</strong> ${err.message}</p>
            <p>Verifique os logs da Vercel para mais informações.</p>
            <a href="/admin/users">Voltar para a lista de utilizadores</a>
          `);
        }
      });

      // ══════════════════════════════════════════
      // ADMIN DESCONTOS
      // ══════════════════════════════════════════

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
        res.redirect(303, '/admin/discounts');
      });

      app.post('/admin/discounts/edit/:id', isAdmin, async (req, res) => {
        const { code, description, percentage } = req.body;
        await pool.query('UPDATE discounts SET code = $1, description = $2, percentage = $3 WHERE id = $4',
          [code, description, parseInt(percentage), req.params.id]);
        await logActivity(req, `Editou o desconto: ${code}`);
        res.redirect(303, '/admin/discounts');
      });

      app.post('/admin/discounts/delete/:id', isAdmin, async (req, res) => {
        const result = await pool.query('SELECT code FROM discounts WHERE id = $1', [req.params.id]);
        await pool.query('DELETE FROM discounts WHERE id = $1', [req.params.id]);
        await logActivity(req, `Apagou o desconto: ${result.rows[0]?.code || 'ID ' + req.params.id}`);
        res.redirect(303, '/admin/discounts');
      });

      app.post('/admin/discounts/toggle/:id', isAdmin, async (req, res) => {
        try {
          await pool.query('UPDATE discounts SET is_active = 1 - is_active WHERE id = $1', [req.params.id]);
          res.redirect(303, '/admin/discounts');
        } catch (err) {
          console.error('❌ Erro ao alternar desconto:', err);
          res.redirect(303, '/admin/discounts');
        }
      });

      app.post('/admin/upload-image', isAdmin, (req, res) => {
        const { image } = req.body;
        if (!image) return res.status(400).json({ error: 'Imagem não enviada' });
        res.json({ success: true, dataUrl: image });
      });

      // ══════════════════════════════════════════
      // ADMIN MÉTODOS DE PAGAMENTO
      // ══════════════════════════════════════════

      app.get('/admin/payment-methods', isAdmin, async (req, res) => {
        try {
          const result = await pool.query('SELECT * FROM payment_methods ORDER BY display_order ASC');
          res.render('admin/payment-methods', { methods: result.rows, activeTab: 'payment-methods', error: null, user: req.session.user });
        } catch (err) {
          res.render('admin/payment-methods', { methods: [], activeTab: 'payment-methods', error: 'Erro ao carregar', user: req.session.user });
        }
      });

      app.post('/admin/payment-methods/add', isAdmin, async (req, res) => {
        try {
          const { name, description, icon, display_order, image_base64 } = req.body;
          if (!name) return res.redirect('/admin/payment-methods?error=missing_fields');
          await pool.query('INSERT INTO payment_methods (name, description, icon, image_base64, display_order) VALUES ($1, $2, $3, $4, $5)',
            [name, description, icon, image_base64 || null, parseInt(display_order) || 0]);
          await logActivity(req, `Adicionou método de pagamento: ${name}`);
          res.redirect(303, '/admin/payment-methods');
        } catch (err) {
          console.error('Erro ao adicionar método:', err);
          res.status(500).send(`<h3>Erro ao adicionar método</h3><p>${err.message}</p><a href="/admin/payment-methods">Voltar</a>`);
        }
      });

      app.post('/admin/payment-methods/edit/:id', isAdmin, async (req, res) => {
        try {
          const { name, description, icon, display_order, image_base64 } = req.body;
          await pool.query('UPDATE payment_methods SET name = $1, description = $2, icon = $3, image_base64 = $4, display_order = $5 WHERE id = $6',
            [name, description, icon, image_base64 || null, parseInt(display_order) || 0, req.params.id]);
          await logActivity(req, `Editou método de pagamento: ${name}`);
          res.redirect(303, '/admin/payment-methods');
        } catch (err) {
          console.error('Erro ao editar método:', err);
          res.status(500).send(`<h3>Erro ao editar método</h3><p>${err.message}</p><a href="/admin/payment-methods">Voltar</a>`);
        }
      });

      app.post('/admin/payment-methods/toggle/:id', isAdmin, async (req, res) => {
        try {
          await pool.query('UPDATE payment_methods SET is_active = 1 - is_active WHERE id = $1', [req.params.id]);
          res.redirect(303, '/admin/payment-methods');
        } catch (err) {
          console.error('❌ Erro ao alternar método:', err);
          res.redirect(303, '/admin/payment-methods');
        }
      });

      app.post('/admin/payment-methods/delete/:id', isAdmin, async (req, res) => {
        try {
          const result = await pool.query('SELECT name FROM payment_methods WHERE id = $1', [req.params.id]);
          await pool.query('DELETE FROM payment_methods WHERE id = $1', [req.params.id]);
          await logActivity(req, `Apagou método de pagamento: ${result.rows[0]?.name || 'ID ' + req.params.id}`);
          res.redirect(303, '/admin/payment-methods');
        } catch (err) {
          console.error('Erro ao apagar método:', err);
          res.redirect(303, '/admin/payment-methods');
        }
      });

      // ══════════════════════════════════════════
      // ADMIN LOGS & SETTINGS
      // ══════════════════════════════════════════

      app.get('/admin/logs', isAdmin, async (req, res) => {
        const result = await pool.query('SELECT * FROM activity_logs ORDER BY id DESC LIMIT 100');
        res.render('admin/logs', { logs: result.rows, activeTab: 'logs', error: null, user: req.session.user });
      });

      app.get('/admin/settings', isAdmin, async (req, res) => {
        try {
          const result = await pool.query('SELECT * FROM settings WHERE id = 1');
          const settings = result.rows[0] || {
            site_name: 'Santos Resources',
            discord_link: 'https://discord.gg/8GyNS5vRgt',
            logo_url: '',
            maintenance_mode: 0,
            discord_webhook_url: '',
            discord_purchase_webhook_url: ''
          };

          res.render('admin/settings', {
            settings,
            activeTab: 'settings',
            error: null,
            user: req.session.user
          });
        } catch (err) {
          console.error('❌ Erro ao carregar configurações:', err);
          res.render('admin/settings', {
            settings: {
              site_name: 'Santos Resources',
              discord_link: 'https://discord.gg/8GyNS5vRgt',
              logo_url: '',
              maintenance_mode: 0,
              discord_webhook_url: '',
              discord_purchase_webhook_url: ''
            },
            activeTab: 'settings',
            error: 'Erro ao carregar configurações',
            user: req.session.user
          });
        }
      });

      app.post('/admin/settings/update', isAdmin, async (req, res) => {
        try {
          const {
            site_name,
            discord_link,
            logo_url,
            maintenance_mode,
            discord_webhook_url,
            discord_purchase_webhook_url
          } = req.body;
          const mm = (maintenance_mode === 'on' || maintenance_mode === '1') ? 1 : 0;

          await pool.query(
            `UPDATE settings
            SET site_name = $1,
                discord_link = $2,
                logo_url = $3,
                maintenance_mode = $4,
                discord_webhook_url = $5,
                discord_purchase_webhook_url = $6
            WHERE id = 1`,
            [site_name, discord_link, logo_url, mm, discord_webhook_url || null, discord_purchase_webhook_url || null]
          );
          await logActivity(req, `Atualizou as configurações do site (manutenção: ${mm ? 'ON' : 'OFF'}).`);
          res.redirect(303, '/admin/settings');
        } catch (err) {
          console.error('❌ Erro ao atualizar configurações:', err);
          res.status(500).send(`<h3>Erro ao salvar configurações</h3><p>${err.message}</p><a href="/admin/settings">Voltar</a>`);
        }
      });

      // ══════════════════════════════════════════
      // ADMIN — COMPRAS / PEDIDOS
      // ══════════════════════════════════════════

      app.get('/admin/purchases', isAdmin, async (req, res) => {
        try {
          const result = await pool.query(`
            SELECT p.*, u.username, u.avatar
            FROM purchases p
            LEFT JOIN users u ON u.discord_id = p.user_discord_id
            ORDER BY
              CASE WHEN p.status = 'pending' THEN 0 ELSE 1 END,
              p.purchased_at DESC
          `);
          res.render('admin/purchases', {
            purchases: result.rows,
            activeTab: 'purchases',
            error: null,
            user: req.session.user
          });
        } catch (err) {
          console.error('❌ Erro ao carregar compras:', err);
          res.render('admin/purchases', {
            purchases: [],
            activeTab: 'purchases',
            error: 'Erro ao carregar pedidos',
            user: req.session.user
          });
        }
      });

      app.post('/admin/purchases/approve/:id', isAdmin, async (req, res) => {
        try {
          const result = await pool.query(
            'SELECT product_name, product_category, user_discord_id FROM purchases WHERE id = $1',
            [req.params.id]
          );
          const purchase = result.rows[0];

          await pool.query(`UPDATE purchases SET status = 'completed' WHERE id = $1`, [req.params.id]);

          if (purchase && purchase.user_discord_id) {
            const userResult = await pool.query(
              'SELECT discord_id, username, avatar FROM users WHERE discord_id = $1',
              [purchase.user_discord_id]
            );
            const user = userResult.rows[0];

            if (purchase.product_category === 'MTA') {
              const existingLicense = await getLicenseByDiscordId(purchase.user_discord_id);
              if (!existingLicense) {
                const usuario = `${Date.now()}${Math.floor(Math.random() * 1000000)}`;
                const randomPart = () => Math.random().toString(36).substring(2, 10);
                const chave = `SR-${randomPart()}-${randomPart()}-${randomPart()}`;

                await createLicense(purchase.user_discord_id, usuario, chave);
                console.log(`✅ Licença MTA gerada automaticamente para o Discord ID: ${purchase.user_discord_id}`);
                await logActivity(req, `Aprovou compra MTA e gerou licença automática para: ${purchase.user_discord_id}`);
              } else {
                await logActivity(req, `Aprovou a compra MTA: ${purchase.product_name}`);
              }
            } else {
              console.log(`ℹ️ Compra aprovada sem gerar licença (categoria: ${purchase.product_category || 'desconhecida'})`);
              await logActivity(req, `Aprovou a compra (sem licença — categoria ${purchase.product_category || 'N/A'}): ${purchase.product_name}`);
            }

            if (user) {
              await sendPurchaseApprovedWebhook(
                { id: user.discord_id, username: user.username, avatar: user.avatar },
                purchase,
                'Discord Ticket'
              );
            }
          } else {
            await logActivity(req, `Aprovou a compra: ${result.rows[0]?.product_name || 'ID ' + req.params.id}`);
          }

          res.redirect(303, '/admin/purchases');
        } catch (err) {
          console.error('Erro ao aprovar:', err);
          res.redirect(303, '/admin/purchases');
        }
      });

      app.post('/admin/purchases/reject/:id', isAdmin, async (req, res) => {
        try {
          const result = await pool.query('SELECT product_name FROM purchases WHERE id = $1', [req.params.id]);
          await pool.query(`UPDATE purchases SET status = 'cancelled' WHERE id = $1`, [req.params.id]);
          await logActivity(req, `Cancelou a compra: ${result.rows[0]?.product_name || 'ID ' + req.params.id}`);
          res.redirect(303, '/admin/purchases');
        } catch (err) {
          console.error('Erro ao cancelar:', err);
          res.redirect(303, '/admin/purchases');
        }
      });

      app.post('/admin/purchases/delete/:id', isAdmin, async (req, res) => {
        try {
          const result = await pool.query('SELECT product_name FROM purchases WHERE id = $1', [req.params.id]);
          await pool.query('DELETE FROM purchases WHERE id = $1', [req.params.id]);
          await logActivity(req, `Apagou o registo de compra: ${result.rows[0]?.product_name || 'ID ' + req.params.id}`);
          res.redirect(303, '/admin/purchases');
        } catch (err) {
          console.error('Erro ao apagar:', err);
          res.redirect(303, '/admin/purchases');
        }
      });

      // ══════════════════════════════════════════
      // 404 — Página não encontrada (personalizada)
      // ══════════════════════════════════════════
      app.use((req, res) => {
        console.warn(`⚠️  404 - ${req.method} ${req.originalUrl}`);
        res.status(404).render('404', {
          requestedPath: req.originalUrl,
          siteSettings: res.locals.siteSettings || { site_name: 'Santos Resources', discord_link: 'https://discord.gg/8GyNS5vRgt', logo_url: '', maintenance_mode: 0 }
        });
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