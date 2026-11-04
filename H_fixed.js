
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
  try {
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
  } catch (error) {
    console.error("Telegram request failed:", method, error);
    return { ok: false, error_code: 503, description: "telegram_network_error" };
  }
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
  const key = `screen:${userId}`;
  const old = await env.FILES_KV.get(key, "json");
  const sameMessage = old && String(old.chatId) === String(screen.chatId) &&
    Number(old.messageId || 0) === Number(screen.messageId || 0);
  if (sameMessage && Date.now() - Number(old.savedAt || 0) < 6 * 60 * 60 * 1000) return;
  return env.FILES_KV.put(key, JSON.stringify({ ...screen, savedAt: Date.now() }), {
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
  const firstName = user.first_name || old?.first_name || "";
  const username = user.username || old?.username || "";
  const isNew = !old;
  const profileChanged = old && (old.first_name !== firstName || old.username !== username);
  const lastWrite = Number(old?.last_seen || 0);
  if (!isNew && !profileChanged && now - lastWrite < 24 * 60 * 60 * 1000) return;
  await env.FILES_KV.put(key, JSON.stringify({
    id: user.id, first_name: firstName, username,
    blocked: Boolean(old?.blocked),
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
  const rows = [];
  if (cfg.categories?.length) {
    rows.push(cfg.categories.slice(0, 3).map(c => ({
      text: c.title, callback_data: `cat:${c.id}`
    })));
    for (let i = 3; i < cfg.categories.length; i++) {
      rows.push([{ text: cfg.categories[i].title, callback_data: `cat:${cfg.categories[i].id}` }]);
    }
  }
  for (const item of (cfg.quickLinks || [])) {
    rows.push([item.type === "url"
      ? { text: item.title, url: item.content }
      : { text: item.title, callback_data: `quick:${item.id}` }]);
  }
  rows.push([{ text: "ℹ️ المساعدة", callback_data: "help" }, { text: "🧰 خدمات البوت", callback_data: "user_tools" }]);
  if (admin) rows.push([{ text: "⚙️ لوحة الإدارة", callback_data: "adm" }]);
  rows.push([{ text: "💎 الملفات المدفوعة", url: OWNER_URL }]);
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

async function hashAccessCode(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
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
      [{ text: "📣 الإعلانات والحملات", callback_data: "campaigns" }],
      [{ text: "📥 تصدير CSV", callback_data: "export_csv" }],
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
    callback_data: f.id ? `mfile:${f.id}` : `legacy:${categoryId}:${i}`
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
  let active7d = 0;
  let active30d = 0;
  let newToday = 0;
  let pages = 0;
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
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
        const lastSeen = Number(user.last_seen || 0);
        if (lastSeen >= dayAgo) active24h++;
        if (lastSeen >= weekAgo) active7d++;
        if (lastSeen >= monthAgo) active30d++;
        if (Number(user.first_seen || 0) >= todayStart) newToday++;
      }
    }
    cursor = result.list_complete ? undefined : result.cursor;
    pages++;
  } while (cursor && pages < 100);

  return { total, active24h, active7d, active30d, newToday, partial: Boolean(cursor) };
}

const ADMIN_PREFIXES = [
  "adm", "acats", "addcat", "awelcome", "astats", "qadd", "qlinks", "qedit:", "qrename:", "qmove:", "qdelask:", "qdel:", "qtype:", "acat:",
  "ren:", "delask:", "delcat:", "movecat:", "items:",
  "additem:", "addfile:", "itemtype:", "edititem:",
  "renameitem:", "delitemask:", "delitem:", "moveitem:",
  "legacy:", "delfileask:", "delfile:", "renfile:", "mfile:", "mfrename:", "mfdesc:", "mfcode:", "mfexpiry:", "mfvideo:", "mfvisibility:", "mfdeleteask:", "mfdelete:", "mfnotify:", "mfnotifygo:", "mfreplace:", "mfcategory:", "mfcatmove:", "export_csv", "campaigns", "campaign_new", "campaign_schedule", "campaign_list", "campaign_cancel:", "pubchoice:", "filenotify:", "camp_target:", "campaign_confirm", "campaign_discard", "campaign_view:", "campaign_edit_text:", "campaign_edit_time:", "campaign_edit_buttons:"
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


// H4_T3 EXTENSIONS — backward-compatible additions.
const BOT_USERNAME = "H4_T3_Files_Bot";
const REQUEST_TEXT = "اكتب اسم الملف أو اللعبة والتفاصيل المطلوبة:";
const PAID_TEXT = "الملفات المدفوعة متاحة عبر التواصل مع المالك:";
const CAMPAIGN_PREFIX = "campaign:";
const CAMPAIGN_BATCH_SIZE = 20;
const CAMPAIGN_DELAY_MS = 55;
const CAMPAIGN_LOCK_KEY = "system:campaign_lock";

async function canPostToChannel(env) {
  const me = await tg(env, "getMe", {});
  if (!me?.ok || !me.result?.id) return false;
  const member = await tg(env, "getChatMember", { chat_id: CHANNEL, user_id: me.result.id });
  return Boolean(member?.ok && ["administrator", "creator"].includes(member.result?.status) && member.result?.can_post_messages !== false);
}

function campaignMarkup(campaign) {
  const buttons = Array.isArray(campaign.buttons) ? campaign.buttons :
    (campaign.buttonText && campaign.buttonUrl ? [{ text: campaign.buttonText, url: campaign.buttonUrl }] : []);
  if (!buttons.length) return undefined;
  const rows = buttons.slice(0, 8).map(button => [{ text: String(button.text).slice(0, 64), url: button.url }]);
  return { inline_keyboard: rows };
}

async function showCampaignPreview(env, screen, campaign, scheduled) {
  const target = campaign.target === "channel" ? "قناة H4_T3" : campaign.target === "both" ? "المستخدمين والقناة" : "مستخدمي البوت";
  const type = campaign.type === "photo" ? "صورة" : campaign.type === "video" ? "فيديو" : "نص";
  const buttons = Array.isArray(campaign.buttons) && campaign.buttons.length
    ? campaign.buttons.map((b, i) => `${i + 1}. ${b.text} — ${b.url}`).join("\n") : "بدون أزرار";
  await setState(env, screen.userId, { action: "campaign_confirm", campaign, scheduled, chatId: screen.chatId, messageId: screen.messageId });
  if (campaign.type === "photo" && campaign.file_id) await tg(env, "sendPhoto", { chat_id: screen.chatId, photo: campaign.file_id, caption: `معاينة الإعلان\n${campaign.text || ""}`.slice(0, 900) });
  if (campaign.type === "video" && campaign.file_id) await tg(env, "sendVideo", { chat_id: screen.chatId, video: campaign.file_id, caption: `معاينة الإعلان\n${campaign.text || ""}`.slice(0, 900) });
  return render(env, screen, `👁️ معاينة الإعلان\nالنوع: ${type}\nالجمهور: ${target}\nالمحتوى: ${(campaign.text || "وسائط بدون وصف").slice(0, 1200)}\nالأزرار:\n${buttons}\n\n${scheduled ? "بعد التأكيد سيُطلب منك موعد النشر." : "بعد التأكيد سيبدأ الإرسال على دفعات."}`, { inline_keyboard: [
    [{ text: "✅ تأكيد", callback_data: "campaign_confirm" }],
    [{ text: "❌ إلغاء", callback_data: "campaign_discard" }]
  ] });
}

async function sendCampaignToChat(env, campaign, chatId) {
  const reply_markup = campaignMarkup(campaign);
  if (campaign.type === "photo") return tg(env, "sendPhoto", {
    chat_id: chatId, photo: campaign.file_id, caption: (campaign.text || "").slice(0, 900),
    ...(reply_markup ? { reply_markup } : {})
  });
  if (campaign.type === "video") return tg(env, "sendVideo", {
    chat_id: chatId, video: campaign.file_id, caption: (campaign.text || "").slice(0, 900),
    ...(reply_markup ? { reply_markup } : {})
  });
  return tg(env, "sendMessage", {
    chat_id: chatId, text: (campaign.text || "").slice(0, 4000),
    ...(reply_markup ? { reply_markup } : {})
  });
}

function parseIraqExpiry(value) {
  const v = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return parseIraqDateTime(`${v} 23:59`);
  return parseIraqDateTime(v);
}

function parseIraqDateTime(value) {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const timestamp = Date.UTC(y, mo - 1, d, h - 3, mi);
  const check = new Date(timestamp + 3 * 60 * 60 * 1000);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || check.getUTCHours() !== h || check.getUTCMinutes() !== mi) return null;
  return timestamp;
}

function allAdminIds(env) {
  return String(env.ADMIN_IDS || "").split(",").map(x => x.trim()).filter(Boolean);
}
function fileId(file, index) {
  if (!file.id) file.id = `old${index}`;
  return String(file.id);
}
async function locateFile(env, id) {
  const cfg = await config(env);
  for (const category of cfg.categories) {
    const files = await getFiles(env, category.id);
    const index = files.findIndex((f, i) => fileId(f, i) === id);
    if (index >= 0) return { category, files, file: files[index], index };
  }
  return null;
}
async function saveLocatedFile(env, found) {
  return saveFiles(env, found.category.id, found.files);
}
function isPublished(file) {
  return !file.status || file.status === "published";
}
function fileButtonLabel(file, index) {
  return `📄 ${String(file.title || `ملف ${index + 1}`).slice(0, 48)}`;
}
async function showCategoryExtended(env, screen, categoryId) {
  const cfg = await config(env);
  const category = findCategory(cfg, categoryId);
  if (!category) return render(env, screen, "القسم غير موجود.");
  const items = await getItems(env, categoryId);
  const files = await getFiles(env, categoryId);
  const rows = [];
  for (const item of items) rows.push([{ text: item.title, callback_data: `item:${categoryId}:${item.id}` }]);
  files.forEach((file, i) => {
    if (isPublished(file)) rows.push([{ text: fileButtonLabel(file, i), callback_data: `get:${categoryId}:${i}` }]);
  });
  rows.push([{ text: "⬅️ القائمة الرئيسية", callback_data: "menu" }]);
  return render(env, screen, `📂 ${category.title}\nاختار المحتوى:`, { inline_keyboard: rows });
}
async function showFileDetails(env, screen, id) {
  const found = await locateFile(env, id);
  if (!found) return render(env, screen, "الملف غير موجود.");
  const f = found.file;
  const details = `${f.title || "ملف"}${f.description ? `\n\n${f.description}` : ""}`;
  return render(env, screen, details, { inline_keyboard: [
    [{ text: "📤 مشاركة الملف", callback_data: `share:${id}` }],
    [{ text: "⬅️ رجوع للقسم", callback_data: `cat:${found.category.id}` }]
  ] });
}
async function deliverManagedFile(env, screen, found) {
  const f = found.file;
  if (!isPublished(f) && !isAdmin(env, screen.userId)) return send(env, screen.chatId, "هذا الملف غير متاح حالياً.");
  if (f.expiresAt && Date.now() > Number(f.expiresAt)) return send(env, screen.chatId, "انتهت صلاحية الوصول لهذا الملف.");
  if ((f.accessCodeHash || f.accessCode) && !isAdmin(env, screen.userId)) {
    await setState(env, screen.userId, { action: "file_access_code", fileId: f.id, chatId: screen.chatId });
    return send(env, screen.chatId, `🔐 هذا الملف محمي برمز وصول.\nأرسل الرمز للمتابعة:`);
  }
  return sendManagedDocument(env, screen, found);
}
function iraqDayKey(timestamp = Date.now()) {
  const d = new Date(timestamp + 3 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
}
function addDailyFileMetric(file, metric, amount = 1) {
  file.dailyMetrics ||= {};
  const day = iraqDayKey();
  file.dailyMetrics[day] ||= { sends: 0, opens: 0, shares: 0, codes: 0 };
  file.dailyMetrics[day][metric] = Number(file.dailyMetrics[day][metric] || 0) + amount;
  for (const key of Object.keys(file.dailyMetrics)) {
    if (Date.now() - Date.parse(key + "T00:00:00+03:00") > 32 * 86400000) delete file.dailyMetrics[key];
  }
}
function sumDailyFileMetric(file, metric, days) {
  const cutoff = Date.now() - days * 86400000;
  return Object.entries(file.dailyMetrics || {}).reduce((sum, [day, values]) =>
    Date.parse(day + "T00:00:00+03:00") >= cutoff ? sum + Number(values?.[metric] || 0) : sum, 0);
}
async function sendManagedDocument(env, screen, found) {
  const f = found.file;
  if (!f.file_id) return send(env, screen.chatId, "ملف التنزيل غير متوفر.");
  if (f.video_id) await tg(env, "sendVideo", { chat_id: screen.chatId, video: f.video_id, caption: `🎥 شرح ${f.title || "الملف"}`.slice(0, 900) });
  const result = await tg(env, "sendDocument", {
    chat_id: screen.chatId, document: f.file_id,
    caption: `${f.title || "📄 ملف"}${f.description ? `\n${f.description}` : ""}`.slice(0, 1000),
    reply_markup: { inline_keyboard: [[{ text: "📤 مشاركة الملف", callback_data: `share:${f.id}` }]] }
  });
  if (result.ok) {
    f.sends = Number(f.sends || 0) + 1;
    f.lastSentAt = Date.now();
    addDailyFileMetric(f, "sends");
    await saveLocatedFile(env, found);
  }
  return result;
}
async function countRecentMetric(env, prefix, days) {
  let cursor, count = 0, pages = 0;
  const cutoff = Date.now() - days * 86400000;
  do {
    const page = await env.FILES_KV.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
    count += page.keys.filter(k => {
      const stamp = Number(k.name.slice(prefix.length));
      return Number.isFinite(stamp) && stamp >= cutoff;
    }).length;
    cursor = page.list_complete ? undefined : page.cursor;
    pages++;
  } while (cursor && pages < 10);
  return count;
}
async function countMetricToday(env, prefix) {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 3 * 60 * 60 * 1000;
  let cursor, count = 0, pages = 0;
  do {
    const page = await env.FILES_KV.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
    count += page.keys.filter(k => Number(k.name.slice(prefix.length)) >= start).length;
    cursor = page.list_complete ? undefined : page.cursor;
    pages++;
  } while (cursor && pages < 10);
  return count;
}

async function countBlockedUsers(env) {
  let cursor, count = 0, pages = 0;
  do {
    const page = await env.FILES_KV.list({ prefix: "user:", limit: 1000, ...(cursor ? { cursor } : {}) });
    for (let i = 0; i < page.keys.length; i += 50) {
      const records = await Promise.all(page.keys.slice(i, i + 50).map(k => env.FILES_KV.get(k.name, "json")));
      count += records.filter(u => u?.blocked).length;
    }
    cursor = page.list_complete ? undefined : page.cursor;
    pages++;
  } while (cursor && pages < 100);
  return count;
}

async function campaignStats(env) {
  let cursor, total = 0, sent = 0, failed = 0, active = 0, createdToday = 0, created7d = 0, pages = 0;
  const now = Date.now();
  const today = new Date(now + 3 * 60 * 60 * 1000);
  const todayStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - 3 * 60 * 60 * 1000;
  do {
    const page = await env.FILES_KV.list({ prefix: CAMPAIGN_PREFIX, limit: 100, ...(cursor ? { cursor } : {}) });
    for (const key of page.keys) {
      const c = await env.FILES_KV.get(key.name, "json");
      if (!c) continue;
      total++;
      if (Number(c.createdAt || 0) >= todayStart) createdToday++;
      if (Number(c.createdAt || 0) >= now - 7 * 86400000) created7d++;
      sent += Number(c.sent || 0) + (c.channelSent ? 1 : 0);
      failed += Number(c.failed || 0) + (c.channelFailed ? 1 : 0);
      if (["scheduled", "queued", "sending"].includes(c.status)) active++;
    }
    cursor = page.list_complete ? undefined : page.cursor;
    pages++;
  } while (cursor && pages < 20);
  return { total, sent, failed, active, createdToday, created7d };
}

async function showFileAdmin(env, screen, id) {
  const found = await locateFile(env, id);
  if (!found) return render(env, screen, "الملف غير موجود.");
  const f = found.file;
  const status = f.status === "scheduled" ? `مجدول: ${new Date(Number(f.publishAt)).toLocaleString("en-GB", { timeZone: "Asia/Baghdad" })}` : f.status === "hidden" ? "مخفي" : "منشور";
  const sent7 = sumDailyFileMetric(f, "sends", 7) + await countRecentMetric(env, `metric:file_send:${id}:`, 7);
  const shared7 = sumDailyFileMetric(f, "shares", 7) + await countRecentMetric(env, `metric:share:${id}:`, 7);
  const sentToday = Number(f.dailyMetrics?.[iraqDayKey()]?.sends || 0) + await countMetricToday(env, `metric:file_send:${id}:`);
  const sharedToday = Number(f.dailyMetrics?.[iraqDayKey()]?.shares || 0) + await countMetricToday(env, `metric:share:${id}:`);
  const opens7 = sumDailyFileMetric(f, "opens", 7) + await countRecentMetric(env, `metric:file_open:${id}:`, 7);
  const codes7 = sumDailyFileMetric(f, "codes", 7) + await countRecentMetric(env, `metric:file_code:${id}:`, 7);
  const codesToday = Number(f.dailyMetrics?.[iraqDayKey()]?.codes || 0) + await countMetricToday(env, `metric:file_code:${id}:`);
  const opensTotal = Number(f.opens || 0);
  return render(env, screen, `📄 ${f.title}\nالحالة: ${status}\nرمز الوصول: ${f.accessCodeHash || f.accessCode ? "مفعّل" : "غير مفعّل"} (استخدامات الرمز: ${Number(f.accessUses || 0)})\nالصلاحية: ${f.expiresAt ? new Date(Number(f.expiresAt)).toLocaleString("en-GB", { timeZone: "Asia/Baghdad" }) : "غير محدودة"}\nالإرسالات: ${Number(f.sends || 0)} | اليوم: ${sentToday} | 7 أيام: ${sent7}\nضغطات المشاركة: ${Number(f.shares || 0)} | اليوم: ${sharedToday} | 7 أيام: ${shared7}\nفتح الروابط: إجمالي ${opensTotal} | آخر 7 أيام ${opens7}\nاستخدامات الرمز: اليوم ${codesToday} | 7 أيام ${codes7}`, { inline_keyboard: [
    [{ text: "✏️ تغيير الاسم", callback_data: `mfrename:${id}` }],
    [{ text: "📝 تعديل الوصف", callback_data: `mfdesc:${id}` }],
    [{ text: "🔐 رمز الوصول", callback_data: `mfcode:${id}` }, { text: "⏳ الصلاحية", callback_data: `mfexpiry:${id}` }],
    [{ text: "🎥 فيديو توضيحي", callback_data: `mfvideo:${id}` }],
    [{ text: "📂 نقل إلى قسم آخر", callback_data: `mfcategory:${id}` }],
    [{ text: "🔄 استبدال الملف", callback_data: `mfreplace:${id}` }],
    [{ text: f.status === "hidden" ? "👁️ إظهار الملف" : "🙈 إخفاء الملف", callback_data: `mfvisibility:${id}` }],
    [{ text: "🔔 إشعار للمستخدمين", callback_data: `mfnotify:${id}` }],
    [{ text: "🗑️ حذف الملف", callback_data: `mfdeleteask:${id}` }],
    [{ text: "⬅️ رجوع", callback_data: `items:${found.category.id}` }]
  ] });
}
async function beginFileCreation(env, screen, categoryId) {
  await setState(env, screen.userId, { action: "managed_file_title", categoryId, chatId: screen.chatId, messageId: screen.messageId });
  return render(env, screen, "أرسل اسم الملف:");
}
async function showCampaignMenu(env, screen) {
  return render(env, screen, "📣 إدارة الإعلانات والحملات\nيمكن إرسال الإعلان للمستخدمين أو للقناة أو للاثنين، مع زر رابط اختياري.", { inline_keyboard: [
    [{ text: "➕ إعلان فوري", callback_data: "campaign_new" }],
    [{ text: "🕒 إعلان مجدول", callback_data: "campaign_schedule" }],
    [{ text: "📋 الإعلانات المجدولة", callback_data: "campaign_list" }],
    [{ text: "⬅️ لوحة الإدارة", callback_data: "adm" }]
  ] });
}
async function startCampaign(env, screen, scheduled) {
  await setState(env, screen.userId, { action: scheduled ? "campaign_schedule_content" : "campaign_content", chatId: screen.chatId, messageId: screen.messageId });
  return render(env, screen, "أرسل نص الإعلان، أو صورة/فيديو مع وصف.\nبعدها تختار الجمهور وتضيف زر رابط اختياري:");
}
async function saveCampaign(env, campaign) {
  return env.FILES_KV.put(`${CAMPAIGN_PREFIX}${campaign.id}`, JSON.stringify(campaign));
}

async function showCampaignList(env, screen) {
  let cursor, pages = 0;
  const active = [], completed = [];
  do {
    const page = await env.FILES_KV.list({ prefix: CAMPAIGN_PREFIX, limit: 100, ...(cursor ? { cursor } : {}) });
    for (const key of page.keys) {
      const c = await env.FILES_KV.get(key.name, "json");
      if (!c) continue;
      const target = c.target === "channel" ? "القناة" : c.target === "both" ? "الاثنين" : "المستخدمين";
      const label = `${c.status === "scheduled" ? "🕒" : c.status === "sent" ? "✅" : c.status === "cancelled" ? "⛔" : "📤"} ${target} — ${(c.text || "إعلان وسائط").slice(0, 28)}`;
      const row = [{ text: label, callback_data: `campaign_view:${c.id}` }];
      if (["scheduled", "queued", "sending"].includes(c.status)) active.push(row);
      else completed.push(row);
    }
    cursor = page.list_complete ? undefined : page.cursor;
    pages++;
  } while (cursor && pages < 10 && active.length < 40 && completed.length < 20);
  const rows = [...active.slice(0, 40), ...completed.slice(-10)];
  rows.push([{ text: "⬅️ رجوع", callback_data: "campaigns" }]);
  return render(env, screen, rows.length > 1 ? "الحملات النشطة وآخر الحملات المنتهية (اضغط لعرض التفاصيل):" : "ماكو حملات حالياً.", { inline_keyboard: rows });
}

async function showCampaignDetails(env, screen, id) {
  const campaign = await env.FILES_KV.get(`${CAMPAIGN_PREFIX}${id}`, "json");
  if (!campaign) return render(env, screen, "الحملة غير موجودة.");
  const target = campaign.target === "channel" ? "القناة" : campaign.target === "both" ? "القناة والمستخدمين" : "المستخدمين";
  const buttons = Array.isArray(campaign.buttons) ? campaign.buttons.map(b => b.text).join("، ") : "بدون";
  const date = campaign.runAt ? new Date(Number(campaign.runAt)).toLocaleString("en-GB", { timeZone: "Asia/Baghdad" }) : "فوري";
  const rows = [];
  if (["scheduled", "queued"].includes(campaign.status)) {
    rows.push([{ text: "✏️ تعديل المحتوى/الوصف", callback_data: `campaign_edit_text:${id}` }]);
    rows.push([{ text: "🔗 تعديل الأزرار", callback_data: `campaign_edit_buttons:${id}` }]);
    if (campaign.status === "scheduled") rows.push([{ text: "🕒 تعديل الموعد", callback_data: `campaign_edit_time:${id}` }]);
    rows.push([{ text: "⛔ إلغاء الحملة", callback_data: `campaign_cancel:${id}` }]);
  } else if (campaign.status === "sending") {
    rows.push([{ text: "⛔ إيقاف بعد الدفعة الحالية", callback_data: `campaign_cancel:${id}` }]);
  }
  rows.push([{ text: "⬅️ قائمة الحملات", callback_data: "campaign_list" }]);
  return render(env, screen, `📣 تفاصيل الحملة\nالحالة: ${campaign.status}\nالجمهور: ${target}\nالموعد: ${date}\nالنص: ${(campaign.text || "وسائط بدون وصف").slice(0, 1000)}\nالأزرار: ${buttons}\nتم الإرسال للمستخدمين: ${campaign.sent || 0}\nفشل: ${campaign.failed || 0}\nالقناة: ${campaign.channelSent ? "تم النشر" : campaign.channelFailed ? "فشل" : "غير منشور"}`, { inline_keyboard: rows });
}

async function queueCampaign(env, campaign) {
  campaign.status = campaign.runAt && campaign.runAt > Date.now() ? "scheduled" : "queued";
  campaign.createdAt = campaign.createdAt || Date.now();
  campaign.sent = Number(campaign.sent || 0);
  campaign.failed = Number(campaign.failed || 0);
  campaign.cursor = null;
  campaign.channelDone = false;
  await saveCampaign(env, campaign);
  return campaign;
}

async function processCampaign(env, campaign) {
  const now = Date.now();
  if (Number(campaign.retryAfterAt || 0) > now) return false;
  if (campaign.status === "scheduled" && Number(campaign.runAt) > now) return false;
  if (!["scheduled", "queued", "sending"].includes(campaign.status)) return false;
  if (campaign.cancelRequested) {
    campaign.status = "cancelled";
    campaign.cancelledAt = Date.now();
    await saveCampaign(env, campaign);
    return true;
  }
  campaign.status = "sending";
  if (campaign.target !== "channel" && campaign.target !== "both") campaign.channelDone = true;

  if ((campaign.target === "channel" || campaign.target === "both") && !campaign.channelDone) {
    const result = await sendCampaignToChat(env, campaign, CHANNEL);
    if (result?.ok) {
      campaign.channelSent = true;
      campaign.channelDone = true;
      delete campaign.retryAfterAt;
    } else if (result?.error_code === 429 || Number(result?.error_code || 0) >= 500) {
      campaign.retryAfterAt = Date.now() + Math.max(5000, Number(result?.parameters?.retry_after || 60) * 1000);
      campaign.lastError = result?.description || "temporary_channel_error";
      await saveCampaign(env, campaign);
      return false;
    } else {
      campaign.channelFailed = true;
      campaign.lastError = result?.description || "channel_send_failed";
      campaign.channelDone = true;
    }
    await saveCampaign(env, campaign);
  }

  if (campaign.target !== "channel" && !campaign.usersDone) {
    let processed = 0;
    while (processed < CAMPAIGN_BATCH_SIZE && !campaign.usersDone) {
      const page = await env.FILES_KV.list({ prefix: "user:", limit: 1, ...(campaign.cursor ? { cursor: campaign.cursor } : {}) });
      if (!page.keys.length) {
        campaign.usersDone = true;
        campaign.cursor = null;
        break;
      }
      const key = page.keys[0];
      const user = await env.FILES_KV.get(key.name, "json");
      if (user?.id) {
        const result = await sendCampaignToChat(env, campaign, user.id);
        if (result?.ok) {
          campaign.sent++;
          delete campaign.retryAfterAt;
        } else if (result?.error_code === 429 || Number(result?.error_code || 0) >= 500) {
          campaign.retryAfterAt = Date.now() + Math.max(5000, Number(result?.parameters?.retry_after || 60) * 1000);
          campaign.lastError = result?.description || "temporary_send_error";
          await saveCampaign(env, campaign);
          return false;
        } else {
          campaign.failed++;
          if (String(result?.description || "").includes("bot was blocked") || String(result?.description || "").includes("user is deactivated")) {
            user.blocked = true;
            await env.FILES_KV.put(key.name, JSON.stringify(user));
          }
        }
      }
      campaign.cursor = page.list_complete ? null : page.cursor;
      if (page.list_complete) campaign.usersDone = true;
      await saveCampaign(env, campaign);
      processed++;
      if (!campaign.usersDone) await new Promise(resolve => setTimeout(resolve, CAMPAIGN_DELAY_MS));
    }
  } else campaign.usersDone = true;

  if (campaign.cancelRequested) {
    campaign.status = "cancelled";
    campaign.cancelledAt = Date.now();
  } else if (campaign.usersDone && campaign.channelDone) {
    campaign.status = "sent";
    campaign.sentAt = Date.now();
    campaign.completed = true;
  }
  await saveCampaign(env, campaign);
  return campaign.completed === true;
}

async function requestAdminHelp(env, message, kind, body) {
  const who = `${message.from.first_name || ""} (@${message.from.username || "بدون معرف"}) — ID ${message.from.id}`;
  for (const adminId of allAdminIds(env)) {
    await send(env, adminId, `${kind}\n${who}\n\n${body}`.slice(0, 3900));
  }
}
async function userToolsKeyboard(env, screen) {
  return render(env, screen, "اختار الخدمة:", { inline_keyboard: [
    [{ text: "📩 طلب ملف", callback_data: "user_request" }],
    [{ text: "📤 مشاركة البوت", url: `https://t.me/share/url?url=https://t.me/${BOT_USERNAME}` }],
    [{ text: "🚩 الإبلاغ عن ملف", callback_data: "user_report" }],
    [{ text: "💎 الملفات المدفوعة", callback_data: "user_paid" }],
    [{ text: "🆘 الدعم والمساعدة", url: OWNER_URL }],
    [{ text: "⬅️ القائمة الرئيسية", callback_data: "menu" }]
  ] });
}


async function countFileStats(env) {
  const cfg = await config(env);
  let totalFiles = 0, published = 0, hidden = 0, scheduled = 0, sends = 0, shares = 0, protectedFiles = 0;
  const top = [];
  for (const category of cfg.categories) {
    const files = await getFiles(env, category.id);
    for (const f of files) {
      totalFiles++;
      if (f.status === "hidden") hidden++;
      else if (f.status === "scheduled") scheduled++;
      else published++;
      sends += Number(f.sends || 0); shares += Number(f.shares || 0);
      if (f.accessCodeHash || f.accessCode) protectedFiles++;
      top.push({ title: f.title || "ملف", opens: Number(f.opens || 0), sends: Number(f.sends || 0) });
    }
  }
  top.sort((a, b) => b.opens - a.opens || b.sends - a.sends);
  return { totalFiles, published, hidden, scheduled, sends, shares, protectedFiles, top: top.slice(0, 5) };
}

async function exportCsv(env, chatId) {
  const rows = [["record_type","id","name_or_title","category_or_target","status","first_seen","last_seen","sends","opens","shares","access_uses","sent","failed","created_at"]];
  const cfg = await config(env);
  for (const c of cfg.categories) {
    const files = await getFiles(env, c.id);
    for (const f of files) rows.push(["file", f.id || "legacy", f.title || "", c.title, f.status || "published", "", "", f.sends || 0, f.opens || 0, f.shares || 0, f.accessUses || 0, "", "", f.createdAt || ""]);
  }
  let cursor, pages = 0;
  do {
    const page = await env.FILES_KV.list({ prefix: "user:", limit: 1000, ...(cursor ? { cursor } : {}) });
    for (let i = 0; i < page.keys.length; i += 50) {
      const records = await Promise.all(page.keys.slice(i, i + 50).map(k => env.FILES_KV.get(k.name, "json")));
      for (const u of records) if (u) rows.push(["user", u.id, `${u.first_name || ""}${u.username ? ` @${u.username}` : ""}`, u.blocked ? "blocked" : "tracked", "", u.first_seen || "", u.last_seen || "", "", "", "", "", "", "", ""]);
    }
    cursor = page.list_complete ? undefined : page.cursor;
    pages++;
  } while (cursor && pages < 100);
  cursor = undefined; pages = 0;
  do {
    const page = await env.FILES_KV.list({ prefix: CAMPAIGN_PREFIX, limit: 100, ...(cursor ? { cursor } : {}) });
    for (const key of page.keys) {
      const c = await env.FILES_KV.get(key.name, "json");
      if (c) rows.push(["campaign", c.id, c.text || "media", c.target || "users", c.status || "", "", "", "", "", "", "", c.sent || 0, c.failed || 0, c.createdAt || ""]);
    }
    cursor = page.list_complete ? undefined : page.cursor;
    pages++;
  } while (cursor && pages < 20);
  const csv = "\uFEFF" + rows.map(row => row.map(v => `"${String(v ?? "").replaceAll('"','""')}"`).join(",")).join("\r\n");
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("document", new Blob([csv], { type: "text/csv;charset=utf-8" }), "h4t3-report.csv");
  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendDocument`, { method: "POST", body: form });
  return response.json();
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
    if (await subscribed(env, userId)) {
      const pending = await getState(env, userId);
      if (pending?.action === "pending_file_link") {
        await clearState(env, userId);
        const found = await locateFile(env, pending.fileId);
        if (found && isPublished(found.file)) {
          found.file.opens = Number(found.file.opens || 0) + 1;
          addDailyFileMetric(found.file, "opens");
          await saveLocatedFile(env, found);
          return deliverManagedFile(env, screen, found);
        }
      }
      return showMain(env, screen);
    }
    return requireSubscription(env, screen);
  }

  if (!isAdmin(env, userId) && !(await requireSubscription(env, screen))) {
    return;
  }

  if (data === "user_tools") return userToolsKeyboard(env, screen);
  if (data === "user_paid") return render(env, screen, PAID_TEXT, { inline_keyboard: [[{ text: "💎 تواصل لشراء الملفات", url: OWNER_URL }], [{ text: "⬅️ رجوع", callback_data: "user_tools" }]] });
  if (data === "user_request" || data === "user_report") {
    return askForText(env, screen, { action: data === "user_request" ? "user_request" : "user_report" }, data === "user_request" ? REQUEST_TEXT : "اكتب اسم الملف وسبب الإبلاغ عنه:");
  }
  if (data.startsWith("share:")) {
    const id = data.slice(6);
    const found = await locateFile(env, id);
    if (!found || !isPublished(found.file) || (found.file.expiresAt && Date.now() > Number(found.file.expiresAt))) return render(env, screen, "الملف غير متاح للمشاركة حالياً.");
    found.file.shares = Number(found.file.shares || 0) + 1;
    addDailyFileMetric(found.file, "shares");
    await saveLocatedFile(env, found);
    const link = `https://t.me/${BOT_USERNAME}?start=file_${id}`;
    return render(env, screen, "رابط مشاركة الملف:", { inline_keyboard: [[{ text: "📤 فتح رابط المشاركة", url: `https://t.me/share/url?url=${encodeURIComponent(link)}` }], [{ text: "⬅️ رجوع", callback_data: `cat:${found.category.id}` }]] });
  }
  if (data.startsWith("mfile:")) return showFileAdmin(env, screen, data.slice(6));
  if (data.startsWith("mfvisibility:")) {
    const f = await locateFile(env, data.slice(13));
    if (!f) return render(env, screen, "الملف غير موجود.");
    f.file.status = f.file.status === "hidden" ? "published" : "hidden";
    await saveLocatedFile(env, f);
    return showFileAdmin(env, screen, data.slice(13));
  }
  if (data.startsWith("mfdeleteask:")) {
    const id = data.slice(12);
    return render(env, screen, "متأكد تريد حذف الملف نهائياً؟", { inline_keyboard: [[{ text: "نعم، احذف", callback_data: `mfdelete:${id}` }], [{ text: "إلغاء", callback_data: `mfile:${id}` }]] });
  }
  if (data.startsWith("mfdelete:")) {
    const id = data.slice(9), f = await locateFile(env, id);
    if (!f) return render(env, screen, "الملف غير موجود.");
    f.files.splice(f.index, 1); await saveFiles(env, f.category.id, f.files);
    return showAdminItems(env, screen, f.category.id);
  }
  if (data.startsWith("mfcategory:")) {
    const id = data.slice("mfcategory:".length);
    const cfg = await config(env);
    const found = await locateFile(env, id);
    if (!found) return render(env, screen, "الملف غير موجود.");
    const rows = cfg.categories.filter(c => c.id !== found.category.id).map(c => [{ text: c.title, callback_data: `mfcatmove:${id}:${c.id}` }]);
    rows.push([{ text: "⬅️ رجوع", callback_data: `mfile:${id}` }]);
    return render(env, screen, "اختار القسم الجديد:", { inline_keyboard: rows });
  }
  if (data.startsWith("mfcatmove:")) {
    const [, id, targetCategoryId] = data.split(":");
    const found = await locateFile(env, id);
    const cfg = await config(env);
    const target = findCategory(cfg, targetCategoryId);
    if (!found || !target) return render(env, screen, "الملف أو القسم غير موجود.");
    if (found.category.id === targetCategoryId) return showFileAdmin(env, screen, id);
    const destination = await getFiles(env, targetCategoryId);
    if (destination.length >= 500) return render(env, screen, "القسم الجديد وصل للحد الأقصى (500 ملف).");
    found.files.splice(found.index, 1);
    destination.push(found.file);
    await saveFiles(env, found.category.id, found.files);
    await saveFiles(env, targetCategoryId, destination);
    return showFileAdmin(env, screen, id);
  }

  if (data.startsWith("mfreplace:")) {
    const id = data.slice(10);
    await setState(env, userId, { action: "mf_replace", fileId: id, chatId: screen.chatId, messageId: screen.messageId });
    return render(env, screen, "أرسل الملف الجديد كـ Document:");
  }
  if (data.startsWith("mfrename:") || data.startsWith("mfdesc:") || data.startsWith("mfcode:") || data.startsWith("mfexpiry:") || data.startsWith("mfvideo:")) {
    const [action, id] = data.split(":");
    const actions = { mfrename: ["mf_rename", "أرسل الاسم الجديد:"], mfdesc: ["mf_desc", "أرسل الوصف الجديد:"], mfcode: ["mf_code", "أرسل رمز الوصول، أو اكتب off لإلغاء الحماية:"], mfexpiry: ["mf_expiry", "أرسل تاريخ انتهاء الصلاحية بصيغة YYYY-MM-DD أو اكتب unlimited:"], mfvideo: ["mf_video", "أرسل فيديو توضيحي:" ] };
    const [stateAction, prompt] = actions[action];
    await setState(env, userId, { action: stateAction, fileId: id, chatId: screen.chatId, messageId: screen.messageId });
    return render(env, screen, prompt);
  }
  if (data.startsWith("mfnotify:")) {
    const id = data.slice(9), f = await locateFile(env, id);
    if (!f) return render(env, screen, "الملف غير موجود.");
    await setState(env, userId, { action: "mf_notify_confirm", fileId: id });
    return render(env, screen, "إرسال إشعار لهذا الملف إلى المستخدمين المسجلين؟", { inline_keyboard: [[{ text: "إرسال الإشعار", callback_data: `mfnotifygo:${id}` }], [{ text: "إلغاء", callback_data: `mfile:${id}` }]] });
  }
  if (data.startsWith("mfnotifygo:")) {
    const id = data.slice(11), f = await locateFile(env, id);
    if (!f) return render(env, screen, "الملف غير موجود.");
    if (f.file.status === "hidden") return render(env, screen, "الملف مخفي. انشره أولاً قبل إرسال إشعار عنه.", { inline_keyboard: [[{ text: "⬅️ إدارة الملف", callback_data: `mfile:${id}` }]] });
    await queueCampaign(env, { id: makeId("ad"), type: "text", target: "users", text: `📢 ملف جديد: ${f.file.title}\n${f.file.description || ""}\nافتح البوت للتنزيل: https://t.me/${BOT_USERNAME}?start=file_${id}`, runAt: f.file.status === "scheduled" ? f.file.publishAt : Date.now(), status: "queued" });
    return render(env, screen, f.file.status === "scheduled" ? "تمت جدولة الإشعار مع موعد نشر الملف." : "تمت إضافة الإشعار إلى قائمة الإرسال وسيُرسل على دفعات.", { inline_keyboard: [[{ text: "⬅️ إدارة الملف", callback_data: `mfile:${id}` }]] });
  }
  if (data === "export_csv") {
    const result = await exportCsv(env, screen.chatId);
    return render(env, screen, result?.ok ? "تم إرسال ملف CSV." : "تعذر إرسال ملف CSV. راجع سجلات Worker.", { inline_keyboard: [[{ text: "⬅️ لوحة الإدارة", callback_data: "adm" }]] });
  }
  if (data === "campaigns") return showCampaignMenu(env, screen);
  if (data === "campaign_new") return startCampaign(env, screen, false);
  if (data === "campaign_schedule") return startCampaign(env, screen, true);
  if (data === "campaign_list") return showCampaignList(env, screen);
  if (data.startsWith("campaign_view:")) return showCampaignDetails(env, screen, data.slice("campaign_view:".length));
  if (data.startsWith("campaign_edit_text:") || data.startsWith("campaign_edit_time:") || data.startsWith("campaign_edit_buttons:")) {
    const [action, id] = data.split(":");
    const campaign = await env.FILES_KV.get(`${CAMPAIGN_PREFIX}${id}`, "json");
    if (!campaign || !["scheduled", "queued"].includes(campaign.status)) return render(env, screen, "لا يمكن تعديل هذه الحملة بحالتها الحالية.");
    const map = {
      campaign_edit_text: ["campaign_edit_text", "أرسل النص أو وصف الوسائط الجديد:"],
      campaign_edit_time: ["campaign_edit_time", "أرسل الموعد الجديد بتوقيت العراق بصيغة YYYY-MM-DD HH:MM:"],
      campaign_edit_buttons: ["campaign_edit_buttons", "أرسل الأزرار كل زر بسطر: اسم الزر | https://example.com أو skip لإزالة الأزرار:"]
    };
    await setState(env, userId, { action: map[action][0], campaignId: id, chatId: screen.chatId, messageId: screen.messageId });
    return render(env, screen, map[action][1]);
  }

  if (data.startsWith("campaign_cancel:")) {
    const id = data.slice("campaign_cancel:".length);
    const c = await env.FILES_KV.get(`${CAMPAIGN_PREFIX}${id}`, "json");
    if (c && ["scheduled", "queued"].includes(c.status)) { c.status = "cancelled"; c.cancelledAt = Date.now(); await saveCampaign(env, c); }
    else if (c?.status === "sending") { c.cancelRequested = true; await saveCampaign(env, c); }
    return showCampaignList(env, screen);
  }

  if (data.startsWith("camp_target:")) {
    const target = data.slice("camp_target:".length);
    if (!["users", "channel", "both"].includes(target)) return render(env, screen, "اختيار الجمهور غير صالح.");
    if (target !== "users" && !(await canPostToChannel(env))) return render(env, screen, "ما أگدر أنشر بالقناة حالياً. لازم تضيف البوت مشرفاً بقناة @H4_T3 وتمنحه صلاحية نشر الرسائل، وبعدها أعد المحاولة.");
    const state = await getState(env, userId);
    if (!state || !["campaign_target"].includes(state.action)) return render(env, screen, "انتهت العملية. ابدأ الإعلان من جديد.");
    state.campaign.target = target;
    await setState(env, userId, { action: "campaign_button", campaign: state.campaign, scheduled: state.scheduled, chatId: screen.chatId, messageId: screen.messageId });
    return render(env, screen, "أرسل الأزرار (كل زر بسطر):\nاسم الزر | https://example.com\nتقدر تضيف حتى 8 أزرار، أو اكتب skip بدون أزرار:");
  }

  if (data.startsWith("filenotify:")) {
    const choice = data.slice("filenotify:".length);
    const state = await getState(env, userId);
    if (!state || state.action !== "managed_file_notify") return render(env, screen, "انتهت العملية.");
    if (!["yes", "no"].includes(choice)) return render(env, screen, "اختيار الإشعار غير صالح.");
    const file = state.file;
    const files = await getFiles(env, state.categoryId);
    if (files.length >= 500) return render(env, screen, "وصل القسم للحد الأقصى (500 ملف). احذف ملفات قديمة أولاً.");
    files.push(file);
    await saveFiles(env, state.categoryId, files);
    await clearState(env, userId);
    if (choice === "yes" && file.status !== "hidden") {
      const id = file.id;
      await queueCampaign(env, { id: makeId("ad"), type: "text", target: "users", text: `📢 ملف جديد: ${file.title}\n${file.description || ""}\nرابط الملف: https://t.me/${BOT_USERNAME}?start=file_${id}`, runAt: file.publishAt || Date.now(), status: "queued" });
    }
    const notice = file.status === "hidden" && choice === "yes" ? "تم حفظ الملف مخفياً. لن نرسل إشعاراً حتى تنشره." : choice === "yes" ? "تم حفظ الملف وإضافة إشعار المستخدمين إلى قائمة الإرسال." : "تم حفظ الملف بدون إشعار للمستخدمين.";
    return render(env, screen, notice, { inline_keyboard: [[{ text: "إدارة الملفات", callback_data: `items:${state.categoryId}` }]] });
  }
  if (data === "campaign_discard") {
    await clearState(env, userId);
    return showCampaignMenu(env, screen);
  }
  if (data === "campaign_confirm") {
    const state = await getState(env, userId);
    if (!state || state.action !== "campaign_confirm") return render(env, screen, "انتهت المعاينة. ابدأ الإعلان من جديد.");
    if (state.scheduled) {
      await setState(env, userId, { action: "campaign_schedule_time", campaign: state.campaign, chatId: screen.chatId, messageId: screen.messageId });
      return render(env, screen, "أرسل موعد النشر بتوقيت العراق بصيغة YYYY-MM-DD HH:MM:");
    }
    const campaign = await queueCampaign(env, state.campaign);
    await clearState(env, userId);
    await processCampaign(env, campaign);
    return render(env, screen, `بدأ إرسال الإعلان فوراً. أُرسلت الدفعة الأولى؛ وسيكمل Cron بقية الإرسال.\nالحالة: ${campaign.status} — ناجح: ${campaign.sent || 0} — فشل: ${campaign.failed || 0}`, { inline_keyboard: [[{ text: "⬅️ الإعلانات", callback_data: "campaigns" }]] });
  }

  if (data.startsWith("pubchoice:")) {
    const state = await getState(env, userId);
    if (!state || state.action !== "managed_file_publish") return render(env, screen, "انتهت العملية. ابدأ إضافة الملف من جديد.");
    const choice = data.slice("pubchoice:".length);
    if (!["now", "later", "hidden"].includes(choice)) return render(env, screen, "طريقة النشر غير صالحة.");
    const file = { id: makeId("f"), title: state.title, description: state.description, file_id: state.file_id, status: choice === "now" ? "published" : choice === "later" ? "scheduled" : "hidden", createdAt: Date.now(), sends: 0, shares: 0, accessUses: 0 };
    if (choice === "later") {
      await setState(env, userId, { action: "managed_file_schedule", categoryId: state.categoryId, file, chatId: screen.chatId, messageId: screen.messageId });
      return render(env, screen, "أرسل موعد النشر بتوقيت العراق بصيغة YYYY-MM-DD HH:MM:");
    }
    await setState(env, userId, { action: "managed_file_notify", categoryId: state.categoryId, file, chatId: screen.chatId, messageId: screen.messageId });
    return render(env, screen, "هل تريد إرسال إشعار للمستخدمين عند إضافة هذا الملف؟", { inline_keyboard: [
      [{ text: "🔔 نعم، أرسل إشعاراً", callback_data: "filenotify:yes" }],
      [{ text: "بدون إشعار", callback_data: "filenotify:no" }]
    ] });
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
    const blocked = await countBlockedUsers(env);
    const campaigns = await campaignStats(env);
    const cfg = await config(env);
    const fs = await countFileStats(env);
    const topText = fs.top.length ? fs.top.map((x, i) => `${i + 1}. ${x.title}: ${x.opens} فتح`).join("\n") : "لا توجد ملفات";
    return render(env, screen,
      `📊 الإحصائيات\n👥 المستخدمون: ${stats.total}${stats.partial ? " أو أكثر" : ""}\n🟢 النشطون 24 ساعة: ${stats.active24h}\n📅 النشطون 7 أيام: ${stats.active7d} | 30 يوماً: ${stats.active30d}\n🆕 الجدد اليوم: ${stats.newToday}\n🚫 المحظورون/المتعذر الوصول إليهم: ${blocked}\n📂 الأقسام: ${cfg.categories.length}\n\n📁 الملفات: ${fs.totalFiles} (منشور ${fs.published} / مخفي ${fs.hidden} / مجدول ${fs.scheduled})\n🔐 المحمية برمز: ${fs.protectedFiles}\n📤 عمليات الإرسال: ${fs.sends}\n🔗 ضغطات المشاركة: ${fs.shares}\n\n📣 الحملات: ${campaigns.total} | نشطة: ${campaigns.active}\nحملات اليوم: ${campaigns.createdToday} | آخر 7 أيام: ${campaigns.created7d}\nإرسال الحملات الناجح: ${campaigns.sent} | الفاشل: ${campaigns.failed}\n\n🏆 الأكثر فتحاً:\n${topText}`,
      { inline_keyboard: [[{ text: "⬅️ لوحة الإدارة", callback_data: "adm" }]] });
  }

  if (data.startsWith("cat:")) return showCategoryExtended(env, screen, data.slice(4));

  if (data.startsWith("get:")) {
    const [, categoryId, indexText] = data.split(":");
    const files = await getFiles(env, categoryId);
    const index = Number(indexText), f = files[index];
    if (!f?.file_id) return render(env, screen, "الملف غير موجود.");
    if (f.id) return deliverManagedFile(env, screen, { category: findCategory(await config(env), categoryId), files, file: f, index });
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

  if (data.startsWith("addfile:")) return beginFileCreation(env, screen, data.slice(8));

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

  if (state.action === "managed_file_title") {
    if (!text) return render(env, screen, "أرسل اسم الملف كنص.");
    await setState(env, userId, { ...state, action: "managed_file_description", title: text.slice(0, 100) });
    return render(env, screen, "أرسل وصف الملف، أو اكتب skip لتخطي الوصف:");
  }
  if (state.action === "managed_file_description") {
    const description = text.toLowerCase() === "skip" ? "" : text.slice(0, 700);
    await setState(env, userId, { ...state, action: "managed_file_document", description });
    return render(env, screen, "أرسل الملف كـ Document:");
  }
  if (state.action === "managed_file_document") {
    if (!message.document) return render(env, screen, "أرسل الملف كـ Document وليس كرابط.");
    await setState(env, userId, { ...state, action: "managed_file_publish", file_id: message.document.file_id });
    return render(env, screen, "حدد طريقة إتاحة الملف:", { inline_keyboard: [
      [{ text: "🚀 نشر الآن", callback_data: "pubchoice:now" }],
      [{ text: "🕒 جدولة النشر", callback_data: "pubchoice:later" }],
      [{ text: "🙈 حفظ مخفياً", callback_data: "pubchoice:hidden" }]
    ] });
  }
  if (state.action === "managed_file_schedule") {
    const date = parseIraqDateTime(text);
    if (!date || date <= Date.now()) return render(env, screen, "الموعد غير صالح أو بالماضي. أرسل YYYY-MM-DD HH:MM بتوقيت العراق.");
    state.file.status = "scheduled";
    state.file.publishAt = date;
    await setState(env, userId, { action: "managed_file_notify", categoryId: state.categoryId, file: state.file, chatId: screen.chatId, messageId: screen.messageId });
    return render(env, screen, "هل تريد إرسال إشعار للمستخدمين عند نشر الملف بموعده؟", { inline_keyboard: [
      [{ text: "🔔 نعم، أرسل إشعاراً", callback_data: "filenotify:yes" }],
      [{ text: "بدون إشعار", callback_data: "filenotify:no" }]
    ] });
  }
  if (state.action === "mf_rename" || state.action === "mf_desc" || state.action === "mf_code" || state.action === "mf_expiry" || state.action === "mf_video") {
    const found = await locateFile(env, state.fileId);
    if (!found) { await clearState(env, userId); return render(env, screen, "الملف غير موجود."); }
    if (state.action === "mf_rename") {
      if (!text) return render(env, screen, "أرسل الاسم الجديد.");
      found.file.title = text.slice(0, 100);
    } else if (state.action === "mf_desc") {
      found.file.description = text.slice(0, 700);
    } else if (state.action === "mf_code") {
      if (!text) return render(env, screen, "أرسل رمزاً غير فارغ أو اكتب off لإلغاء الحماية.");
      if (text.toLowerCase() === "off") {
        delete found.file.accessCode;
        delete found.file.accessCodeHash;
      } else {
        found.file.accessCodeHash = await hashAccessCode(text.slice(0, 40));
        delete found.file.accessCode;
      }
      found.file.accessUses = 0;
    } else if (state.action === "mf_expiry") {
      if (text.toLowerCase() === "unlimited") found.file.expiresAt = null;
      else {
        const ts = parseIraqExpiry(text);
        if (!ts || ts <= Date.now()) return render(env, screen, "التاريخ غير صالح أو بالماضي. أرسل YYYY-MM-DD أو YYYY-MM-DD HH:MM أو unlimited.");
        found.file.expiresAt = ts;
      }
    } else {
      if (!message.video) return render(env, screen, "أرسل فيديو توضيحياً.");
      found.file.video_id = message.video.file_id;
    }
    await saveLocatedFile(env, found); await clearState(env, userId);
    return showFileAdmin(env, screen, state.fileId);
  }
  if (state.action === "mf_replace") {
    const found = await locateFile(env, state.fileId);
    if (!found) { await clearState(env, userId); return render(env, screen, "الملف غير موجود."); }
    if (!message.document) return render(env, screen, "أرسل الملف الجديد كـ Document.");
    found.file.file_id = message.document.file_id;
    found.file.replacedAt = Date.now();
    await saveLocatedFile(env, found); await clearState(env, userId);
    return showFileAdmin(env, screen, state.fileId);
  }
  if (state.action === "file_access_code") {
    const found = await locateFile(env, state.fileId);
    if (!found || !isPublished(found.file) || (found.file.expiresAt && Date.now() > Number(found.file.expiresAt))) {
      await clearState(env, userId);
      return send(env, screen.chatId, "الملف لم يعد متاحاً.");
    }
    const attemptKey = `access_attempts:${userId}`;
    const attempts = await env.FILES_KV.get(attemptKey, "json") || { count: 0 };
    if (Number(attempts.count || 0) >= 5) return send(env, screen.chatId, "تجاوزت عدد المحاولات المسموح. انتظر 10 دقائق ثم أعد المحاولة.");
    const matches = found.file.accessCodeHash
      ? await hashAccessCode(text) === found.file.accessCodeHash
      : text === String(found.file.accessCode || "");
    if (!matches) {
      await env.FILES_KV.put(attemptKey, JSON.stringify({ count: Number(attempts.count || 0) + 1 }), { expirationTtl: 600 });
      return send(env, screen.chatId, Number(attempts.count || 0) + 1 >= 5 ? "وصلت للحد الأقصى للمحاولات. انتظر 10 دقائق." : "رمز الوصول غير صحيح.");
    }
    await clearState(env, userId);
    await env.FILES_KV.delete(attemptKey);
    found.file.accessUses = Number(found.file.accessUses || 0) + 1;
    addDailyFileMetric(found.file, "codes");
    if (found.file.accessCode && !found.file.accessCodeHash) {
      found.file.accessCodeHash = await hashAccessCode(found.file.accessCode);
      delete found.file.accessCode;
    }
    await saveLocatedFile(env, found);
    return sendManagedDocument(env, screen, found);
  }
  if (state.action === "user_request" || state.action === "user_report") {
    if (!text) return render(env, screen, "أرسل التفاصيل كنص.");
    await requestAdminHelp(env, message, state.action === "user_request" ? "📩 طلب ملف جديد" : "🚩 بلاغ عن ملف", text.slice(0, 2500));
    await clearState(env, userId);
    return send(env, screen.chatId, "تم إرسال طلبك للإدارة.");
  }
  if (["campaign_edit_text", "campaign_edit_time", "campaign_edit_buttons"].includes(state.action)) {
    const campaign = await env.FILES_KV.get(`${CAMPAIGN_PREFIX}${state.campaignId}`, "json");
    if (!campaign || !["scheduled", "queued"].includes(campaign.status)) { await clearState(env, userId); return render(env, screen, "لم تعد هذه الحملة قابلة للتعديل."); }
    if (state.action === "campaign_edit_text") {
      if (!text) return render(env, screen, "أرسل نصاً غير فارغ.");
      campaign.text = text.slice(0, campaign.type === "text" ? 3000 : 900);
    } else if (state.action === "campaign_edit_time") {
      const date = parseIraqDateTime(text);
      if (!date || date <= Date.now()) return render(env, screen, "الموعد غير صالح أو بالماضي. أرسل YYYY-MM-DD HH:MM.");
      campaign.runAt = date;
      campaign.status = "scheduled";
    } else {
      if (text.toLowerCase() === "skip") campaign.buttons = [];
      else {
        const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
        if (!lines.length || lines.length > 8) return render(env, screen, "أرسل من 1 إلى 8 أزرار أو skip.");
        const buttons = [];
        for (const line of lines) {
          const parts = line.split("|");
          const label = (parts[0] || "").trim(), url = (parts.slice(1).join("|") || "").trim();
          if (!label || !/^https?:\/\/\S+$/i.test(url)) return render(env, screen, `صيغة غير صحيحة: ${line}`);
          buttons.push({ text: label.slice(0, 64), url: url.slice(0, 1000) });
        }
        campaign.buttons = buttons;
      }
    }
    await saveCampaign(env, campaign);
    await clearState(env, userId);
    return showCampaignDetails(env, screen, campaign.id);
  }

  if (state.action === "campaign_content" || state.action === "campaign_schedule_content") {
    const isScheduled = state.action === "campaign_schedule_content";
    const campaign = { id: makeId("ad"), type: "text", text: text.slice(0, 3000), target: "users", status: "draft", createdAt: Date.now() };
    if (message.photo?.length) { campaign.type = "photo"; campaign.file_id = message.photo.at(-1).file_id; campaign.text = (message.caption || "").slice(0, 900); }
    else if (message.video) { campaign.type = "video"; campaign.file_id = message.video.file_id; campaign.text = (message.caption || "").slice(0, 900); }
    else if (!text) return render(env, screen, "أرسل نص الإعلان أو صورة/فيديو مع وصف.");
    await setState(env, userId, { action: "campaign_target", campaign, scheduled: isScheduled, chatId: screen.chatId, messageId: screen.messageId });
    return render(env, screen, "حدد الجمهور المستهدف:", { inline_keyboard: [
      [{ text: "👥 مستخدمو البوت", callback_data: "camp_target:users" }],
      [{ text: "📢 قناة H4_T3", callback_data: "camp_target:channel" }],
      [{ text: "👥 + 📢 الاثنين", callback_data: "camp_target:both" }]
    ] });
  }
  if (state.action === "campaign_button") {
    if (text.toLowerCase() !== "skip") {
      const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
      if (!lines.length || lines.length > 8) return render(env, screen, "أرسل من 1 إلى 8 أزرار، كل زر بسطر، أو skip.");
      const buttons = [];
      for (const line of lines) {
        const split = line.split("|");
        const label = (split[0] || "").trim();
        const url = (split.slice(1).join("|") || "").trim();
        if (!label || !/^https?:\/\/\S+$/i.test(url)) return render(env, screen, `صيغة الزر غير صحيحة: ${line}\nاستخدم: اسم الزر | https://example.com`);
        buttons.push({ text: label.slice(0, 64), url: url.slice(0, 1000) });
      }
      state.campaign.buttons = buttons;
    }
    return showCampaignPreview(env, screen, state.campaign, Boolean(state.scheduled));
  }
  if (state.action === "campaign_schedule_time") {
    const date = parseIraqDateTime(text);
    if (!date || date <= Date.now()) return render(env, screen, "الموعد غير صالح أو بالماضي. أرسل YYYY-MM-DD HH:MM بتوقيت العراق.");
    state.campaign.runAt = date;
    await queueCampaign(env, state.campaign);
    await clearState(env, userId);
    return render(env, screen, "تمت جدولة الإعلان. فعّل Cron Trigger كل دقيقة في Cloudflare حتى يُنشر بموعده.", { inline_keyboard: [[{ text: "⬅️ الإعلانات", callback_data: "campaigns" }]] });
  }

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

  if (text.startsWith("/start")) {
    await clearState(env, userId);

    const screen = { userId, chatId, messageId: null };
    const startPayload = text.split(/\s+/, 2)[1] || "";
    if (startPayload.startsWith("file_")) {
      const id = startPayload.slice(5);
      if (!(await subscribed(env, userId))) {
        await setState(env, userId, { action: "pending_file_link", fileId: id, chatId, messageId: null });
        return requireSubscription(env, screen);
      }
      const found = await locateFile(env, id);
      if (!found || !isPublished(found.file)) return send(env, chatId, "رابط الملف غير صالح أو أن الملف غير متاح.");
      found.file.opens = Number(found.file.opens || 0) + 1;
      addDailyFileMetric(found.file, "opens");
      await saveLocatedFile(env, found);
      return deliverManagedFile(env, screen, found);
    }
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

  const pendingState = await getState(env, userId);
  if (pendingState?.action === "file_access_code" && !isAdmin(env, userId) && !(await subscribed(env, userId))) {
    const screen = {
      userId,
      chatId: pendingState.chatId || chatId,
      messageId: pendingState.messageId || null
    };
    return requireSubscription(env, screen);
  }
  if (pendingState && (isAdmin(env, userId) || ["user_request", "user_report", "file_access_code"].includes(pendingState.action))) {
    return handleStateMessage(env, message, pendingState);
  }
  if (!isAdmin(env, userId) && !(await subscribed(env, userId))) {
    const screen = await getScreen(env, userId) || { userId, chatId, messageId: null };
    return requireSubscription(env, screen);
  }

  return;
}

export default {
  async scheduled(controller, env, ctx) {
    const now = Date.now();
    // Publish due files first, so notification links never point to a still-scheduled file.
    let fileCursor, filePages = 0;
    do {
      const page = await env.FILES_KV.list({ prefix: "files:", limit: 1000, ...(fileCursor ? { cursor: fileCursor } : {}) });
      for (const key of page.keys) {
        const categoryId = key.name.slice(6);
        const files = await getFiles(env, categoryId);
        let changed = false;
        for (const file of files) {
          if (file.status === "scheduled" && Number(file.publishAt) <= now) {
            file.status = "published";
            file.publishedAt = now;
            changed = true;
          }
        }
        if (changed) await saveFiles(env, categoryId, files);
      }
      fileCursor = page.list_complete ? undefined : page.cursor;
      filePages++;
    } while (fileCursor && filePages < 20);

    const lock = await env.FILES_KV.get(CAMPAIGN_LOCK_KEY);
    if (!lock || Number(lock) < now - 55000) {
      await env.FILES_KV.put(CAMPAIGN_LOCK_KEY, String(now), { expirationTtl: 90 });
      let cursor, pages = 0, processed = false;
      do {
        const page = await env.FILES_KV.list({ prefix: CAMPAIGN_PREFIX, limit: 100, ...(cursor ? { cursor } : {}) });
        for (const key of page.keys) {
          const campaign = await env.FILES_KV.get(key.name, "json");
          if (campaign && ["scheduled", "queued", "sending"].includes(campaign.status) && (!campaign.runAt || Number(campaign.runAt) <= now)) {
            await processCampaign(env, campaign);
            processed = true;
            break;
          }
        }
        if (processed || page.list_complete) break;
        cursor = page.cursor;
        pages++;
      } while (cursor && pages < 20);
      await env.FILES_KV.delete(CAMPAIGN_LOCK_KEY);
    }
  },
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("H4_T3 bot is running", { status: 200 });
    }

    if (!env.BOT_TOKEN || !env.FILES_KV || !env.ADMIN_IDS) {
      return new Response("Missing Worker configuration", { status: 500 });
    }
    if (env.WEBHOOK_SECRET && request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
      return new Response("Forbidden", { status: 403 });
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
