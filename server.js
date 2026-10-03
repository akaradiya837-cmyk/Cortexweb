const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const nodemailer = require('nodemailer');

const root = __dirname;
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const { createPool, initializeSchema } = require('./database');
const db = createPool();
const port = Number(process.env.PORT || 3000);
const sessions = new Map();
const otpSentAtByEmail = new Map();
const otpLifetimeMs = 10 * 60 * 1000;
const otpResendDelayMs = 60 * 1000;
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };

const json = (res, status, value, headers = {}) => {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(body);
};
const empty = (res) => { res.writeHead(204, { 'cache-control': 'no-store' }); res.end(); };
const publicUser = (user) => ({ id: user.id, name: user.name, email: user.email, workspace: user.workspace });
const projectView = (project) => ({ ...project, content: JSON.parse(project.content_json || '{}'), content_json: undefined });
const slugify = (value) => String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'site';
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const textField = (value, max) => String(value ?? '').trim().slice(0, max);
const validProjectTypes = new Set(['Marketing website', 'Online store', 'Booking platform', 'Client portal']);
const validDatabaseTypes = new Set(['PostgreSQL', 'MySQL', 'MongoDB', 'Supabase']);
const validEnvironments = new Set(['Production', 'Staging', 'Development']);
const validFormTypes = new Set(['contact', 'form', 'register', 'login']);

function validateProjectInput(body) {
  const name = textField(body.name, 100);
  const client = textField(body.client, 80);
  const type = textField(body.type, 40);
  const brief = textField(body.brief, 2000);
  if (name.length < 2 || client.length < 2 || !validProjectTypes.has(type)) return { error: 'Project name and client must be at least 2 characters, with a supported project type.' };
  return { name, client, type, brief };
}

function validateContent(content) {
  if (content === undefined) return null;
  if (!content || typeof content !== 'object' || Array.isArray(content)) return { error: 'Website content must be an object.' };
  if (JSON.stringify(content).length > 1500000) return { error: 'Website content is too large.' };
  if (content.builderPages && (!Array.isArray(content.builderPages) || content.builderPages.length > 20 || content.builderPages.some((page) => !page || typeof page.name !== 'string' || !Array.isArray(page.sections) || page.sections.length > 100))) return { error: 'Website pages or sections are invalid.' };
  return null;
}

const parseCookies = (header = '') => Object.fromEntries(header.split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter((part) => part.length === 2));
const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => `${salt}:${crypto.scryptSync(String(password), salt, 64).toString('hex')}`;
const verifyPassword = (password, stored) => {
  const [salt, expected] = String(stored || '').split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
};
const newToken = () => crypto.randomBytes(32).toString('hex');

