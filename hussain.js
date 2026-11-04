
const CHANNEL = "@H4_T3";
const CHANNEL_URL = "https://t.me/H4_T3";
const OWNER_URL = "https://t.me/H4_T1";
const CONFIG_KEY = "bot:config:v1";

const DEFAULT_CONFIG = {
  welcome: "هلا بيك بقناة H4_T3 🔥\nاختار القسم اللي تريده:",
  categories: [
    { id: "skins", title: "🎭 السكنات" },
    { id: "reveal", title: "👁️ كشف وراء الحيطان" },
    { id: "other", title: "📦 ملفات متنوعة" }
  ],
  quickLinks: []
};

const HELP_TEXT =
  "اختار القسم من القائمة حتى تتصفح المحتوى.\n" +
  "إذا طلب منك البوت الاشتراك، اشترك بالقناة واضغط تحقق.";

async function tg(env, method, body) {
  const res = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }
  );
  const data = await res.json();
  if (!data.ok) console.error(method, data.description);
  return data;
}

async function send(env, chatId, text, keyboard) {
  return tg(env, "sendMessage", {
    chat_id: chatId,
    text: String(text).slice(0, 4000),
    ...(keyboard ? { reply_markup: keyboard } : {})
  });
}

// تعديل رسالة القائمة بدلاً من إرسال رسالة جديدة.
async function editMenu(env, chatId, messageId, text, keyboard) {
  const result = await tg(env, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: String(text).slice(0, 4000),
    ...(keyboard ? { reply_markup: keyboard } : {})
  });

  if (
    !result.ok &&
    !String(result.description || "").includes("message is not modified")
  ) {
    console.error("Menu edit failed:", result.description);
  }

  return result;
}

async function render(env, screen, text, keyboard) {
  if (screen?.messageId) {
    const result = await editMenu(
      env,
      screen.chatId,
      screen.messageId,
      text,
      keyboard
    );

    if (result.ok ||
        String(result.description || "").includes("message is not modified")) {
      return result;
    }
  }

  // إذا تعذر تعديل الرسالة أو لم تكن هناك رسالة سابقة،
  // ننشئ رسالة جديدة ونحدّث معرّف القائمة.
  const result = await send(env, screen.chatId, text, keyboard);
  if (result.ok && result.result?.message_id) {
    screen.messageId = result.result.message_id;
    await saveScreen(env, screen.userId, screen);
  }
  return result;
}

async function answerCallback(env, callbackId, text = "") {
  return tg(env, "answerCallbackQuery", {
    callback_query_id: callbackId,
    ...(text ? { text } : {})
  });
}

function isAdmin(env, userId) {
  return String(env.ADMIN_IDS || "")
    .split(",")
    .map(x => x.trim())
    .includes(String(userId));
}

async function config(env) {
  const saved = await env.FILES_KV.get(CONFIG_KEY, "json");
  if (saved && Array.isArray(saved.categories)) {
    if (!Array.isArray(saved.quickLinks)) saved.quickLinks = [];
    return saved;
  }

  const initial = structuredClone(DEFAULT_CONFIG);
  await env.FILES_KV.put(CONFIG_KEY, JSON.stringify(initial));
  return initial;
}

async function saveConfig(env, cfg) {
  return env.FILES_KV.put(CONFIG_KEY, JSON.stringify(cfg));
}

async function getItems(env, id) {
  return (await env.FILES_KV.get(`items:${id}`, "json")) || [];
}

async function saveItems(env, id, items) {
  return env.FILES_KV.put(`items:${id}`, JSON.stringify(items));
}

async function getFiles(env, id) {
  return (await env.FILES_KV.get(`files:${id}`, "json")) || [];
}

async function saveFiles(env, id, files) {
  return env.FILES_KV.put(`files:${id}`, JSON.stringify(files));
}

async function getState(env, userId) {
  return env.FILES_KV.get(`state:${userId}`, "json");
}

async function setState(env, userId, state) {
  return env.FILES_KV.put(`state:${userId}`, JSON.stringify(state), {
    expirationTtl: 3600
  });
}

async function clearState(env, userId) {
  return env.FILES_KV.delete(`state:${userId}`);
}

async function saveScreen(env, userId, screen) {
  return env.FILES_KV.put(`screen:${userId}`, JSON.stringify(screen), {
    expirationTtl: 86400
  });
}

async function getScreen(env, userId) {
  return env.FILES_KV.get(`screen:${userId}`, "json");
}

async function trackUser(env, user) {
  if (!user?.id) return;
  const key = `user:${user.id}`;
  const now = Date.now();
  const old = await env.FILES_KV.get(key, "json");
  await env.FILES_KV.put(key, JSON.stringify({
    id: user.id,
    first_name: user.first_name || old?.first_name || "",
    username: user.username || old?.username || "",
    first_seen: old ? old.first_seen : now,
    last_seen: now
  }));
}

async function subscribed(env, userId) {
  if (isAdmin(env, userId)) return true;

  const r = await tg(env, "getChatMember", {
    chat_id: CHANNEL,
    user_id: userId
  });

  if (!r.ok) return false;
  const s = r.result.status;
  return s === "creator" || s === "administrator" || s === "member" ||
    (s === "restricted" && r.result.is_member === true);
}

