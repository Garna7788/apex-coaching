const https = require('https');

const CONFIG = {
  BOT_TOKEN : process.env.TELEGRAM_BOT_TOKEN,
  SUPABASE_URL: 'https://mzikjfwohagyowfqdwsx.supabase.co',
  SUPABASE_KEY: process.env.SUPABASE_KEY,
  COACH_TELEGRAM_ID: '169051508'
};

const TG_API = `https://api.telegram.org/bot${CONFIG.BOT_TOKEN}`;

const MAIN_KEYBOARD = {
  keyboard: [
    ['📋 Задачи', '📊 Прогресс'],
    ['📈 Отчёт за неделю', '⏹ Остановить']
  ],
  resize_keyboard: true,
  persistent: true
};

const COACH_KEYBOARD = {
  keyboard: [['👥 Мои клиенты']],
  resize_keyboard: true,
  persistent: true
};

async function tgPost(method, data) {
  const response = await fetch(`${TG_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return response.json();
}

async function sendMessage(chatId, text, keyboard) {
  const data = { chat_id: chatId, text: text };
  if (keyboard) data.reply_markup = keyboard;
  return tgPost('sendMessage', data);
}

async function sbGet(table, filter) {
  const response = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/${table}?${filter}&select=*`, {
    headers: {
      'apikey': CONFIG.SUPABASE_KEY,
      'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`
    }
  });
  return response.json();
}

async function sbUpsert(table, data) {
  await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey': CONFIG.SUPABASE_KEY,
      'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify(data)
  });
}

async function handleStart(chatId, userId) {
  if (userId === CONFIG.COACH_TELEGRAM_ID) {
    await sbUpsert('tg_users', { tg_id: userId, role: 'coach', client_code: null, active: true });
    await sendMessage(chatId, 'Привет, Анастасия! 👋\n\nТы подключена как коуч.', COACH_KEYBOARD);
  } else {
    await sendMessage(chatId, `Добро пожаловать в APEX Bot! 👋\n\nОтправь свой код клиента:\n/code твой_код\n\nТвой Telegram ID: ${chatId}`, { remove_keyboard: true });
  }
}

async function handleLinkCode(chatId, userId, code) {
  const rows = await sbGet('apex_store', `key=eq.cl:${code}`);
  if (!rows || rows.length === 0) {
    await sendMessage(chatId, `Код «${code}» не найден. Обратись к Анастасии.`);
    return;
  }
  const clientName = rows[0].value.name || code;
  await sbUpsert('tg_users', { tg_id: userId, role: 'client', client_code: code, active: true });
  await sendMessage(chatId, `✅ ${clientName}, ты подключён(а)!\n\n🌅 Каждое утро в 9:00 — задачи\n📊 Воскресенье 22:00 — отчёт\n🔔 Уведомления о заданиях`, MAIN_KEYBOARD);
  if (CONFIG.COACH_TELEGRAM_ID) await sendMessage(CONFIG.COACH_TELEGRAM_ID, `🔗 Клиент ${clientName} (код: ${code}) подключил бот`, COACH_KEYBOARD);
}

async function handleStatus(chatId, userId) {
  const user = await sbGet('tg_users', `tg_id=eq.${userId}`);
  if (!user || !user[0] || !user[0].client_code) { await sendMessage(chatId, 'Сначала привяжи код: /code твой_код'); return; }
  const rows = await sbGet('apex_store', `key=eq.d:${user[0].client_code}`);
  if (!rows || !rows[0]) { await sendMessage(chatId, 'Данные не найдены'); return; }
  const data = rows[0].value;
  const prog = data.clientProg || [];
  let total = 0, done = 0;
  prog.forEach(ph => ph.sessions.forEach(s => { total++; if (s.done) done++; }));
  const pct = total ? Math.round(done / total * 100) : 0;
  const dw = data.deepwork || {};
  const bar = progressBar(pct);
  await sendMessage(chatId, `📊 Прогресс в APEX\n\n${bar} ${pct}%\nСессий: ${done}/${total}\n\n🧠 Deep Work: ${dw.sessions||0} сессий\n✍️ Журнал: ${(data.journal||[]).length}\n💎 Принципов: ${(data.principles||[]).length}`, MAIN_KEYBOARD);
}