function sessionFor(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  let token = cookies.cortex_session;
  let current = token && sessions.get(token);
  if (!current) {
    token = newToken();
    current = { csrf: newToken(), userId: null };
    sessions.set(token, current);
    res.setHeader('Set-Cookie', `cortex_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
  }
  return current;
}

async function logActivity(userId, projectId, action, detail, executor = db) {
  await executor.execute('INSERT INTO activity_logs (user_id, project_id, action, detail) VALUES (?, ?, ?, ?)', [userId, projectId || null, action, detail || '']);
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 2_000_000) throw new Error('Payload too large');
  }
  return raw ? { name: null, client: null, type: null, ...JSON.parse(raw) } : { name: null, client: null, type: null };
}

function requireUser(session, res) {
  if (!session.userId) {
    json(res, 401, { error: 'Authentication required.' });
    return false;
  }
  return true;
}

function requireCsrf(req, session, res) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
  if (req.headers['x-csrf-token'] !== session.csrf) {
    json(res, 403, { error: 'Invalid CSRF token.' });
    return false;
  }
  return true;
}

async function ownedProject(id, userId) {
  const [rows] = await db.execute('SELECT * FROM projects WHERE id = ? AND user_id = ?', [Number(id), userId]);
  return rows[0];
}

async function api(req, res, session, pathname) {
  if (pathname === '/api/csrf' && req.method === 'GET') return json(res, 200, { csrfToken: session.csrf });
  if (!requireCsrf(req, session, res)) return;

  if (pathname === '/api/me' && req.method === 'GET') {
    const [rows] = session.userId ? await db.execute('SELECT * FROM users WHERE id = ?', [session.userId]) : [[]];
    return json(res, 200, { user: rows[0] ? publicUser(rows[0]) : null });
  }

  if (pathname === '/api/auth/otp/send' && req.method === 'POST') {
    const body = await readBody(req);
    const name = textField(body.name, 80);
    const email = textField(body.email, 254).toLowerCase();
    const workspace = textField(body.workspace, 80);
    const projectName = textField(body.projectName, 100);
    const projectType = String(body.projectType || '');
    const password = String(body.password || '');
    if (name.length < 2 || !emailPattern.test(email) || workspace.length < 2 || projectName.length < 2 || !validProjectTypes.has(projectType) || password.length < 8 || password !== String(body.confirmPassword || '')) return json(res, 422, { error: 'Enter valid details and matching passwords (8 characters minimum).' });
    const smtpHost = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const smtpPassword = process.env.SMTP_PASSWORD;
    const smtpFrom = process.env.SMTP_FROM || smtpUser;
    if (!smtpHost || !smtpFrom || (smtpUser && !smtpPassword)) return json(res, 503, { error: 'Email verification is not configured. Set the SMTP settings on the server.' });

    const now = Date.now();
    for (const [sentEmail, sentAt] of otpSentAtByEmail) if (now - sentAt >= otpResendDelayMs) otpSentAtByEmail.delete(sentEmail);
    if (now - (otpSentAtByEmail.get(email) || 0) < otpResendDelayMs) return json(res, 429, { error: 'Wait a minute before requesting another verification code.' });
    const [existingUsers] = await db.execute('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUsers[0]) return json(res, 409, { error: 'An account with that email already exists.' });

    const code = String(crypto.randomInt(100000, 1000000));
    const salt = crypto.randomBytes(16).toString('hex');
    const transport = nodemailer.createTransport({
      host: smtpHost,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      ...(smtpUser ? { auth: { user: smtpUser, pass: smtpPassword } } : {}),
    });
    try {
      await transport.sendMail({
        from: smtpFrom,
        to: email,
        subject: 'Your CortexWeb verification code',
        text: `Your CortexWeb verification code is ${code}. It expires in 10 minutes.`,
        html: `<p>Your CortexWeb verification code is <strong>${code}</strong>.</p><p>It expires in 10 minutes.</p>`,
      });
    } catch (error) {
      console.error(`Could not send verification email: ${error.message}`);
      return json(res, 503, { error: 'Could not send the verification email. Check the SMTP settings and try again.' });
    }
    session.pendingRegistration = {
      user: { name, email, workspace, projectName, projectType, brief: textField(body.brief, 2000), passwordHash: hashPassword(password) },
      codeHash: crypto.createHash('sha256').update(`${salt}:${code}`).digest('hex'),
      salt,
      expiresAt: Date.now() + otpLifetimeMs,
      attempts: 0,
    };
    otpSentAtByEmail.set(email, Date.now());
    return json(res, 200, { message: 'Verification code sent.' });
  }

  if (pathname === '/api/auth/otp/verify' && req.method === 'POST') {
    const body = await readBody(req);
    const pending = session.pendingRegistration;
    if (!pending || pending.expiresAt <= Date.now()) {
      delete session.pendingRegistration;
      return json(res, 400, { error: 'Your verification code expired. Request a new one.' });
    }
    if (pending.attempts >= 5) {
      delete session.pendingRegistration;
      return json(res, 429, { error: 'Too many incorrect codes. Request a new verification code.' });
    }
    const code = String(body.code || '').trim();
    const submittedHash = crypto.createHash('sha256').update(`${pending.salt}:${code}`).digest();
    const expectedHash = Buffer.from(pending.codeHash, 'hex');
    if (!/^\d{6}$/.test(code) || !crypto.timingSafeEqual(submittedHash, expectedHash)) {
      pending.attempts += 1;
      return json(res, 422, { error: 'That verification code is incorrect.' });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const { name, email, workspace, projectName, projectType, brief, passwordHash } = pending.user;
      const [userResult] = await connection.execute('INSERT INTO users (name, email, password_hash, workspace) VALUES (?, ?, ?, ?)', [name, email, passwordHash, workspace]);
      const userId = Number(userResult.insertId);
      const [projectResult] = await connection.execute('INSERT INTO projects (user_id, name, client, type, brief) VALUES (?, ?, ?, ?, ?)', [userId, projectName, name, projectType, brief]);
      await logActivity(userId, Number(projectResult.insertId), 'Project created', `${projectName} · workspace created`, connection);
      await connection.commit();
      session.userId = userId;
      delete session.pendingRegistration;
      const [users] = await db.execute('SELECT * FROM users WHERE id = ?', [userId]);
      return json(res, 201, { user: publicUser(users[0]), projectId: Number(projectResult.insertId) });
    } catch (error) {
      await connection.rollback();
      const duplicate = error.code === 'ER_DUP_ENTRY';
      if (duplicate) delete session.pendingRegistration;
      return json(res, duplicate ? 409 : 500, { error: duplicate ? 'An account with that email already exists.' : 'Could not create the account.' });
    } finally {
      connection.release();
    }
  }

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    if (!emailPattern.test(email) || !body.password) return json(res, 422, { error: 'Enter a valid email and password.' });
    const [rows] = await db.execute('SELECT * FROM users WHERE email = ?', [email]);
    const user = rows[0];
    if (!user || !verifyPassword(body.password, user.password_hash)) return json(res, 401, { error: 'Email or password is incorrect.' });
    session.userId = Number(user.id);
    return json(res, 200, { user: publicUser(user) });
  }

  if (pathname === '/api/auth/account' && req.method === 'DELETE') {
    if (!requireUser(session, res)) return;
    const [users] = await db.execute('SELECT id FROM users WHERE id = ?', [session.userId]);
    if (!users[0]) {
      session.userId = null;
      return json(res, 404, { error: 'Account not found.' });
    }
    await db.execute('DELETE FROM users WHERE id = ?', [session.userId]);
    session.userId = null;
    return json(res, 200, { message: 'Account deleted.' });
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    session.userId = null;
    return empty(res);
  }

  if (pathname === '/api/projects' && req.method === 'GET') {
    if (!requireUser(session, res)) return;
    const [rows] = await db.execute('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC', [session.userId]);
    return json(res, 200, { projects: rows.map(projectView) });
  }

  if (pathname === '/api/projects' && req.method === 'POST') {
    if (!requireUser(session, res)) return;
    const body = await readBody(req);
    const input = validateProjectInput(body);
    const contentError = validateContent(body.content);
    if (input.error || contentError) return json(res, 422, { error: input.error || contentError.error });
    const [result] = await db.execute('INSERT INTO projects (user_id, name, client, type, brief, content_json) VALUES (?, ?, ?, ?, ?, ?)', [session.userId, input.name, input.client, input.type, input.brief, JSON.stringify(body.content || {})]);
    await logActivity(session.userId, Number(result.insertId), 'Project created', input.name);
    const [rows] = await db.execute('SELECT * FROM projects WHERE id = ?', [result.insertId]);
    return json(res, 201, { project: projectView(rows[0]) });
  }

  const projectMatch = pathname.match(/^\/api\/projects\/(\d+)(?:\/(publish|unpublish))?$/);
  if (projectMatch) {
    if (!requireUser(session, res)) return;
    const project = await ownedProject(projectMatch[1], session.userId);
    if (!project) return json(res, 404, { error: 'Project not found.' });
    const action = projectMatch[2];

    if (action === 'publish' && req.method === 'POST') {
      const base = slugify(project.name);
      let slug = base;
      let suffix = 2;
      while (true) {
        const [matches] = await db.execute('SELECT id FROM projects WHERE slug = ? AND id != ?', [slug, project.id]);
        if (!matches.length) break;
        slug = `${base}-${suffix++}`;
      }
      await db.execute('UPDATE projects SET slug = ?, status = ?, published_at = CURRENT_TIMESTAMP WHERE id = ?', [slug, 'Published', project.id]);
      await logActivity(session.userId, Number(project.id), 'Website published', `/site/${slug}`);
      const [rows] = await db.execute('SELECT * FROM projects WHERE id = ?', [project.id]);
      return json(res, 200, { project: projectView(rows[0]), publicUrl: `/site/${slug}` });
    }

    if (action === 'unpublish' && req.method === 'POST') {
      await db.execute('UPDATE projects SET status = ?, published_at = NULL WHERE id = ?', ['Draft', project.id]);
      await logActivity(session.userId, Number(project.id), 'Website unpublished', project.name);
      const [rows] = await db.execute('SELECT * FROM projects WHERE id = ?', [project.id]);
      return json(res, 200, { project: projectView(rows[0]) });
    }

    if (!action && req.method === 'PUT') {
      const body = await readBody(req);
      const contentError = validateContent(body.content);
      if (contentError) return json(res, 422, { error: contentError.error });
      const status = ['Draft', 'Published', 'Archived'].includes(body.status) ? body.status : project.status;
      await db.execute('UPDATE projects SET name = COALESCE(?, name), client = COALESCE(?, client), type = COALESCE(?, type), brief = COALESCE(?, brief), content_json = COALESCE(?, content_json), status = ? WHERE id = ?', [body.name ? String(body.name).slice(0, 100) : null, body.client ? String(body.client).slice(0, 80) : null, body.type ? String(body.type).slice(0, 40) : null, body.brief === undefined ? null : String(body.brief).slice(0, 2000), body.content === undefined ? null : JSON.stringify(body.content), status, project.id]);
      await logActivity(session.userId, Number(project.id), 'Project updated', body.name || project.name);
      const [rows] = await db.execute('SELECT * FROM projects WHERE id = ?', [project.id]);
      return json(res, 200, { project: projectView(rows[0]) });
    }

    if (!action && req.method === 'DELETE') {
      await db.execute('DELETE FROM projects WHERE id = ?', [project.id]);
      await logActivity(session.userId, null, 'Project deleted', project.name);
      return empty(res);
    }
  }

  if (pathname === '/api/activity' && req.method === 'GET') {
    if (!requireUser(session, res)) return;
    const [rows] = await db.execute('SELECT * FROM activity_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 100', [session.userId]);
    return json(res, 200, { activity: rows });
  }

  if (pathname === '/api/integrations' && req.method === 'GET') {
    if (!requireUser(session, res)) return;
    const [rows] = await db.execute('SELECT * FROM integrations WHERE user_id = ? ORDER BY created_at DESC', [session.userId]);
    return json(res, 200, { integrations: rows });
  }

  if (pathname === '/api/integrations' && req.method === 'POST') {
    if (!requireUser(session, res)) return;
    const body = await readBody(req);
    const [projects] = await db.execute('SELECT id FROM projects WHERE id = ? AND user_id = ?', [Number(body.projectId), session.userId]);
    const name = textField(body.name, 100);
    if (!projects[0] || name.length < 2 || !validDatabaseTypes.has(body.type) || !validEnvironments.has(body.environment)) return json(res, 422, { error: 'A valid project, integration name, database type, and environment are required.' });
    const [result] = await db.execute('INSERT INTO integrations (user_id, project_id, name, type, environment) VALUES (?, ?, ?, ?, ?)', [session.userId, projects[0].id, name, body.type, body.environment]);
    await logActivity(session.userId, Number(projects[0].id), 'Demo integration added', name);
    const [rows] = await db.execute('SELECT * FROM integrations WHERE id = ?', [result.insertId]);
    return json(res, 201, { integration: rows[0] });
  }

  if (pathname === '/api/submissions' && req.method === 'GET') {
    if (!requireUser(session, res)) return;
    const [rows] = await db.execute('SELECT s.id, s.project_id, p.name AS project_name, s.form_type, s.name, s.email, s.message, s.created_at FROM submissions s JOIN projects p ON p.id = s.project_id WHERE p.user_id = ? ORDER BY s.created_at DESC LIMIT 300', [session.userId]);
    return json(res, 200, { submissions: rows });
  }

  const submissionsMatch = pathname.match(/^\/api\/projects\/(\d+)\/submissions$/);
  if (submissionsMatch && req.method === 'GET') {
    if (!requireUser(session, res)) return;
    const project = await ownedProject(submissionsMatch[1], session.userId);
    if (!project) return json(res, 404, { error: 'Project not found.' });
    const [rows] = await db.execute('SELECT id, form_type, name, email, message, created_at FROM submissions WHERE project_id = ? ORDER BY created_at DESC LIMIT 200', [project.id]);
    return json(res, 200, { submissions: rows });
  }

  const publicSubmissionMatch = pathname.match(/^\/api\/public\/([^/]+)\/submissions$/);
  if (publicSubmissionMatch && req.method === 'POST') {
    const [projects] = await db.execute('SELECT id, user_id FROM projects WHERE slug = ? AND status = ?', [publicSubmissionMatch[1], 'Published']);
    const project = projects[0];
    if (!project) return json(res, 404, { error: 'Website not found.' });
    const body = await readBody(req);
    const name = textField(body.name || 'Website visitor', 80);
    const email = textField(body.email, 160).toLowerCase();
    const message = textField(body.message, 2000);
    const formType = textField(body.formType || 'contact', 30);
    if (!validFormTypes.has(formType) || name.length < 2 || !emailPattern.test(email) || message.length < 5) return json(res, 422, { error: 'Enter your name, a valid email, and a message of at least 5 characters.' });
    const [result] = await db.execute('INSERT INTO submissions (project_id, form_type, name, email, message) VALUES (?, ?, ?, ?, ?)', [project.id, formType, name, email, message]);
    await logActivity(Number(project.user_id), Number(project.id), 'New website submission', `${formType} · ${email}`);
    return json(res, 201, { submissionId: Number(result.insertId), message: 'Thanks, your message was received.' });
  }

  const publicMatch = pathname.match(/^\/api\/public\/([^/]+)$/);
  if (publicMatch && req.method === 'GET') {
    const [rows] = await db.execute('SELECT * FROM projects WHERE slug = ? AND status = ?', [publicMatch[1], 'Published']);
    return rows[0] ? json(res, 200, { website: projectView(rows[0]) }) : json(res, 404, { error: 'Website not found.' });
  }

  return json(res, 404, { error: 'API route not found.' });
}

async function requestHandler(req, res) {
  const session = sessionFor(req, res);
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  try {
    if (pathname.startsWith('/api/')) return await api(req, res, session, pathname);
    if (pathname.startsWith('/site/')) {
      const [rows] = await db.execute('SELECT id FROM projects WHERE slug = ? AND status = ?', [pathname.slice(6), 'Published']);
      if (!rows[0]) return json(res, 404, { error: 'Website not found.' });
      const filePath = path.join(root, 'index.html');
      res.writeHead(200, { 'content-type': mimeTypes['.html'] });
      return fs.createReadStream(filePath).pipe(res);
    }
    const filePath = path.resolve(root, pathname === '/' ? 'index.html' : `.${pathname}`);
    if ((filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return json(res, 404, { error: 'Not found.' });
    res.writeHead(200, { 'content-type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
    return fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    console.error(error);
    return json(res, error.message === 'Payload too large' ? 413 : 500, { error: 'Unexpected server error.' });
  }
}

async function startServer() {
  try {
    await initializeSchema(db);
    http.createServer(requestHandler).listen(port, () => console.log(`CortexWeb running at http://localhost:${port} (MySQL)`));
  } catch (error) {
    console.error(`Could not start CortexWeb with MySQL: ${error.message}`);
    await db.end();
    process.exitCode = 1;
  }
}

startServer();