function mainKeyboard(cfg, admin) {
  const buttons = [
    ...cfg.categories.map(c => ({ text: c.title, callback_data: `cat:${c.id}` })),
    ...(cfg.quickLinks || []).map(item => item.type === "url"
      ? { text: item.title, url: item.content }
      : { text: item.title, callback_data: `quick:${item.id}` })
  ];
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  rows.push([{ text: "ℹ️ المساعدة", callback_data: "help" }]);
  if (admin) rows.push([{ text: "⚙️ لوحة الإدارة", callback_data: "adm" }]);
  rows.push([{ text: "👑 المالك والمؤسس", url: OWNER_URL }]);
  return { inline_keyboard: rows };
}

async function showMain(env, screen) {
  const cfg = await config(env);
  return render(
    env,
    screen,
    cfg.welcome || DEFAULT_CONFIG.welcome,
    mainKeyboard(cfg, isAdmin(env, screen.userId))
  );
}

async function requireSubscription(env, screen) {
  if (await subscribed(env, screen.userId)) return true;

  await render(env, screen, "حتى تستخدم البوت، اشترك بالقناة أولاً 👇", {
    inline_keyboard: [
      [{ text: "📢 الاشتراك بالقناة", url: CHANNEL_URL }],
      [{ text: "✅ تحققت من الاشتراك", callback_data: "check_sub" }]
    ]
  });
  return false;
}

function findCategory(cfg, id) {
  return cfg.categories.find(c => c.id === id);
}

function makeId(prefix) {
  return prefix + crypto.randomUUID().replaceAll("-", "").slice(0, 7);
}

async function showCategory(env, screen, categoryId) {
  const cfg = await config(env);
  const category = findCategory(cfg, categoryId);
  if (!category) return render(env, screen, "القسم غير موجود.");

  const items = await getItems(env, categoryId);
  const files = await getFiles(env, categoryId);
  const rows = [];

  for (const item of items) {
    rows.push([{
      text: item.title,
      callback_data: `item:${categoryId}:${item.id}`
    }]);
  }

  files.forEach((file, i) => rows.push([{
    text: `📄 ${file.title || `ملف ${i + 1}`}`,
    callback_data: `get:${categoryId}:${i}`
  }]));

  rows.push([{ text: "⬅️ القائمة الرئيسية", callback_data: "menu" }]);

  return render(
    env,
    screen,
    `📂 ${category.title}\nاختار المحتوى:`,
    { inline_keyboard: rows }
  );
}

async function showItem(env, screen, categoryId, itemId) {
  const items = await getItems(env, categoryId);
  const item = items.find(x => x.id === itemId);
  if (!item) return render(env, screen, "المحتوى غير موجود.");

  // تبقى القائمة في مكانها، والمحتوى يُرسل برسالة منفصلة.
  if (item.type === "text") {
    await send(env, screen.chatId, item.content || "");
  } else if (item.type === "url") {
    await send(env, screen.chatId, item.content || "");
  } else if (item.type === "photo" && item.file_id) {
    await tg(env, "sendPhoto", {
      chat_id: screen.chatId,
      photo: item.file_id,
      caption: item.caption || item.title
    });
  } else if (item.type === "video" && item.file_id) {
    await tg(env, "sendVideo", {
      chat_id: screen.chatId,
      video: item.file_id,
      caption: item.caption || item.title
    });
  } else if (item.type === "document" && item.file_id) {
    await tg(env, "sendDocument", {
      chat_id: screen.chatId,
      document: item.file_id,
      caption: item.caption || item.title
    });
  } else {
    await send(env, screen.chatId, "نوع المحتوى غير صالح.");
  }
}

async function showAdmin(env, screen) {
  return render(env, screen, "⚙️ لوحة الإدارة", {
    inline_keyboard: [
      [{ text: "📂 إدارة الأقسام", callback_data: "acats" }],
      [{ text: "🔗 إدارة الأزرار المباشرة", callback_data: "qlinks" }],
      [{ text: "✏️ تعديل رسالة الترحيب", callback_data: "awelcome" }],
      [{ text: "📊 الإحصائيات", callback_data: "astats" }],
      [{ text: "⬅️ القائمة الرئيسية", callback_data: "menu" }]
    ]
  });
}

async function showAdminQuickLinks(env, screen) {
  const cfg = await config(env);
  const rows = (cfg.quickLinks || []).map((item, i) => [{
    text: `${i + 1}. ${item.title}`,
    callback_data: `qedit:${item.id}`
  }]);
  rows.push([{ text: "➕ إضافة زر مباشر", callback_data: "qadd" }]);
  rows.push([{ text: "⬅️ لوحة الإدارة", callback_data: "adm" }]);
  return render(env, screen, "🔗 الأزرار المباشرة\nهذه الأزرار تظهر بالقائمة الرئيسية، والضغط عليها يفتح الرابط أو يرسل المحتوى مباشرة:", { inline_keyboard: rows });
}

