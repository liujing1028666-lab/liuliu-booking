// 刘刘的预约小站 V3 —— 零依赖 Node 服务（本地优先，可部署到云端共享数据）
// 运行：node server.js  （端口 3000，管理口令默认 liuliu，可用环境变量覆盖）
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'liuliu';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// 可预约时段（30 分钟一格），可按需增删
const BASE_TIMES = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '14:00', '14:30', '15:00', '15:30'];
const SLOT_MIN = 30;
const AVG_WAIT = 10; // 每位等待者平均耗时（分钟），用于估算等待时长

function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch (e) { return { status: 'available', bookings: [], queue: [] }; }
}
function saveData(d) { fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2)); }
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function toMin(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function fmtMin(n) { return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0'); }
function overlap(aS, aD, bS, bD) { return aS < bS + bD && bS < aS + aD; }
function uid() { return Date.now() + '-' + Math.floor(Math.random() * 1000); }

function computeSlots(data, date) {
  const dayBookings = data.bookings.filter(b => b.date === date && b.status !== 'rejected');
  return BASE_TIMES.map(t => {
    const s = toMin(t), e = s + SLOT_MIN;
    const occupied = dayBookings.some(b => overlap(s, SLOT_MIN, toMin(b.time), b.duration));
    return { time: t, end: fmtMin(e), available: !occupied, occupied };
  });
}

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { resolve({}); } });
  });
}
function serveFile(res, file, type) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': type });
    res.end(buf);
  });
}
function getToken(req, u) {
  return (req.headers['x-admin-token']) || u.searchParams.get('token') || '';
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;

  // ---------- 静态页面 ----------
  if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
    return serveFile(res, path.join(PUBLIC_DIR, 'index.html'), 'text/html; charset=utf-8');
  }

  // ---------- 开放接口（访客） ----------
  if (p === '/api/state' && req.method === 'GET') {
    const date = u.searchParams.get('date') || todayStr();
    const data = loadData();
    send(res, 200, {
      status: data.status,
      date,
      slots: computeSlots(data, date),
      queueCount: data.queue.length,
      queueWaitMin: data.queue.length * AVG_WAIT
    });
    return;
  }

  if (p === '/api/bookings' && req.method === 'POST') {
    const b = await readBody(req);
    if (!b.name || !b.topic || !b.time) return send(res, 400, { error: '缺少姓名 / 沟通事项 / 时间' });
    const date = b.date || todayStr();
    const data = loadData();
    const slot = computeSlots(data, date).find(s => s.time === b.time);
    if (slot && slot.occupied) return send(res, 409, { error: '该时段已被占用，请换一个' });
    const booking = {
      id: uid(), date, time: b.time, duration: Number(b.duration) || 30,
      name: b.name, topic: b.topic, note: b.note || '', status: 'pending', createdAt: Date.now()
    };
    data.bookings.push(booking); saveData(data);
    send(res, 200, { ok: true, booking });
    return;
  }

  // 临时登记（我现在想找你）—— 访客可提交，无需口令
  if (p === '/api/queue' && req.method === 'POST') {
    const b = await readBody(req);
    if (!b.name || !b.topic) return send(res, 400, { error: '请填写姓名和想沟通的事' });
    const data = loadData();
    const item = { id: uid(), name: b.name, topic: b.topic, note: b.note || '', createdAt: Date.now() };
    data.queue.push(item); saveData(data);
    send(res, 200, { ok: true, item });
    return;
  }

  // ---------- 管理接口（需口令） ----------
  const needAuth = () => getToken(req, u) === ADMIN_TOKEN;
  function deny() { return send(res, 401, { error: '口令不正确' }); }

  if (p === '/api/admin/status' && req.method === 'GET') {
    if (!needAuth()) return deny();
    return send(res, 200, { status: loadData().status });
  }
  if (p === '/api/admin/status' && req.method === 'POST') {
    if (!needAuth()) return deny();
    const b = await readBody(req);
    if (b.status !== 'available' && b.status !== 'busy') return send(res, 400, { error: '状态值无效' });
    const data = loadData(); data.status = b.status; saveData(data);
    return send(res, 200, { ok: true, status: b.status });
  }

  if (p === '/api/admin/bookings' && req.method === 'GET') {
    if (!needAuth()) return deny();
    const data = loadData();
    const list = data.bookings.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    return send(res, 200, { bookings: list });
  }
  let m;
  if ((m = p.match(/^\/api\/admin\/bookings\/([^/]+)\/decide$/)) && req.method === 'POST') {
    if (!needAuth()) return deny();
    const b = await readBody(req);
    if (b.decision !== 'approved' && b.decision !== 'rejected') return send(res, 400, { error: '决策值无效' });
    const data = loadData();
    const t = data.bookings.find(x => x.id === m[1]);
    if (!t) return send(res, 404, { error: '预约不存在' });
    t.status = b.decision; saveData(data);
    return send(res, 200, { ok: true, booking: t });
  }

  if (p === '/api/admin/queue' && req.method === 'GET') {
    if (!needAuth()) return deny();
    const data = loadData();
    return send(res, 200, { queue: data.queue.slice().reverse() });
  }
  if ((m = p.match(/^\/api\/admin\/queue\/([^/]+)$/)) && req.method === 'DELETE') {
    if (!needAuth()) return deny();
    const data = loadData();
    data.queue = data.queue.filter(x => x.id !== m[1]); saveData(data);
    return send(res, 200, { ok: true });
  }

  if (p === '/api/admin/stats' && req.method === 'GET') {
    if (!needAuth()) return deny();
    const data = loadData();
    const today = todayStr();
    const count = (s) => data.bookings.filter(b => b.status === s).length;
    return send(res, 200, {
      status: data.status,
      total: data.bookings.length,
      pending: count('pending'),
      approved: count('approved'),
      rejected: count('rejected'),
      todayBookings: data.bookings.filter(b => b.date === today).length,
      queueCount: data.queue.length,
      queueWaitMin: data.queue.length * AVG_WAIT
    });
  }

  send(res, 404, { error: '接口不存在' });
});

server.listen(PORT, HOST, () => {
  const lan = require('os').networkInterfaces();
  let ip = '';
  for (const k in lan) for (const n of lan[k]) if (n.family === 'IPv4' && !n.internal) ip = n.address;
  console.log('刘刘的预约小站已启动');
  console.log('  本机访问:   http://localhost:' + PORT);
  if (ip) console.log('  手机扫码:   http://' + ip + ':' + PORT + '  (与电脑同一 WiFi)');
  console.log('  管理口令:   ' + ADMIN_TOKEN + '  (可用 ADMIN_TOKEN 环境变量修改)');
});