async function handleTasks(chatId, userId) {
  const user = await sbGet('tg_users', `tg_id=eq.${userId}`);
  if (!user || !user[0] || !user[0].client_code) { await sendMessage(chatId, 'Сначала привяжи код: /code твой_код'); return; }
  const rows = await sbGet('apex_store', `key=eq.d:${user[0].client_code}`);
  if (!rows || !rows[0]) { await sendMessage(chatId, 'Данные не найдены'); return; }
  const data = rows[0].value;
  const monthIdx = new Date().getMonth();
  const monthNames = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const taskLines = [];
  (data.spheres || []).forEach(sph => {
    const mt = (sph.tasks||[])[monthIdx]||[];
    mt.forEach(sprint => sprint.forEach(t => { if (!t.done) taskLines.push(`- ${t.text} [${sph.name}]`); }));
  });
  if (taskLines.length === 0) { await sendMessage(chatId, `✅ Все задачи ${monthNames[monthIdx]} выполнены! 🎉`, MAIN_KEYBOARD); return; }
  const preview = taskLines.slice(0,10).join('\n');
  const more = taskLines.length > 10 ? `\n... и ещё ${taskLines.length-10}` : '';
  await sendMessage(chatId, `📋 Задачи на ${monthNames[monthIdx]}:\n\n${preview}${more}\n\nВсего: ${taskLines.length}`, MAIN_KEYBOARD);
}

async function handleWeek(chatId, userId) {
  const user = await sbGet('tg_users', `tg_id=eq.${userId}`);
  if (!user || !user[0] || !user[0].client_code) { await sendMessage(chatId, 'Сначала привяжи код: /code твой_код'); return; }
  const rows = await sbGet('apex_store', `key=eq.d:${user[0].client_code}`);
  if (!rows || !rows[0]) { await sendMessage(chatId, 'Данные не найдены'); return; }
  const data = rows[0].value;
  let done = 0, total = 0;
  (data.spheres||[]).forEach(sph => (sph.tasks||[]).forEach(m => m.forEach(s => s.forEach(t => { total++; if(t.done) done++; }))));
  const pct = total ? Math.round(done/total*100) : 0;
  await sendMessage(chatId, `📈 Отчёт за неделю\n\n${progressBar(pct)} ${pct}%\n✅ Задач: ${done}/${total}\n✍️ Журнал: ${(data.journal||[]).length}\n🧠 Deep Work: ${(data.deepwork||{}).sessions||0} сессий\n\nХорошая неделя! 💪`, MAIN_KEYBOARD);
}

async function handleStop(chatId, userId) {
  await sbUpsert('tg_users', { tg_id: userId, active: false });
  await sendMessage(chatId, '🔕 Напоминания отключены. /start — включить снова', { remove_keyboard: true });
}

async function handleCoachClients(chatId) {
  const clients = await sbGet('tg_users', 'role=eq.client&active=eq.true');
  if (!clients || clients.length === 0) { await sendMessage(chatId, 'Пока нет подключённых клиентов.', COACH_KEYBOARD); return; }
  const lines = clients.map(c => `• ${c.client_code || c.tg_id}`).join('\n');
  await sendMessage(chatId, `👥 Подключённые клиенты (${clients.length}):\n\n${lines}`, COACH_KEYBOARD);
}

function progressBar(pct) {
  let bar = '';
  for (let i = 0; i < 10; i++) bar += i < Math.round(pct/10) ? '█' : '░';
  return bar;
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 200, body: 'APEX Bot is running' };

  try {
    const update = JSON.parse(event.body);
    const updateId = String(update.update_id);

    // Дедупликация
    const check = await sbGet('processed_updates', `update_id=eq.${updateId}`);
    if (check && check.length > 0) return { statusCode: 200, body: 'OK' };
    await sbUpsert('processed_updates', { update_id: updateId });

    const msg = update.message || update.edited_message;
    if (!msg) return { statusCode: 200, body: 'OK' };

    const chatId = msg.chat.id;
    const text = (msg.text || '').trim();
    const userId = String(chatId);

    if (text === '/start') await handleStart(chatId, userId);
    else if (text === '/status' || text === '📊 Прогресс') await handleStatus(chatId, userId);
    else if (text === '/tasks' || text === '📋 Задачи') await handleTasks(chatId, userId);
    else if (text === '/week' || text === '📈 Отчёт за неделю') await handleWeek(chatId, userId);
    else if (text === '/stop' || text === '⏹ Остановить') await handleStop(chatId, userId);
    else if (text === '👥 Мои клиенты') await handleCoachClients(chatId);
    else if (text.startsWith('/code ')) await handleLinkCode(chatId, userId, text.replace('/code ', '').trim().toLowerCase());
    else await sendMessage(chatId, 'Используй кнопки меню или:\n/code [код] — привязать код', userId === CONFIG.COACH_TELEGRAM_ID ? COACH_KEYBOARD : MAIN_KEYBOARD);

  } catch(e) {
    console.error('Error:', e);
  }

  return { statusCode: 200, body: 'OK' };
};