async function showEditQuickLink(env, screen, id) {
  const cfg = await config(env);
  const item = (cfg.quickLinks || []).find(x => x.id === id);
  if (!item) return render(env, screen, "الزر غير موجود.");
  return render(env, screen, `الزر: ${item.title}\nالنوع: ${item.type}`, {
    inline_keyboard: [
      [{ text: "✏️ تغيير الاسم", callback_data: `qrename:${id}` }],
      [{ text: "⬆️", callback_data: `qmove:${id}:up` }, { text: "⬇️", callback_data: `qmove:${id}:down` }],
      [{ text: "🗑️ حذف الزر", callback_data: `qdelask:${id}` }],
      [{ text: "⬅️ الأزرار المباشرة", callback_data: "qlinks" }]
    ]
  });
}

async function sendQuickLink(env, screen, id) {
  const cfg = await config(env);
  const item = (cfg.quickLinks || []).find(x => x.id === id);
  if (!item) return render(env, screen, "المحتوى غير موجود.");
  if (item.type === "text") return send(env, screen.chatId, item.content || "");
  if (item.type === "url") return send(env, screen.chatId, item.content || "");
  if (item.type === "photo" && item.file_id) return tg(env, "sendPhoto", { chat_id: screen.chatId, photo: item.file_id, caption: item.caption || item.title });
  if (item.type === "video" && item.file_id) return tg(env, "sendVideo", { chat_id: screen.chatId, video: item.file_id, caption: item.caption || item.title });
  if (item.type === "document" && item.file_id) return tg(env, "sendDocument", { chat_id: screen.chatId, document: item.file_id, caption: item.caption || item.title });
  return send(env, screen.chatId, "نوع المحتوى غير صالح.");
}

async function showAdminCategories(env, screen) {
  const cfg = await config(env);
  const rows = cfg.categories.map((c, i) => [{
    text: `${i + 1}. ${c.title}`,
    callback_data: `acat:${c.id}`
  }]);

  rows.push([{ text: "➕ إضافة قسم", callback_data: "addcat" }]);
  rows.push([{ text: "⬅️ لوحة الإدارة", callback_data: "adm" }]);

  return render(env, screen, "📂 إدارة الأقسام:", {
    inline_keyboard: rows
  });
}

async function showAdminCategory(env, screen, categoryId) {
  const cfg = await config(env);
  const c = findCategory(cfg, categoryId);
  if (!c) return render(env, screen, "القسم غير موجود.");

  const i = cfg.categories.findIndex(x => x.id === categoryId);
  return render(env, screen, `إدارة القسم: ${c.title}\nالترتيب: ${i + 1}`, {
    inline_keyboard: [
      [{ text: "📑 إدارة المحتوى", callback_data: `items:${categoryId}` }],
      [{ text: "✏️ إعادة تسمية القسم", callback_data: `ren:${categoryId}` }],
      [
        { text: "⬆️", callback_data: `movecat:${categoryId}:up` },
        { text: "⬇️", callback_data: `movecat:${categoryId}:down` }
      ],
      [{ text: "🗑️ حذف القسم", callback_data: `delask:${categoryId}` }],
      [{ text: "⬅️ الأقسام", callback_data: "acats" }]
    ]
  });
}

async function showAdminItems(env, screen, categoryId) {
  const cfg = await config(env);
  const c = findCategory(cfg, categoryId);
  if (!c) return render(env, screen, "القسم غير موجود.");

  const items = await getItems(env, categoryId);
  const files = await getFiles(env, categoryId);
  const rows = [];

  items.forEach(item => rows.push([{
    text: `✏️ ${item.title}`,
    callback_data: `edititem:${categoryId}:${item.id}`
  }]));

  files.forEach((f, i) => rows.push([{
    text: `📄 ${f.title || `ملف ${i + 1}`}`,
    callback_data: `legacy:${categoryId}:${i}`
  }]));

  rows.push([{ text: "➕ إضافة محتوى", callback_data: `additem:${categoryId}` }]);
  rows.push([{ text: "➕ إضافة ملف", callback_data: `addfile:${categoryId}` }]);
  rows.push([{ text: "⬅️ رجوع للقسم", callback_data: `acat:${categoryId}` }]);

  return render(env, screen, `📑 محتوى قسم ${c.title}:`, {
    inline_keyboard: rows
  });
}

async function showEditItem(env, screen, categoryId, itemId) {
  const items = await getItems(env, categoryId);
  const item = items.find(x => x.id === itemId);
  if (!item) return render(env, screen, "المحتوى غير موجود.");

  return render(env, screen, `المحتوى: ${item.title}\nالنوع: ${item.type}`, {
    inline_keyboard: [
      [{ text: "✏️ تغيير الاسم", callback_data: `renameitem:${categoryId}:${itemId}` }],
      [{ text: "🗑️ حذف المحتوى", callback_data: `delitemask:${categoryId}:${itemId}` }],
      [
        { text: "⬆️", callback_data: `moveitem:${categoryId}:${itemId}:up` },
        { text: "⬇️", callback_data: `moveitem:${categoryId}:${itemId}:down` }
      ],
      [{ text: "⬅️ رجوع للمحتوى", callback_data: `items:${categoryId}` }]
    ]
  });
}

async function showLegacyFile(env, screen, categoryId, index) {
  const files = await getFiles(env, categoryId);
  const file = files[Number(index)];
  if (!file?.file_id) return render(env, screen, "الملف غير موجود.");

  // لا نغيّر القائمة؛ نرسل الملف وحده.
  await tg(env, "sendDocument", {
    chat_id: screen.chatId,
    document: file.file_id,
    caption: file.title || "📄 ملف"
  });
}

async function countUsers(env) {
  let cursor;
  let total = 0;
  let active24h = 0;
  let newToday = 0;
  let pages = 0;
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const iraqNow = new Date(now + 3 * 60 * 60 * 1000);
  const todayStart = Date.UTC(iraqNow.getUTCFullYear(), iraqNow.getUTCMonth(), iraqNow.getUTCDate()) - 3 * 60 * 60 * 1000;

  do {
    const result = await env.FILES_KV.list({ prefix: "user:", limit: 1000, ...(cursor ? { cursor } : {}) });
    total += result.keys.length;
    for (let i = 0; i < result.keys.length; i += 50) {
      const batch = result.keys.slice(i, i + 50);
      const records = await Promise.all(batch.map(key => env.FILES_KV.get(key.name, "json")));
      for (const user of records) {
        if (!user) continue;
        if (Number(user.last_seen || 0) >= dayAgo) active24h++;
        if (Number(user.first_seen || 0) >= todayStart) newToday++;
      }
    }
    cursor = result.list_complete ? undefined : result.cursor;
    pages++;
  } while (cursor && pages < 100);

  return { total, active24h, newToday, partial: Boolean(cursor) };
}

const ADMIN_PREFIXES = [
  "adm", "acats", "addcat", "awelcome", "astats", "qadd", "qlinks", "qedit:", "qrename:", "qmove:", "qdelask:", "qdel:", "qtype:", "acat:",
  "ren:", "delask:", "delcat:", "movecat:", "items:",
  "additem:", "addfile:", "itemtype:", "edititem:",
  "renameitem:", "delitemask:", "delitem:", "moveitem:",
  "legacy:", "delfileask:", "delfile:", "renfile:"
];

function isAdminCallback(data) {
  return ADMIN_PREFIXES.some(prefix =>
    prefix.endsWith(":") ? data.startsWith(prefix) : data === prefix
  );
}

async function askForText(env, screen, state, prompt) {
  await setState(env, screen.userId, {
    ...state,
    chatId: screen.chatId,
    messageId: screen.messageId
  });
  return render(env, screen, `${prompt}\n\nللإلغاء أرسل /cancel.`);
}

async function handleCallback(env, cb) {
  const userId = cb.from.id;
  const data = cb.data || "";
  const message = cb.message;
  if (!message) return;

  const screen = {
    userId,
    chatId: message.chat.id,
    messageId: message.message_id
  };
  await saveScreen(env, userId, screen);
  await trackUser(env, cb.from);

  if (isAdminCallback(data) && !isAdmin(env, userId)) {
    return answerCallback(env, cb.id, "هذا الزر خاص بالإدارة.");
  }

  await answerCallback(env, cb.id);

  if (data === "check_sub") {
    if (await subscribed(env, userId)) return showMain(env, screen);
    return requireSubscription(env, screen);
  }

  if (!isAdmin(env, userId) && !(await requireSubscription(env, screen))) {
    return;
  }

  if (data === "menu") return showMain(env, screen);
  if (data === "help") {
    return render(env, screen, HELP_TEXT, {
      inline_keyboard: [[{ text: "⬅️ القائمة الرئيسية", callback_data: "menu" }]]
    });
  }
  if (data === "adm") return showAdmin(env, screen);
  if (data === "acats") return showAdminCategories(env, screen);
  if (data === "qlinks") return showAdminQuickLinks(env, screen);

  if (data === "qadd") {
    return askForText(env, screen, { action: "quick_title" }, "أرسل اسم الزر المباشر:");
  }
  if (data.startsWith("qedit:")) return showEditQuickLink(env, screen, data.slice(6));
  if (data.startsWith("quick:")) return sendQuickLink(env, screen, data.slice(6));
  if (data.startsWith("qrename:")) {
    return askForText(env, screen, { action: "quick_rename", quickId: data.slice(8) }, "أرسل الاسم الجديد للزر:");
  }
  if (data.startsWith("qmove:")) {
    const [, id, direction] = data.split(":");
    const cfg = await config(env);
    const links = cfg.quickLinks || [];
    const i = links.findIndex(x => x.id === id);
    const j = direction === "up" ? i - 1 : i + 1;
    if (i >= 0 && j >= 0 && j < links.length) {
      [links[i], links[j]] = [links[j], links[i]];
      cfg.quickLinks = links;
      await saveConfig(env, cfg);
    }
    return showEditQuickLink(env, screen, id);
  }
  if (data.startsWith("qdelask:")) {
    const id = data.slice(8);
    return render(env, screen, "متأكد تريد حذف هذا الزر؟", { inline_keyboard: [
      [{ text: "نعم، احذف", callback_data: `qdel:${id}` }],
      [{ text: "إلغاء", callback_data: `qedit:${id}` }]
    ] });
  }
  if (data.startsWith("qdel:")) {
    const id = data.slice(5);
    const cfg = await config(env);
    cfg.quickLinks = (cfg.quickLinks || []).filter(x => x.id !== id);
    await saveConfig(env, cfg);
    return showAdminQuickLinks(env, screen);
  }

  if (data === "addcat") {
    return askForText(env, screen, { action: "cat_new" }, "أرسل اسم القسم الجديد:");
  }

  if (data === "awelcome") {
    return askForText(env, screen, { action: "welcome" }, "أرسل رسالة الترحيب الجديدة:");
  }

  if (data === "astats") {
    const stats = await countUsers(env);
    const cfg = await config(env);
    return render(
      env, screen,
      `📊 الإحصائيات\n👥 عدد المستخدمين الكلي: ${stats.total}${stats.partial ? " أو أكثر" : ""}\n🟢 النشطون خلال آخر 24 ساعة: ${stats.active24h}\n🆕 المستخدمون الجدد اليوم: ${stats.newToday}\n📂 عدد الأقسام: ${cfg.categories.length}`,
      { inline_keyboard: [[{ text: "⬅️ لوحة الإدارة", callback_data: "adm" }]] }
    );
  }

  if (data.startsWith("cat:")) return showCategory(env, screen, data.slice(4));

  if (data.startsWith("get:")) {
    const [, categoryId, index] = data.split(":");
    return showLegacyFile(env, screen, categoryId, index);
  }

  if (data.startsWith("item:")) {
    const [, categoryId, itemId] = data.split(":");
    return showItem(env, screen, categoryId, itemId);
  }

  if (data.startsWith("acat:")) return showAdminCategory(env, screen, data.slice(5));

  if (data.startsWith("ren:")) {
    return askForText(
      env, screen,
      { action: "cat_rename", categoryId: data.slice(4) },
      "أرسل الاسم الجديد للقسم:"
    );
  }

  if (data.startsWith("delask:")) {
    const id = data.slice(7);
    const cfg = await config(env);
    const c = findCategory(cfg, id);
    if (!c) return render(env, screen, "القسم غير موجود.");

    return render(env, screen, `متأكد تريد حذف القسم "${c.title}" وكل محتواه؟`, {
      inline_keyboard: [
        [{ text: "نعم، احذف", callback_data: `delcat:${id}` }],
        [{ text: "إلغاء", callback_data: `acat:${id}` }]
      ]
    });
  }

  if (data.startsWith("delcat:")) {
    const id = data.slice(7);
    const cfg = await config(env);
    if (cfg.categories.length <= 1) {
      return render(env, screen, "لازم يبقى قسم واحد على الأقل.");
    }
    if (!findCategory(cfg, id)) return render(env, screen, "القسم غير موجود.");

    cfg.categories = cfg.categories.filter(c => c.id !== id);
    await saveConfig(env, cfg);
    await env.FILES_KV.delete(`items:${id}`);
    await env.FILES_KV.delete(`files:${id}`);
    await render(env, screen, "تم حذف القسم ومحتواه.");
    return showAdminCategories(env, screen);
  }

  if (data.startsWith("movecat:")) {
    const [, id, direction] = data.split(":");
    const cfg = await config(env);
    const i = cfg.categories.findIndex(c => c.id === id);
    const j = direction === "up" ? i - 1 : i + 1;

    if (i >= 0 && j >= 0 && j < cfg.categories.length) {
      [cfg.categories[i], cfg.categories[j]] = [cfg.categories[j], cfg.categories[i]];
      await saveConfig(env, cfg);
    }
    return showAdminCategory(env, screen, id);
  }

  if (data.startsWith("items:")) return showAdminItems(env, screen, data.slice(6));

  if (data.startsWith("additem:")) {
    return askForText(
      env, screen,
      { action: "item_title", categoryId: data.slice(8) },
      "أرسل عنوان المحتوى الجديد:"
    );
  }

  if (data.startsWith("qtype:")) {
    const type = data.slice(6);
    const state = await getState(env, userId);
    if (!state || state.action !== "quick_type") return render(env, screen, "انتهت العملية. ابدأ إضافة الزر من جديد.");
    const prompts = { text: "أرسل النص الذي سيظهر عند الضغط على الزر.", url: "أرسل الرابط كاملاً ويبدأ بـ https:// أو http://", photo: "أرسل الصورة داخل تيليجرام.", video: "أرسل الفيديو داخل تيليجرام.", document: "أرسل الملف كـ Document." };
    return askForText(env, screen, { action: "quick_content", title: state.title, type }, prompts[type] || "أرسل المحتوى:");
  }

  if (data.startsWith("itemtype:")) {
    const [, categoryId, type] = data.split(":");
    const state = await getState(env, userId);
    if (!state || state.action !== "item_type" || state.categoryId !== categoryId) {
      return render(env, screen, "انتهت العملية. ابدأ إضافة المحتوى من جديد.");
    }

    const prompts = {
      text: "أرسل النص.",
      url: "أرسل الرابط كاملاً ويبدأ بـ https:// أو http://",
      photo: "أرسل الصورة كصورة داخل تيليجرام.",
      video: "أرسل الفيديو داخل تيليجرام.",
      document: "أرسل الملف كـ Document."
    };

    return askForText(
      env, screen,
      { action: "item_content", categoryId, title: state.title, type },
      prompts[type] || "أرسل المحتوى:"
    );
  }

  if (data.startsWith("edititem:")) {
    const [, categoryId, itemId] = data.split(":");
    return showEditItem(env, screen, categoryId, itemId);
  }

  if (data.startsWith("renameitem:")) {
    const [, categoryId, itemId] = data.split(":");
    return askForText(
      env, screen,
      { action: "item_rename", categoryId, itemId },
      "أرسل الاسم الجديد للمحتوى:"
    );
  }

  if (data.startsWith("delitemask:")) {
    const [, categoryId, itemId] = data.split(":");
    return render(env, screen, "متأكد تريد حذف هذا المحتوى؟", {
      inline_keyboard: [
        [{ text: "نعم، احذف", callback_data: `delitem:${categoryId}:${itemId}` }],
        [{ text: "إلغاء", callback_data: `edititem:${categoryId}:${itemId}` }]
      ]
    });
  }

  if (data.startsWith("delitem:")) {
    const [, categoryId, itemId] = data.split(":");
    const items = await getItems(env, categoryId);
    await saveItems(env, categoryId, items.filter(x => x.id !== itemId));
    await render(env, screen, "تم حذف المحتوى.");
    return showAdminItems(env, screen, categoryId);
  }

  if (data.startsWith("moveitem:")) {
    const [, categoryId, itemId, direction] = data.split(":");
    const items = await getItems(env, categoryId);
    const i = items.findIndex(x => x.id === itemId);
    const j = direction === "up" ? i - 1 : i + 1;

    if (i >= 0 && j >= 0 && j < items.length) {
      [items[i], items[j]] = [items[j], items[i]];
      await saveItems(env, categoryId, items);
    }
    return showAdminItems(env, screen, categoryId);
  }

  if (data.startsWith("addfile:")) {
    return askForText(
      env, screen,
      { action: "legacy_add_title", categoryId: data.slice(8) },
      "أرسل اسم الملف:"
    );
  }

  if (data.startsWith("legacy:")) {
    const [, categoryId, index] = data.split(":");
    return render(env, screen, "إدارة الملف القديم:", {
      inline_keyboard: [
        [{ text: "✏️ تغيير الاسم", callback_data: `renfile:${categoryId}:${index}` }],
        [{ text: "🗑️ حذف الملف", callback_data: `delfileask:${categoryId}:${index}` }],
        [{ text: "⬅️ رجوع", callback_data: `items:${categoryId}` }]
      ]
    });
  }

  if (data.startsWith("renfile:")) {
    const [, categoryId, index] = data.split(":");
    return askForText(
      env, screen,
      { action: "legacy_rename", categoryId, index: Number(index) },
      "أرسل الاسم الجديد للملف:"
    );
  }

  if (data.startsWith("delfileask:")) {
    const [, categoryId, index] = data.split(":");
    return render(env, screen, "متأكد تريد حذف الملف؟", {
      inline_keyboard: [
        [{ text: "نعم، احذف", callback_data: `delfile:${categoryId}:${index}` }],
        [{ text: "إلغاء", callback_data: `items:${categoryId}` }]
      ]
    });
  }

  if (data.startsWith("delfile:")) {
    const [, categoryId, indexText] = data.split(":");
    const files = await getFiles(env, categoryId);
    const index = Number(indexText);

    if (Number.isInteger(index) && index >= 0 && index < files.length) {
      files.splice(index, 1);
      await saveFiles(env, categoryId, files);
    }
    await render(env, screen, "تم حذف الملف.");
    return showAdminItems(env, screen, categoryId);
  }
}

async function handleStateMessage(env, message, state) {
  const userId = message.from.id;
  const screen = {
    userId,
    chatId: state.chatId || message.chat.id,
    messageId: state.messageId
  };
  const text = (message.text || "").trim();

  if (text === "/cancel") {
    await clearState(env, userId);
    return showMain(env, screen);
  }

  if (state.action === "quick_title") {
    if (!text) return render(env, screen, "أرسل اسم الزر كنص.");
    const cfg = await config(env);
    if ((cfg.quickLinks || []).length >= 30) { await clearState(env, userId); return render(env, screen, "وصلت للحد الأقصى (30 زر مباشر)."); }
    await setState(env, userId, { action: "quick_type", title: text.slice(0, 60) });
    return render(env, screen, "اختار شنو يصير من يضغط المستخدم على الزر:", { inline_keyboard: [
      [{ text: "📝 نص", callback_data: "qtype:text" }, { text: "🔗 رابط يفتح مباشرة", callback_data: "qtype:url" }],
      [{ text: "🎥 فيديو", callback_data: "qtype:video" }, { text: "🖼️ صورة", callback_data: "qtype:photo" }],
      [{ text: "📄 ملف أو تطبيق APK", callback_data: "qtype:document" }]
    ] });
  }

  if (state.action === "quick_content") {
    const item = { id: makeId("q"), title: state.title, type: state.type };
    if (state.type === "text" || state.type === "url") {
      if (!text) return render(env, screen, "أرسل النص أو الرابط.");
      if (state.type === "url" && !/^https?:\/\/\S+$/i.test(text)) return render(env, screen, "الرابط غير صالح. أرسله كاملاً ويبدأ بـ https:// أو http://");
      item.content = text.slice(0, 3500);
    } else if (state.type === "photo") {
      const photo = message.photo?.at(-1);
      if (!photo) return render(env, screen, "أرسل الصورة كصورة داخل تيليجرام.");
      item.file_id = photo.file_id; item.caption = message.caption || state.title;
    } else if (state.type === "video") {
      if (!message.video) return render(env, screen, "أرسل الفيديو داخل تيليجرام.");
      item.file_id = message.video.file_id; item.caption = message.caption || state.title;
    } else if (state.type === "document") {
      if (!message.document) return render(env, screen, "أرسل الملف كـ Document.");
      item.file_id = message.document.file_id; item.caption = message.caption || state.title;
    }
    const cfg = await config(env);
    cfg.quickLinks = cfg.quickLinks || [];
    cfg.quickLinks.push(item);
    await saveConfig(env, cfg);
    await clearState(env, userId);
    return showAdminQuickLinks(env, screen);
  }

  if (state.action === "quick_rename") {
    if (!text) return render(env, screen, "أرسل الاسم الجديد.");
    const cfg = await config(env);
    const item = (cfg.quickLinks || []).find(x => x.id === state.quickId);
    if (item) item.title = text.slice(0, 60);
    await saveConfig(env, cfg);
    await clearState(env, userId);
    return showEditQuickLink(env, screen, state.quickId);
  }

  if (state.action === "cat_new") {
    if (!text) return render(env, screen, "أرسل اسم القسم كنص.");
    const cfg = await config(env);
    if (cfg.categories.length >= 50) {
      await clearState(env, userId);
      return render(env, screen, "وصلت للحد الأقصى للأقسام (50).");
    }
    cfg.categories.push({ id: makeId("c"), title: text.slice(0, 80) });
    await saveConfig(env, cfg);
    await clearState(env, userId);
    return showAdminCategories(env, screen);
  }

  if (state.action === "cat_rename") {
    if (!text) return render(env, screen, "أرسل الاسم الجديد كنص.");
    const cfg = await config(env);
    const c = findCategory(cfg, state.categoryId);
    if (c) c.title = text.slice(0, 80);
    await saveConfig(env, cfg);
    await clearState(env, userId);
    return showAdminCategory(env, screen, state.categoryId);
  }

  if (state.action === "welcome") {
    if (!text) return render(env, screen, "أرسل رسالة الترحيب كنص.");
    const cfg = await config(env);
    cfg.welcome = text.slice(0, 3500);
    await saveConfig(env, cfg);
    await clearState(env, userId);
    return showAdmin(env, screen);
  }

  if (state.action === "item_title") {
    if (!text) return render(env, screen, "أرسل عنواناً نصياً.");
    await setState(env, userId, {
      ...state, action: "item_type", title: text.slice(0, 100)
    });

    return render(env, screen, "اختار نوع المحتوى:", {
      inline_keyboard: [
        [
          { text: "📝 نص", callback_data: `itemtype:${state.categoryId}:text` },
          { text: "🔗 رابط", callback_data: `itemtype:${state.categoryId}:url` }
        ],
        [
          { text: "🖼️ صورة", callback_data: `itemtype:${state.categoryId}:photo` },
          { text: "🎥 فيديو", callback_data: `itemtype:${state.categoryId}:video` }
        ],
        [{ text: "📄 ملف", callback_data: `itemtype:${state.categoryId}:document` }]
      ]
    });
  }

  if (state.action === "item_content") {
    const item = {
      id: makeId("i"),
      title: state.title,
      type: state.type
    };

    if (state.type === "text" || state.type === "url") {
      if (!text) return render(env, screen, "أرسل النص أو الرابط.");
      if (state.type === "url" && !/^https?:\/\/\S+$/i.test(text)) {
        return render(env, screen, "الرابط غير صالح. أرسله كاملاً ويبدأ بـ https:// أو http://");
      }
      item.content = text.slice(0, 3500);
    } else if (state.type === "photo") {
      const photo = message.photo?.at(-1);
      if (!photo) return render(env, screen, "أرسل الصورة كصورة داخل تيليجرام.");
      item.file_id = photo.file_id;
      item.caption = message.caption || state.title;
    } else if (state.type === "video") {
      if (!message.video) return render(env, screen, "أرسل الفيديو داخل تيليجرام.");
      item.file_id = message.video.file_id;
      item.caption = message.caption || state.title;
    } else if (state.type === "document") {
      if (!message.document) return render(env, screen, "أرسل الملف كـ Document.");
      item.file_id = message.document.file_id;
      item.caption = message.caption || state.title;
    }

    const items = await getItems(env, state.categoryId);
    if (items.length >= 100) {
      await clearState(env, userId);
      return render(env, screen, "وصل القسم للحد الأقصى (100 محتوى).");
    }
    items.push(item);
    await saveItems(env, state.categoryId, items);
    await clearState(env, userId);
    return showAdminItems(env, screen, state.categoryId);
  }

  if (state.action === "item_rename") {
    if (!text) return render(env, screen, "أرسل الاسم الجديد.");
    const items = await getItems(env, state.categoryId);
    const item = items.find(x => x.id === state.itemId);
    if (item) item.title = text.slice(0, 100);
    await saveItems(env, state.categoryId, items);
    await clearState(env, userId);
    return showEditItem(env, screen, state.categoryId, state.itemId);
  }

  if (state.action === "legacy_add_title") {
    if (!text) return render(env, screen, "أرسل اسم الملف.");
    await setState(env, userId, {
      ...state, action: "legacy_add_file", title: text.slice(0, 100)
    });
    return render(env, screen, "هسه أرسل الملف كـ Document.");
  }

  if (state.action === "legacy_add_file") {
    if (!message.document) return render(env, screen, "أرسل الملف كـ Document.");
    const files = await getFiles(env, state.categoryId);
    files.push({ title: state.title, file_id: message.document.file_id });
    await saveFiles(env, state.categoryId, files);
    await clearState(env, userId);
    return showAdminItems(env, screen, state.categoryId);
  }

  if (state.action === "legacy_rename") {
    if (!text) return render(env, screen, "أرسل الاسم الجديد.");
    const files = await getFiles(env, state.categoryId);
    if (files[state.index]) files[state.index].title = text.slice(0, 100);
    await saveFiles(env, state.categoryId, files);
    await clearState(env, userId);
    return showAdminItems(env, screen, state.categoryId);
  }

  await clearState(env, userId);
  return showMain(env, screen);
}

async function handleMessage(env, message) {
  if (!message.from || !message.chat) return;

  const userId = message.from.id;
  const chatId = message.chat.id;
  const text = (message.text || "").trim();

  await trackUser(env, message.from);

  if (text === "/id") return send(env, chatId, `Telegram ID: ${userId}`);

  if (text === "/cancel") {
    await clearState(env, userId);
    const screen = await getScreen(env, userId);
    if (screen) return showMain(env, screen);
    return send(env, chatId, "تم إلغاء العملية. أرسل /start.");
  }

  if (text === "/start") {
    await clearState(env, userId);

    const screen = { userId, chatId, messageId: null };
    if (!(await subscribed(env, userId))) {
      await render(env, screen, "حتى تستخدم البوت، اشترك بالقناة أولاً 👇", {
        inline_keyboard: [
          [{ text: "📢 الاشتراك بالقناة", url: CHANNEL_URL }],
          [{ text: "✅ تحققت من الاشتراك", callback_data: "check_sub" }]
        ]
      });
      return;
    }
    return showMain(env, screen);
  }

  if (text === "/help") {
    const screen = await getScreen(env, userId) ||
      { userId, chatId, messageId: null };
    if (!(await requireSubscription(env, screen))) return;
    return render(env, screen, HELP_TEXT, {
      inline_keyboard: [[{ text: "⬅️ القائمة الرئيسية", callback_data: "menu" }]]
    });
  }

  if (text.startsWith("/add ")) {
    if (!isAdmin(env, userId)) return send(env, chatId, "هذا الأمر للإدارة فقط.");
    const parts = text.split(/\s+/);
    const categoryId = parts[1];
    const title = parts.slice(2).join(" ");
    const cfg = await config(env);

    if (!categoryId || !title || !findCategory(cfg, categoryId)) {
      return send(env, chatId, "الاستخدام: /add skins اسم_الملف");
    }

    const screen = await getScreen(env, userId) ||
      { userId, chatId, messageId: null };
    await setState(env, userId, {
      action: "legacy_add_file", categoryId, title: title.slice(0, 100),
      chatId: screen.chatId, messageId: screen.messageId
    });
    return render(env, screen, "أرسل الملف كـ Document.");
  }

  if (text.startsWith("/delete ")) {
    if (!isAdmin(env, userId)) return send(env, chatId, "هذا الأمر للإدارة فقط.");
    const [, categoryId, number] = text.split(/\s+/);
    const files = await getFiles(env, categoryId);
    const index = Number(number) - 1;

    if (!Number.isInteger(index) || index < 0 || !files[index]) {
      return send(env, chatId, "الاستخدام: /delete skins 1");
    }

    files.splice(index, 1);
    await saveFiles(env, categoryId, files);
    return send(env, chatId, "تم حذف الملف.");
  }

  if (text === "/list") {
    if (!isAdmin(env, userId)) return send(env, chatId, "هذا الأمر للإدارة فقط.");
    const cfg = await config(env);
    let out = "الأقسام والملفات القديمة:\n";

    for (const c of cfg.categories) {
      out += `\n${c.id} — ${c.title}\n`;
      const files = await getFiles(env, c.id);
      files.forEach((f, i) => out += `${i + 1}. ${f.title || "ملف"}\n`);
    }
    return send(env, chatId, out.slice(0, 3900));
  }

  if (isAdmin(env, userId)) {
    const state = await getState(env, userId);
    if (state) return handleStateMessage(env, message, state);
  } else if (!(await subscribed(env, userId))) {
    const screen = await getScreen(env, userId) ||
      { userId, chatId, messageId: null };
    return requireSubscription(env, screen);
  }

  return;
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("H4_T3 bot is running", { status: 200 });
    }

    if (!env.BOT_TOKEN || !env.FILES_KV || !env.ADMIN_IDS) {
      return new Response("Missing Worker configuration", { status: 500 });
    }

    try {
      const update = await request.json();

      if (update.callback_query) {
        await handleCallback(env, update.callback_query);
      } else if (update.message) {
        await handleMessage(env, update.message);
      }

      return new Response("OK", { status: 200 });
    } catch (error) {
      console.error("Worker error:", error);
      return new Response("Internal error", { status: 200 });
    }
  }
};
