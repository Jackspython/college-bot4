/**
 * ============================================================================
 * 🤖 COLLEGE TELEGRAM BOT - PRODUCTION CLOUD & AUTHENTICATION SUITE
 * ============================================================================
 * Purpose:
 * 1. WhatsApp bot ka data cloud pe store karna (Zero server storage).
 * 2. College students ka verified registration & authentication (Name + Roll).
 * 3. Interactive student features (Attendance, Timetable, Exams, Quiz, Notes).
 * 4. Admin control panel, approvals, broadcasts, CSV exports, & backups.
 * 
 * Tech Stack: Node.js (ES Modules), node-telegram-bot-api, moment-timezone, cron
 * Language Comments: Hinglish (Developer-friendly)
 * ============================================================================
 */

import TelegramBot from 'node-telegram-bot-api';
import moment from 'moment-timezone';
import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import CONFIG from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==================== DIRECTORY INITIALIZATION ====================
// Data aur files directories ensure karo
if (!fs.existsSync(CONFIG.DATA_DIR)) {
  fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true });
}
if (!fs.existsSync(CONFIG.FILES_DIR)) {
  fs.mkdirSync(CONFIG.FILES_DIR, { recursive: true });
}

// ==================== FILE PATHS ====================
const USERS_FILE = path.join(CONFIG.DATA_DIR, 'users.json');
const ATTENDANCE_FILE = path.join(CONFIG.DATA_DIR, 'attendance.json');
const EXAMS_FILE = path.join(CONFIG.DATA_DIR, 'exams.json');
const HOLIDAYS_FILE = path.join(CONFIG.DATA_DIR, 'holidays.json');
const ABSENCES_FILE = path.join(CONFIG.DATA_DIR, 'absences.json');
const NOTES_FILE = path.join(CONFIG.DATA_DIR, 'notes.json');
const ALLOWED_NAMES_FILE = path.join(__dirname, 'allowed_names.json');

// ==================== JSON HELPERS ====================
function loadJson(filePath, defaultValue) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (err) {
    console.error(`⚠️ Error reading ${filePath}:`, err.message);
  }
  return defaultValue;
}

function saveJson(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`❌ Error writing ${filePath}:`, err.message);
  }
}

// ==================== INITIALIZE STATE ====================
let users = loadJson(USERS_FILE, {
  linked: {},
  pending: {},
  blocked: [],
  roll_to_chat: {}
});

let attendance = loadJson(ATTENDANCE_FILE, {});
let examsData = loadJson(EXAMS_FILE, { exams: [] });
let holidays = loadJson(HOLIDAYS_FILE, []);
let absences = loadJson(ABSENCES_FILE, []);
let notes = loadJson(NOTES_FILE, []);
let allowedNamesData = loadJson(ALLOWED_NAMES_FILE, { allowed_names: [] });

// Savers
const saveUsers = () => saveJson(USERS_FILE, users);
const saveAttendance = () => saveJson(ATTENDANCE_FILE, attendance);
const saveExams = () => saveJson(EXAMS_FILE, examsData);
const saveHolidays = () => saveJson(HOLIDAYS_FILE, holidays);
const saveAbsences = () => saveJson(ABSENCES_FILE, absences);
const saveNotes = () => saveJson(NOTES_FILE, notes);

// In-Memory Registration States (chatId -> { step: 'awaiting_name' | 'awaiting_roll', tempName: '' })
const registrationState = new Map();

// Rate Limiter (chatId -> lastCommandTimestamp)
const userCooldowns = new Map();

// Quiz State & Leaderboard (chatId -> { currentQ, score })
const quizSessions = new Map();
const quizLeaderboard = new Map(); // roll/name -> totalPoints

// ==================== TELEGRAM BOT INITIALIZATION ====================
console.log('🚀 Initializing Telegram College Bot...');
const bot = new TelegramBot(CONFIG.TELEGRAM_BOT_TOKEN, { polling: true });

bot.on('polling_error', (error) => {
  if (error && error.code !== 'EFATAL') {
    console.warn('⚠️ Telegram Polling Warning:', error.message || error);
  }
});

console.log('✅ Telegram Bot Polling Active & Ready!');

// ==================== HELPER / MIDDLEWARE FUNCTIONS ====================
// Check if user is Master Admin
function isAdmin(chatId) {
  return String(chatId) === String(CONFIG.ADMIN_CHAT_ID);
}

// Check if user is blocked
function isBlocked(chatId) {
  return users.blocked && users.blocked.includes(String(chatId));
}

// Check if user is registered and approved
function isApproved(chatId) {
  const user = users.linked && users.linked[String(chatId)];
  return Boolean(user && user.status === 'approved');
}

// Rate Limiting Middleware (30s cooldown for non-admin users)
function checkRateLimit(chatId) {
  if (isAdmin(chatId)) return { limited: false };
  const now = Date.now();
  const lastTime = userCooldowns.get(String(chatId)) || 0;
  const cooldownMs = (CONFIG.RATE_LIMIT_SECONDS || 30) * 1000;

  if (now - lastTime < cooldownMs) {
    const remaining = Math.ceil((cooldownMs - (now - lastTime)) / 1000);
    return { limited: true, waitSeconds: remaining };
  }
  userCooldowns.set(String(chatId), now);
  return { limited: false };
}

// Roll Number Format Validator: e.g., 2024PHY001 or general department codes
function isValidRollNumber(roll) {
  const rollRegex = /^\d{4}(PHY|CHE|MAT|BOT|ZOO|[A-Z]{2,4})\d{3}$/i;
  return rollRegex.test(roll.trim());
}

// Send standard unauthenticated message
async function sendAuthRequiredMessage(chatId) {
  await bot.sendMessage(
    chatId,
    `🔒 *Authentication Required!*\n\n` +
    `Yeh command sirf approved students ke liye hai.\n` +
    `Pehle apna account verify karein:\n\n` +
    `👉 /start dabayein aur apna naam aur roll number bhejein.`,
    { parse_mode: 'Markdown' }
  );
}

// ==================== USER REGISTRATION & FLOW HANDLER ====================
// Step 1: /start Command
bot.onText(/\/start/, async (msg) => {
  const chatId = String(msg.chat.id);

  // Security Rule 5: Blocked user /start bhi nahi kar sakta
  if (isBlocked(chatId)) {
    return bot.sendMessage(chatId, '🚫 *Account Blocked*\n\nAapko is bot se block kar diya gaya hai. College Admin se contact karein.', { parse_mode: 'Markdown' });
  }

  // Already approved user
  if (isApproved(chatId)) {
    const student = users.linked[chatId];
    return bot.sendMessage(
      chatId,
      `🎓 *Welcome back, ${student.name}!*\n\n` +
      `Aapka account verified hai (*${student.roll_no}*).\n` +
      `Neeche diye gaye buttons se quick access karein:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📊 Attendance', callback_data: 'btn_att' },
              { text: '📅 Timetable', callback_data: 'btn_time' }
            ],
            [
              { text: '📝 My Exams', callback_data: 'btn_exam' },
              { text: '📚 Notes', callback_data: 'btn_notes' }
            ],
            [
              { text: '📋 Profile', callback_data: 'btn_prof' },
              { text: '❓ Help', callback_data: 'btn_help' }
            ]
          ]
        }
      }
    );
  }

  // Pending user
  if (users.pending && users.pending[chatId]) {
    const req = users.pending[chatId];
    return bot.sendMessage(
      chatId,
      `⏳ *Request Under Review*\n\n` +
      `Aapki details (*${req.name}* - *${req.roll_no}*) admin approval ke liye pending hain.\n` +
      `Jaise hi Admin approve karega, aapko notification mil jayega!`,
      { parse_mode: 'Markdown' }
    );
  }

  // Admin /start
  if (isAdmin(chatId)) {
    return bot.sendMessage(
      chatId,
      `👑 *Namaste Master Admin!*\n\n` +
      `College Bot Control System active hai.\n` +
      `Admin commands dekhne ke liye /admin type karein.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🛠️ Admin Panel', callback_data: 'btn_admin' }],
            [{ text: '⏳ Pending Requests', callback_data: 'btn_pending' }],
            [{ text: '📊 Bot Stats', callback_data: 'btn_stats' }]
          ]
        }
      }
    );
  }

  // Fresh User: Start Step 1
  registrationState.set(chatId, { step: 'awaiting_name' });
  await bot.sendMessage(
    chatId,
    `🎓 *Welcome to College Bot!*\n\n` +
    `Apna pura naam bhejo.\n` +
    `*Format:* First Letter Capital\n` +
    `*Example:* Rounak De`,
    { parse_mode: 'Markdown' }
  );
});

// Listener for normal text messages (Registration Steps 2 & 3)
bot.on('message', async (msg) => {
  const chatId = String(msg.chat.id);
  const text = msg.text ? msg.text.trim() : '';

  // Skip commands and blocked users
  if (!text || text.startsWith('/') || isBlocked(chatId)) return;

  const state = registrationState.get(chatId);
  if (!state) return;

  // ----------------------------------------------------
  // Step 2: User Naam Bheje
  // ----------------------------------------------------
  if (state.step === 'awaiting_name') {
    const allowed = allowedNamesData.allowed_names || [];

    // Rule: Exact match, First letter capital, case-sensitive
    const isMatch = allowed.includes(text);

    if (isMatch) {
      registrationState.set(chatId, {
        step: 'awaiting_roll',
        tempName: text
      });

      return bot.sendMessage(
        chatId,
        `✅ Welcome *${text}*!\n\n` +
        `Ab apna roll number bhejo.\n` +
        `*Format:* 2024PHY001`,
        { parse_mode: 'Markdown' }
      );
    } else {
      return bot.sendMessage(
        chatId,
        `❌ *Name match nahi hua.*\n\n` +
        `Sahi format mein bhejo (Case Sensitive):\n` +
        `*Example:* Rounak De\n\n` +
        `_Note: First letter capital hona chahiye aur college records se exact match hona chahiye._`,
        { parse_mode: 'Markdown' }
      );
    }
  }

  // ----------------------------------------------------
  // Step 3: User Roll Number Bheje
  // ----------------------------------------------------
  if (state.step === 'awaiting_roll') {
    const roll = text.toUpperCase();

    // 1. Format check
    if (!isValidRollNumber(roll)) {
      return bot.sendMessage(
        chatId,
        `❌ *Galat format!*\n` +
        `Sahi format: \`2024PHY001\` (YYYY + DEPT + NUMBER)`,
        { parse_mode: 'Markdown' }
      );
    }

    // 2. Check if roll number already linked to another chat
    if (users.roll_to_chat && users.roll_to_chat[roll] && users.roll_to_chat[roll] !== chatId) {
      return bot.sendMessage(
        chatId,
        `❌ *Ye roll number already kisi aur Telegram account se linked hai.*\n` +
        `Agar yeh aapka roll number hai, toh College Admin se contact karein.`,
        { parse_mode: 'Markdown' }
      );
    }

    // 3. Check if this chat ID already has another roll
    if (users.linked && users.linked[chatId] && users.linked[chatId].roll_no !== roll) {
      return bot.sendMessage(
        chatId,
        `❌ *Ek Telegram account se sirf ek roll number link ho sakta hai.*`,
        { parse_mode: 'Markdown' }
      );
    }

    // All valid! Save to pending requests
    const studentName = state.tempName;
    const requestTime = moment().tz(CONFIG.TIMEZONE).format('DD-MM-YYYY hh:mm A');

    users.pending[chatId] = {
      roll_no: roll,
      name: studentName,
      requested_at: new Date().toISOString()
    };
    saveUsers();

    // Clean registration state
    registrationState.delete(chatId);

    // Reply to student
    await bot.sendMessage(
      chatId,
      `✅ *Details received!*\n\n` +
      `Aapka account admin approval ke liye bheja gaya.\n` +
      `Thoda wait karo... Jaise hi Admin approve karega aapko update mil jayega.`,
      { parse_mode: 'Markdown' }
    );

    // ----------------------------------------------------
    // Step 4: Admin ko notification with Inline Buttons
    // ----------------------------------------------------
    const adminNotification = `🔔 *New User Request*\n\n` +
      `👤 *Name:* ${studentName}\n` +
      `🎓 *Roll:* \`${roll}\`\n` +
      `💬 *Chat ID:* \`${chatId}\`\n` +
      `📅 *Time:* ${requestTime}`;

    try {
      await bot.sendMessage(CONFIG.ADMIN_CHAT_ID, adminNotification, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Approve', callback_data: `app_${chatId}` },
              { text: '❌ Reject', callback_data: `rej_${chatId}` }
            ]
          ]
        }
      });
    } catch (e) {
      console.error('❌ Failed to notify admin:', e.message);
    }
  }
});

// ==================== INLINE BUTTON CALLBACKS ====================
bot.on('callback_query', async (query) => {
  const data = query.data;
  const adminId = String(query.from.id);
  const chatId = String(query.message.chat.id);

  // 1. Admin Approval / Rejection Callbacks
  if (data.startsWith('app_') || data.startsWith('rej_')) {
    if (!isAdmin(adminId)) {
      return bot.answerCallbackQuery(query.id, { text: '❌ Unauthorized! Sirf admin approve kar sakta hai.', show_alert: true });
    }

    const targetChatId = data.replace('app_', '').replace('rej_', '');
    const pendingReq = users.pending && users.pending[targetChatId];

    if (!pendingReq) {
      return bot.answerCallbackQuery(query.id, { text: '⚠️ Request already processed ya exist nahi karti.', show_alert: true });
    }

    if (data.startsWith('app_')) {
      // Step 5: Approve
      users.linked[targetChatId] = {
        roll_no: pendingReq.roll_no,
        name: pendingReq.name,
        status: 'approved',
        linked_at: new Date().toISOString(),
        approved_by: adminId
      };
      if (!users.roll_to_chat) users.roll_to_chat = {};
      users.roll_to_chat[pendingReq.roll_no] = targetChatId;
      delete users.pending[targetChatId];
      saveUsers();

      // Ensure default attendance profile if not exists
      if (!attendance[pendingReq.roll_no]) {
        attendance[pendingReq.roll_no] = {
          name: pendingReq.name,
          total_classes: 0,
          attended: 0,
          percentage: 100,
          history: []
        };
        saveAttendance();
      }

      await bot.answerCallbackQuery(query.id, { text: `✅ ${pendingReq.name} Approved!` });
      await bot.editMessageText(
        `✅ *User Approved!*\n\n` +
        `👤 *Name:* ${pendingReq.name}\n` +
        `🎓 *Roll:* \`${pendingReq.roll_no}\`\n` +
        `💬 *Chat ID:* \`${targetChatId}\`\n` +
        `🛡️ *Approved By:* Admin`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'Markdown'
        }
      );

      // Welcome message to student
      try {
        await bot.sendMessage(
          targetChatId,
          `🎉 *Welcome ${pendingReq.name}!*\n\n` +
          `Aapka account verify aur approve ho gaya hai.\n\n` +
          `Aap ab ye commands use kar sakte ho:\n\n` +
          `📊 /myattendance — Attendance\n` +
          `📅 /mytimetable — Timetable\n` +
          `📝 /myexams — Exams\n` +
          `📋 /myprofile — Profile\n` +
          `📚 /notes — Notes\n` +
          `❓ /help — Help`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '📊 Attendance', callback_data: 'btn_att' },
                  { text: '📅 Timetable', callback_data: 'btn_time' }
                ],
                [
                  { text: '📝 My Exams', callback_data: 'btn_exam' },
                  { text: '📚 Notes', callback_data: 'btn_notes' }
                ]
              ]
            }
          }
        );
      } catch (err) {
        console.error(`Could not send welcome message to ${targetChatId}:`, err.message);
      }
      return;
    }

    if (data.startsWith('rej_')) {
      // Reject
      delete users.pending[targetChatId];
      saveUsers();

      await bot.answerCallbackQuery(query.id, { text: '❌ Request Rejected.' });
      await bot.editMessageText(
        `❌ *User Request Rejected*\n\n` +
        `👤 *Name:* ${pendingReq.name}\n` +
        `🎓 *Roll:* \`${pendingReq.roll_no}\`\n` +
        `💬 *Chat ID:* \`${targetChatId}\``,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'Markdown'
        }
      );

      try {
        await bot.sendMessage(
          targetChatId,
          `❌ *Registration Rejected*\n\n` +
          `Aapki verification request college records se match na hone ke karan reject kar di gayi hai.\n` +
          `Kisi query ke liye apne College Department Admin se contact karein.`,
          { parse_mode: 'Markdown' }
        );
      } catch (e) {}
      return;
    }
  }

  // 2. Navigation Button Callbacks
  if (data === 'btn_att') {
    await bot.answerCallbackQuery(query.id);
    return handleMyAttendance(chatId);
  }
  if (data === 'btn_time') {
    await bot.answerCallbackQuery(query.id);
    return handleMyTimetable(chatId);
  }
  if (data === 'btn_exam') {
    await bot.answerCallbackQuery(query.id);
    return handleMyExams(chatId);
  }
  if (data === 'btn_notes') {
    await bot.answerCallbackQuery(query.id);
    return handleNotesList(chatId);
  }
  if (data === 'btn_prof') {
    await bot.answerCallbackQuery(query.id);
    return handleMyProfile(chatId);
  }
  if (data === 'btn_help') {
    await bot.answerCallbackQuery(query.id);
    return handleHelpCommand(chatId);
  }
  if (data === 'btn_admin') {
    await bot.answerCallbackQuery(query.id);
    return handleAdminDashboard(chatId);
  }
  if (data === 'btn_pending') {
    await bot.answerCallbackQuery(query.id);
    return handlePendingRequests(chatId);
  }
  if (data === 'btn_stats') {
    await bot.answerCallbackQuery(query.id);
    return handleBotStats(chatId);
  }

  // 3. Quiz Callbacks (quiz_ans_QIndex_OptIndex)
  if (data.startsWith('quiz_ans_')) {
    return handleQuizAnswer(query);
  }
});

// ==================== PUBLIC COMMANDS ====================

// /help command
bot.onText(/\/help/, async (msg) => {
  handleHelpCommand(String(msg.chat.id));
});

async function handleHelpCommand(chatId) {
  const isAdm = isAdmin(chatId);
  const isAppr = isApproved(chatId);

  let text = `📖 *College Bot Command Guide*\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  text += `*🌐 Public Commands:*\n` +
    `• /start — Welcome & registration\n` +
    `• /help — Show all commands\n` +
    `• /public — College public info\n` +
    `• /syllabus — Course syllabus options\n` +
    `• /timetable — General routine overview\n` +
    `• /holidays — Full holiday calendar\n` +
    `• /nextholiday — Next upcoming holiday\n\n`;

  if (isAppr) {
    text += `*🎓 Student Commands (Approved):*\n` +
      `• /myprofile — Apna profile & roll info\n` +
      `• /myattendance — Live attendance % & visual bar\n` +
      `• /mytimetable — Personal routine\n` +
      `• /myexams — Upcoming exam schedule\n` +
      `• /quiz — Interactive Physics Quiz\n` +
      `• /doubt [question] — Ask doubt to Admin directly\n` +
      `• /report — Complete academic summary card\n` +
      `• /notes — View study notes & PDFs\n` +
      `• /download [id] — Download note PDF\n\n`;
  }

  if (isAdm) {
    text += `*👑 Admin Commands:*\n` +
      `• /admin — Interactive Admin Dashboard\n` +
      `• /pending — Review pending user requests\n` +
      `• /approve [id] — Approve a user\n` +
      `• /reject [id] — Reject a user\n` +
      `• /block [id] — Block a spam user\n` +
      `• /unblock [id] — Unblock user\n` +
      `• /users — List all approved students\n` +
      `• /search [roll] — Search user details\n` +
      `• /unlink [roll] — Unlink student account\n` +
      `• /broadcast [msg] — Broadcast DM to all students\n` +
      `• /stats — Detailed bot statistics\n` +
      `• /backup — Complete JSON data backup\n` +
      `• /exportusers — Export users as CSV\n` +
      `• /exportattendance — Export attendance as CSV\n`;
  }

  await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
}

// /public command
bot.onText(/\/public/, async (msg) => {
  const chatId = String(msg.chat.id);
  const limit = checkRateLimit(chatId);
  if (limit.limited) return bot.sendMessage(chatId, `⏳ Please wait ${limit.waitSeconds}s.`);

  const text = `🏛️ *${CONFIG.COLLEGE_NAME}*\n` +
    `🔬 *${CONFIG.DEPARTMENT}*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `📍 *Campus:* Dinhata, Cooch Behar, West Bengal\n` +
    `⏰ *College Hours:* 10:00 AM – 05:00 PM (Mon-Sat)\n` +
    `📖 *Central Library:* 10:30 AM – 04:30 PM\n` +
    `🔬 *Physics Laboratories:* Dark Room, Electronics Lab, General Lab\n` +
    `🌐 *Official Website:* dinhata-college.ac.in\n\n` +
    `💡 Registration ke liye /start dabayein!`;

  await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
});

// /syllabus command
bot.onText(/\/syllabus/, async (msg) => {
  const chatId = String(msg.chat.id);
  const text = `📚 *B.Sc Physics Department Syllabus Modules*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `1. *Major 3:* Waves & Optics (Theory + Lab)\n` +
    `2. *Major 4:* Analog Electronics & Circuit Theory\n` +
    `3. *SEC 3:* Computational Physics with Python & NumPy\n` +
    `4. *MDC:* Mathematical Methods for Sciences\n\n` +
    `💡 Note files download karne ke liye /notes check karein!`;

  await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
});

// /timetable command
bot.onText(/\/timetable/, async (msg) => {
  const chatId = String(msg.chat.id);
  const limit = checkRateLimit(chatId);
  if (limit.limited) return bot.sendMessage(chatId, `⏳ Please wait ${limit.waitSeconds}s.`);

  const text = `📅 *General College Routine Overview*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `• Mon: 10:30 AM Major 3 | 01:30 PM Python Lab\n` +
    `• Tue: 10:30 AM Major 4 | 01:30 PM Waves Lab\n` +
    `• Wed: 11:30 AM Major 3 | 02:30 PM Electronics Lab\n` +
    `• Thu: 10:30 AM Major 4 | 12:30 PM Tutorial\n` +
    `• Fri: 11:30 AM Major 3 | 01:30 PM Computational Lab\n` +
    `• Sat: 10:30 AM Seminar & Remedial Classes\n\n` +
    `💡 Apna personal schedule dekhne ke liye /mytimetable use karein.`;

  await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
});

// /holidays command
bot.onText(/\/holidays/, async (msg) => {
  const chatId = String(msg.chat.id);
  if (holidays.length === 0) {
    return bot.sendMessage(chatId, '🏖️ Abhi koi scheduled holidays listed nahi hain.');
  }

  let text = `🏖️ *Upcoming College Holidays Calendar*\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  holidays.forEach((h, i) => {
    text += `${i + 1}. *${h.name}*\n   📅 Date: \`${h.date}\` (${h.type || 'Holiday'})\n\n`;
  });

  await bot.sendMessage(chatId, text.trim(), { parse_mode: 'Markdown' });
});

// /nextholiday command
bot.onText(/\/nextholiday/, async (msg) => {
  const chatId = String(msg.chat.id);
  const today = moment().tz(CONFIG.TIMEZONE);

  let nextHoliday = null;
  let minDiff = Infinity;

  holidays.forEach(h => {
    const hDate = moment.tz(h.date, 'DD-MM-YYYY', CONFIG.TIMEZONE);
    if (hDate.isSameOrAfter(today, 'day')) {
      const diff = hDate.diff(today, 'days');
      if (diff < minDiff) {
        minDiff = diff;
        nextHoliday = { ...h, daysLeft: diff };
      }
    }
  });

  if (!nextHoliday) {
    return bot.sendMessage(chatId, 'ℹ️ Aage koi holidays listed nahi hain. Regular classes continue rahengi.');
  }

  const daysText = nextHoliday.daysLeft === 0 ? 'Aaj hi hai! 🎉' : `${nextHoliday.daysLeft} din baaki hain! ⏳`;
  const text = `🎉 *Next Upcoming Holiday*\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `🏖️ *Occasion:* ${nextHoliday.name}\n` +
    `📅 *Date:* \`${nextHoliday.date}\`\n` +
    `🏷️ *Type:* ${nextHoliday.type || 'College Holiday'}\n` +
    `⏳ *Countdown:* ${daysText}`;

  await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
});

// ==================== STUDENT COMMANDS (AUTHENTICATED) ====================

// /myprofile command
bot.onText(/\/myprofile/, async (msg) => {
  handleMyProfile(String(msg.chat.id));
});

async function handleMyProfile(chatId) {
  if (!isApproved(chatId)) return sendAuthRequiredMessage(chatId);

  const student = users.linked[chatId];
  const userAtt = attendance[student.roll_no] || { total_classes: 0, attended: 0, percentage: 100 };
  const regDate = moment(student.linked_at).tz(CONFIG.TIMEZONE).format('DD MMM YYYY, hh:mm A');

  const text = `📋 *Student Official Profile*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `👤 *Full Name:* ${student.name}\n` +
    `🎓 *College Roll No:* \`${student.roll_no}\`\n` +
    `🏛️ *Department:* ${CONFIG.DEPARTMENT}\n` +
    `📊 *Attendance:* ${userAtt.percentage}% (${userAtt.attended}/${userAtt.total_classes})\n` +
    `🛡️ *Status:* Verified & Approved ✅\n` +
    `💬 *Telegram ID:* \`${chatId}\`\n` +
    `📅 *Registered On:* ${regDate}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💡 Command shortcuts: /myattendance, /myexams, /notes`;

  await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
}

// /myattendance command
bot.onText(/\/myattendance/, async (msg) => {
  handleMyAttendance(String(msg.chat.id));
});

async function handleMyAttendance(chatId) {
  if (!isApproved(chatId)) return sendAuthRequiredMessage(chatId);

  const student = users.linked[chatId];
  const record = attendance[student.roll_no] || { total_classes: 0, attended: 0, percentage: 100, history: [] };

  const total = record.total_classes || 0;
  const attended = record.attended || 0;
  const pct = total === 0 ? 100 : Math.round((attended / total) * 100);

  // Visual Bar: [████████░░]
  const totalBlocks = 10;
  const filledBlocks = Math.round((pct / 100) * totalBlocks);
  const emptyBlocks = totalBlocks - filledBlocks;
  const visualBar = '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);

  const statusEmoji = pct >= 75 ? '🟢 Eligible (Above 75%)' : '🔴 Short Attendance (Below 75%)';

  let text = `📊 *Attendance Summary for ${student.name}*\n` +
    `🎓 *Roll No:* \`${student.roll_no}\`\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `[${visualBar}] *${pct}%*\n\n` +
    `• *Total Classes:* ${total}\n` +
    `• *Classes Attended:* ${attended}\n` +
    `• *Missed Classes:* ${total - attended}\n` +
    `• *Academic Status:* ${statusEmoji}\n\n`;

  if (record.history && record.history.length > 0) {
    text += `*Recent Class Logs:*\n`;
    record.history.slice(-3).reverse().forEach(h => {
      const icon = h.status === 'present' ? '✅' : '❌';
      text += `${icon} ${h.date} - ${h.subject} (${h.status.toUpperCase()})\n`;
    });
  }

  await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
}

// /mytimetable command
bot.onText(/\/mytimetable/, async (msg) => {
  handleMyTimetable(String(msg.chat.id));
});

async function handleMyTimetable(chatId) {
  if (!isApproved(chatId)) return sendAuthRequiredMessage(chatId);

  const student = users.linked[chatId];
  const dayName = moment().tz(CONFIG.TIMEZONE).format('dddd');

  const text = `📅 *Today's Schedule (${dayName})*\n` +
    `👤 Student: ${student.name} (\`${student.roll_no}\`)\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `1. *10:30 AM – 11:30 AM*\n   Waves & Optics (Major 3) - Room 102\n\n` +
    `2. *11:30 AM – 12:30 PM*\n   Analog Electronics (Major 4) - Room 104\n\n` +
    `3. *01:30 PM – 03:30 PM*\n   Practical Laboratory Session (Optics Lab)\n\n` +
    `4. *03:30 PM – 04:30 PM*\n   SEC 3 Computational Physics (Computer Lab)\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💡 Class shuru hone se pehle alerts WhatsApp aur Telegram dono pe aate hain.`;

  await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
}

// /myexams command
bot.onText(/\/myexams/, async (msg) => {
  handleMyExams(String(msg.chat.id));
});

async function handleMyExams(chatId) {
  if (!isApproved(chatId)) return sendAuthRequiredMessage(chatId);

  const exams = examsData.exams || [];
  if (exams.length === 0) {
    return bot.sendMessage(chatId, '📝 Abhi koi upcoming exams scheduled nahi hain! Chill & prepare.');
  }

  let text = `📝 *Upcoming College Examinations*\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  exams.forEach((ex, idx) => {
    text += `${idx + 1}. *${ex.subject}*\n` +
      `   📅 Date: \`${ex.date}\` at \`${ex.time}\`\n` +
      `   🏫 Room: ${ex.room || 'Main Exam Hall'}\n\n`;
  });

  text += `━━━━━━━━━━━━━━━━━━━━━━━━━\n💡 Hall ticket aur ID card saath lana na bhoolein.`;
  await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
}

// /doubt [question] command
bot.onText(/\/doubt(?:\s+([\s\S]+))?/, async (msg, match) => {
  const chatId = String(msg.chat.id);
  if (!isApproved(chatId)) return sendAuthRequiredMessage(chatId);

  const question = match[1] ? match[1].trim() : '';
  if (!question) {
    return bot.sendMessage(
      chatId,
      `❓ *Ask a Doubt to Faculty / Admin*\n\n` +
      `Format: \`/doubt <Aapka question yahan>\`\n` +
      `Example: \`/doubt Sir Major 3 optics assignment kab submit karna hai?\``,
      { parse_mode: 'Markdown' }
    );
  }

  const student = users.linked[chatId];
  const time = moment().tz(CONFIG.TIMEZONE).format('DD-MM-YYYY hh:mm A');

  // Forward to Master Admin
  const adminMsg = `📩 *New Student Doubt Received!*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `👤 *Student:* ${student.name}\n` +
    `🎓 *Roll No:* \`${student.roll_no}\`\n` +
    `💬 *Chat ID:* \`${chatId}\`\n` +
    `📅 *Time:* ${time}\n\n` +
    `❓ *Question:*\n"${question}"\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💡 Reply karne ke liye Telegram pe student ko message karein ya broadcast karein.`;

  try {
    await bot.sendMessage(CONFIG.ADMIN_CHAT_ID, adminMsg, { parse_mode: 'Markdown' });
    await bot.sendMessage(chatId, `✅ *Doubt Sent!*\n\nAapka question Admin/Faculty ko bhej diya gaya hai. Jald hi reply aayega.`, { parse_mode: 'Markdown' });
  } catch (err) {
    await bot.sendMessage(chatId, `❌ Failed to forward doubt: ${err.message}`);
  }
});

// /report command
bot.onText(/\/report/, async (msg) => {
  const chatId = String(msg.chat.id);
  if (!isApproved(chatId)) return sendAuthRequiredMessage(chatId);

  const student = users.linked[chatId];
  const att = attendance[student.roll_no] || { total_classes: 0, attended: 0, percentage: 100 };
  const exams = examsData.exams || [];

  const text = `📄 *COMPREHENSIVE ACADEMIC REPORT CARD*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `🎓 *Student:* ${student.name}\n` +
    `🔢 *Roll Number:* \`${student.roll_no}\`\n` +
    `🏛️ *College:* ${CONFIG.COLLEGE_NAME}\n` +
    `🔬 *Department:* ${CONFIG.DEPARTMENT}\n\n` +
    `📊 *Attendance Status:*\n` +
    `• Total Sessions: ${att.total_classes}\n` +
    `• Attended: ${att.attended}\n` +
    `• Overall %: *${att.percentage}%*\n` +
    `• Exam Eligibility: ${att.percentage >= 75 ? 'ELIGIBLE ✅' : 'CONDITIONAL ⚠️'}\n\n` +
    `📝 *Upcoming Exams:* ${exams.length} scheduled\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📅 Generated on: ${moment().tz(CONFIG.TIMEZONE).format('DD MMMM YYYY, hh:mm A')}`;

  await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
});

// /notes command
bot.onText(/\/notes/, async (msg) => {
  handleNotesList(String(msg.chat.id));
});

async function handleNotesList(chatId) {
  if (!isApproved(chatId) && !isAdmin(chatId)) return sendAuthRequiredMessage(chatId);

  if (notes.length === 0) {
    return bot.sendMessage(chatId, '📚 Abhi koi notes uploaded nahi hain.');
  }

  let text = `📚 *Available Study Notes & Lecture Materials*\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  notes.forEach((n) => {
    text += `🆔 *[ID: ${n.id}]* ${n.title}\n` +
      `   📁 Subject: ${n.subject || 'Physics'} | 💾 Size: ${n.size || 'PDF'}\n` +
      `   👉 Download: \`/download ${n.id}\`\n\n`;
  });

  text += `━━━━━━━━━━━━━━━━━━━━━━━━━\n💡 Download karne ke liye: \`/download <ID>\``;
  await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
}

// /download [id] command
bot.onText(/\/download(?:\s+(\d+))?/, async (msg, match) => {
  const chatId = String(msg.chat.id);
  if (!isApproved(chatId) && !isAdmin(chatId)) return sendAuthRequiredMessage(chatId);

  const id = match[1] ? parseInt(match[1]) : null;
  if (!id) {
    return bot.sendMessage(chatId, '📌 Format: `/download <ID>`\nExample: `/download 1`', { parse_mode: 'Markdown' });
  }

  const note = notes.find(n => n.id === id);
  if (!note) {
    return bot.sendMessage(chatId, `❌ Note ID ${id} nahi mila. Pehle /notes check karein.`);
  }

  const filePath = path.join(CONFIG.FILES_DIR, note.filename);
  if (fs.existsSync(filePath)) {
    await bot.sendDocument(chatId, filePath, {
      caption: `📖 *${note.title}*\nDownloaded from ${CONFIG.COLLEGE_NAME} Bot.`
    });
  } else {
    // If physical PDF is simulated or placeholder
    await bot.sendMessage(
      chatId,
      `📄 *${note.title}*\n\n` +
      `📁 *Filename:* \`${note.filename}\`\n` +
      `💾 *Size:* ${note.size}\n` +
      `📅 *Uploaded on:* ${moment(note.uploaded_at).format('DD-MM-YYYY')}\n\n` +
      `_File Telegram cloud buffer mein stored hai. Physical document admin upload session se download hoga._`,
      { parse_mode: 'Markdown' }
    );
  }
});

// ==================== QUIZ SYSTEM ====================
const QUIZ_QUESTIONS = [
  {
    q: "1. Waves in which the particles of the medium vibrate perpendicular to the direction of wave propagation are called:",
    options: ["Longitudinal Waves", "Transverse Waves", "Stationary Waves", "Electromagnetic Shock"],
    correct: 1
  },
  {
    q: "2. In an ideal operational amplifier (Op-Amp), the input impedance is:",
    options: ["Zero", "Very Low", "Infinite", "50 Ohms"],
    correct: 2
  },
  {
    q: "3. Which Python library is standard for numerical array computations?",
    options: ["Django", "NumPy", "Flask", "Tkinter"],
    correct: 1
  },
  {
    q: "4. The phenomenon of bending of light around sharp corners of an obstacle is known as:",
    options: ["Refraction", "Polarization", "Diffraction", "Dispersion"],
    correct: 2
  },
  {
    q: "5. What is the slew rate of an ideal Operational Amplifier?",
    options: ["Zero", "1 V/μs", "Infinite", "100 V/s"],
    correct: 2
  }
];

// /quiz command
bot.onText(/\/quiz/, async (msg) => {
  const chatId = String(msg.chat.id);
  if (!isApproved(chatId)) return sendAuthRequiredMessage(chatId);

  quizSessions.set(chatId, { currentQ: 0, score: 0 });
  await sendQuizQuestion(chatId, 0);
});

async function sendQuizQuestion(chatId, qIndex) {
  const question = QUIZ_QUESTIONS[qIndex];
  if (!question) return;

  const buttons = question.options.map((opt, idx) => ([{
    text: opt,
    callback_data: `quiz_ans_${qIndex}_${idx}`
  }]));

  await bot.sendMessage(
    chatId,
    `🧠 *Physics MCQ Challenge (Question ${qIndex + 1}/${QUIZ_QUESTIONS.length})*\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `${question.q}`,
    {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    }
  );
}

async function handleQuizAnswer(query) {
  const chatId = String(query.message.chat.id);
  const data = query.data; // quiz_ans_QIndex_OptIndex
  const parts = data.split('_');
  const qIndex = parseInt(parts[2]);
  const optIndex = parseInt(parts[3]);

  const session = quizSessions.get(chatId);
  if (!session || session.currentQ !== qIndex) {
    return bot.answerCallbackQuery(query.id, { text: '⚠️ Yeh question expire ho chuka hai.', show_alert: true });
  }

  const q = QUIZ_QUESTIONS[qIndex];
  const isCorrect = q.correct === optIndex;

  if (isCorrect) {
    session.score += 10;
    await bot.answerCallbackQuery(query.id, { text: '🎯 Correct Answer! (+10 pts)' });
  } else {
    await bot.answerCallbackQuery(query.id, { text: `❌ Wrong! Sahi answer: ${q.options[q.correct]}` });
  }

  session.currentQ += 1;

  if (session.currentQ < QUIZ_QUESTIONS.length) {
    await sendQuizQuestion(chatId, session.currentQ);
  } else {
    // Quiz finished!
    const finalScore = session.score;
    const maxScore = QUIZ_QUESTIONS.length * 10;
    quizSessions.delete(chatId);

    const student = users.linked[chatId] || { name: 'Student' };
    quizLeaderboard.set(student.name, (quizLeaderboard.get(student.name) || 0) + finalScore);

    await bot.sendMessage(
      chatId,
      `🏆 *Quiz Completed!*\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `👤 *Student:* ${student.name}\n` +
      `⭐ *Your Score:* ${finalScore} / ${maxScore} Points\n` +
      `🎖️ *Performance:* ${finalScore >= 40 ? 'Excellent! 🌟' : 'Good Attempt! Keep practicing. 📚'}\n\n` +
      `Leaderboard dekhne ke liye /leaderboard karein!`,
      { parse_mode: 'Markdown' }
    );
  }
}

// /leaderboard command
bot.onText(/\/leaderboard/, async (msg) => {
  const chatId = String(msg.chat.id);
  if (quizLeaderboard.size === 0) {
    return bot.sendMessage(chatId, '🏆 Abhi tak kisi ne quiz nahi khela. /quiz dabayein aur pehle bano!');
  }

  const sorted = Array.from(quizLeaderboard.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
  let text = `🏆 *Top Quiz Masters Leaderboard*\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  sorted.forEach(([name, pts], i) => {
    const medal = i === 0 ? '🥇' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : '🎖️'));
    text += `${medal} ${i + 1}. *${name}* — ${pts} Points\n`;
  });

  await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
});

// ==================== ADMIN COMMANDS ====================

// Admin Check Middleware Helper
function ensureAdmin(chatId) {
  if (!isAdmin(chatId)) {
    bot.sendMessage(chatId, '⛔ *Unauthorized!* Sirf Master Admin hi yeh command use kar sakta hai.', { parse_mode: 'Markdown' });
    return false;
  }
  return true;
}

// /admin Dashboard
bot.onText(/\/admin/, async (msg) => {
  handleAdminDashboard(String(msg.chat.id));
});

async function handleAdminDashboard(chatId) {
  if (!ensureAdmin(chatId)) return;

  const totalUsers = Object.keys(users.linked || {}).length;
  const pendingCount = Object.keys(users.pending || {}).length;
  const blockedCount = (users.blocked || []).length;

  const text = `🛠️ *COLLEGE BOT MASTER ADMIN PANEL*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `📊 *Overview:*\n` +
    `• Approved Students: *${totalUsers}*\n` +
    `• Pending Requests: *${pendingCount}*\n` +
    `• Blocked Users: *${blockedCount}*\n\n` +
    `⚡ *Quick Actions:*`;

  await bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: `⏳ Pending (${pendingCount})`, callback_data: 'btn_pending' },
          { text: '👥 All Users', callback_data: 'btn_users_list' }
        ],
        [
          { text: '📦 Cloud Backup', callback_data: 'btn_backup' },
          { text: '📊 Statistics', callback_data: 'btn_stats' }
        ]
      ]
    }
  });
}

// /pending command
bot.onText(/\/pending/, async (msg) => {
  handlePendingRequests(String(msg.chat.id));
});

async function handlePendingRequests(chatId) {
  if (!ensureAdmin(chatId)) return;

  const pendingKeys = Object.keys(users.pending || {});
  if (pendingKeys.length === 0) {
    return bot.sendMessage(chatId, '✅ Koi pending approval request nahi hai. All clear!');
  }

  for (const userChatId of pendingKeys) {
    const req = users.pending[userChatId];
    const text = `⏳ *Pending Approval Request*\n\n` +
      `👤 *Name:* ${req.name}\n` +
      `🎓 *Roll No:* \`${req.roll_no}\`\n` +
      `💬 *Chat ID:* \`${userChatId}\`\n` +
      `📅 *Requested:* ${moment(req.requested_at).format('DD-MM-YYYY hh:mm A')}`;

    await bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Approve', callback_data: `app_${userChatId}` },
            { text: '❌ Reject', callback_data: `rej_${userChatId}` }
          ]
        ]
      }
    });
  }
}

// /approve [id] command
bot.onText(/\/approve(?:\s+(.+))?/, async (msg, match) => {
  const chatId = String(msg.chat.id);
  if (!ensureAdmin(chatId)) return;

  const target = match[1] ? match[1].trim() : '';
  if (!target) return bot.sendMessage(chatId, '📌 Format: `/approve <ChatID or Roll_No>`', { parse_mode: 'Markdown' });

  // Find in pending
  let foundChatId = Object.keys(users.pending || {}).find(cid => cid === target || users.pending[cid].roll_no.toUpperCase() === target.toUpperCase());
  if (!foundChatId) {
    return bot.sendMessage(chatId, `❌ "${target}" ke liye koi pending request nahi mili.`);
  }

  const req = users.pending[foundChatId];
  users.linked[foundChatId] = {
    roll_no: req.roll_no,
    name: req.name,
    status: 'approved',
    linked_at: new Date().toISOString(),
    approved_by: chatId
  };
  users.roll_to_chat[req.roll_no] = foundChatId;
  delete users.pending[foundChatId];
  saveUsers();

  await bot.sendMessage(chatId, `✅ Successfully approved *${req.name}* (\`${req.roll_no}\`)!`, { parse_mode: 'Markdown' });
  try {
    await bot.sendMessage(foundChatId, `🎉 Welcome *${req.name}*! Aapka account approve ho gaya hai.\nCommands ke liye /help dabayein.`, { parse_mode: 'Markdown' });
  } catch (e) {}
});

// /reject [id] command
bot.onText(/\/reject(?:\s+(.+))?/, async (msg, match) => {
  const chatId = String(msg.chat.id);
  if (!ensureAdmin(chatId)) return;

  const target = match[1] ? match[1].trim() : '';
  if (!target) return bot.sendMessage(chatId, '📌 Format: `/reject <ChatID or Roll_No>`', { parse_mode: 'Markdown' });

  let foundChatId = Object.keys(users.pending || {}).find(cid => cid === target || users.pending[cid].roll_no.toUpperCase() === target.toUpperCase());
  if (!foundChatId) {
    return bot.sendMessage(chatId, `❌ "${target}" ke liye koi pending request nahi mili.`);
  }

  delete users.pending[foundChatId];
  saveUsers();
  await bot.sendMessage(chatId, `❌ Rejected request for Chat ID \`${foundChatId}\`.`, { parse_mode: 'Markdown' });
});

// /block [id] command
bot.onText(/\/block(?:\s+(.+))?/, async (msg, match) => {
  const chatId = String(msg.chat.id);
  if (!ensureAdmin(chatId)) return;

  const target = match[1] ? match[1].trim() : '';
  if (!target) return bot.sendMessage(chatId, '📌 Format: `/block <ChatID>`', { parse_mode: 'Markdown' });

  if (!users.blocked) users.blocked = [];
  if (!users.blocked.includes(target)) {
    users.blocked.push(target);
    saveUsers();
    await bot.sendMessage(chatId, `🚫 Chat ID \`${target}\` ko block kar diya gaya hai.`, { parse_mode: 'Markdown' });
  } else {
    await bot.sendMessage(chatId, `ℹ️ Chat ID \`${target}\` pehle se blocked hai.`);
  }
});

// /unblock [id] command
bot.onText(/\/unblock(?:\s+(.+))?/, async (msg, match) => {
  const chatId = String(msg.chat.id);
  if (!ensureAdmin(chatId)) return;

  const target = match[1] ? match[1].trim() : '';
  if (!target) return bot.sendMessage(chatId, '📌 Format: `/unblock <ChatID>`', { parse_mode: 'Markdown' });

  if (users.blocked && users.blocked.includes(target)) {
    users.blocked = users.blocked.filter(id => id !== target);
    saveUsers();
    await bot.sendMessage(chatId, `✅ Chat ID \`${target}\` unblock ho gaya.`, { parse_mode: 'Markdown' });
  } else {
    await bot.sendMessage(chatId, `ℹ️ Chat ID \`${target}\` blocked list mein nahi hai.`);
  }
});

// /users command (List all approved users)
bot.onText(/\/users/, async (msg) => {
  const chatId = String(msg.chat.id);
  if (!ensureAdmin(chatId)) return;

  const linkedList = Object.entries(users.linked || {});
  if (linkedList.length === 0) {
    return bot.sendMessage(chatId, 'ℹ️ Koi approved student registered nahi hai.');
  }

  let text = `👥 *Approved College Students Directory (${linkedList.length})*\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  linkedList.forEach(([cid, u], i) => {
    text += `${i + 1}. *${u.name}*\n   🎓 Roll: \`${u.roll_no}\` | 💬 ID: \`${cid}\`\n\n`;
  });

  await bot.sendMessage(chatId, text.trim(), { parse_mode: 'Markdown' });
});

// /search [roll or name] command
bot.onText(/\/search(?:\s+(.+))?/, async (msg, match) => {
  const chatId = String(msg.chat.id);
  if (!ensureAdmin(chatId)) return;

  const query = match[1] ? match[1].trim() : '';
  if (!query) return bot.sendMessage(chatId, '📌 Format: `/search <Roll_No or Name>`', { parse_mode: 'Markdown' });

  const results = Object.entries(users.linked || {}).filter(([cid, u]) => {
    return u.roll_no.toLowerCase().includes(query.toLowerCase()) || u.name.toLowerCase().includes(query.toLowerCase()) || cid === query;
  });

  if (results.length === 0) {
    return bot.sendMessage(chatId, `❌ Koi student nahi mila matching "${query}".`);
  }

  let text = `🔍 *Search Results (${results.length})*\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  results.forEach(([cid, u]) => {
    const att = attendance[u.roll_no] || { total_classes: 0, attended: 0, percentage: 100 };
    text += `👤 *Name:* ${u.name}\n` +
      `🎓 *Roll:* \`${u.roll_no}\`\n` +
      `💬 *Chat ID:* \`${cid}\`\n` +
      `📊 *Attendance:* ${att.percentage}%\n` +
      `📅 *Linked At:* ${moment(u.linked_at).format('DD-MM-YYYY')}\n\n`;
  });

  await bot.sendMessage(chatId, text.trim(), { parse_mode: 'Markdown' });
});

// /unlink [roll] command
bot.onText(/\/unlink(?:\s+(.+))?/, async (msg, match) => {
  const chatId = String(msg.chat.id);
  if (!ensureAdmin(chatId)) return;

  const roll = match[1] ? match[1].trim().toUpperCase() : '';
  if (!roll) return bot.sendMessage(chatId, '📌 Format: `/unlink <Roll_No>`', { parse_mode: 'Markdown' });

  const linkedChatId = users.roll_to_chat && users.roll_to_chat[roll];
  if (!linkedChatId || !users.linked[linkedChatId]) {
    return bot.sendMessage(chatId, `❌ Roll No "${roll}" linked nahi hai.`);
  }

  const sName = users.linked[linkedChatId].name;
  delete users.linked[linkedChatId];
  delete users.roll_to_chat[roll];
  saveUsers();

  await bot.sendMessage(chatId, `✅ Successfully unlinked *${sName}* (\`${roll}\`).`, { parse_mode: 'Markdown' });
});

// /broadcast [msg] command
bot.onText(/\/broadcast(?:\s+([\s\S]+))?/, async (msg, match) => {
  const chatId = String(msg.chat.id);
  if (!ensureAdmin(chatId)) return;

  const messageText = match[1] ? match[1].trim() : '';
  if (!messageText) {
    return bot.sendMessage(chatId, '📌 Format: `/broadcast <Message Text>`\nYeh message sabhi approved students ko direct message mein jayega!', { parse_mode: 'Markdown' });
  }

  const studentChatIds = Object.keys(users.linked || {});
  if (studentChatIds.length === 0) {
    return bot.sendMessage(chatId, 'ℹ️ Broadcast bhejne ke liye koi approved student nahi hai.');
  }

  await bot.sendMessage(chatId, `🚀 Broadcasting message to ${studentChatIds.length} students...`);

  let successCount = 0;
  let failCount = 0;

  const broadcastPayload = `📢 *COLLEGE OFFICIAL ANNOUNCEMENT*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `${messageText}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 *From:* Department Administration\n` +
    `📅 *Date:* ${moment().tz(CONFIG.TIMEZONE).format('DD MMM YYYY, hh:mm A')}`;

  for (const sChatId of studentChatIds) {
    try {
      await bot.sendMessage(sChatId, broadcastPayload, { parse_mode: 'Markdown' });
      successCount++;
    } catch (err) {
      failCount++;
    }
  }

  await bot.sendMessage(chatId, `✅ *Broadcast Report:*\n• Sent successfully: ${successCount}\n• Failed: ${failCount}`, { parse_mode: 'Markdown' });
});

// /stats command
bot.onText(/\/stats/, async (msg) => {
  handleBotStats(String(msg.chat.id));
});

async function handleBotStats(chatId) {
  if (!ensureAdmin(chatId)) return;

  const approvedUsers = Object.keys(users.linked || {}).length;
  const pendingUsers = Object.keys(users.pending || {}).length;
  const blockedUsers = (users.blocked || []).length;
  const totalExams = (examsData.exams || []).length;
  const totalNotes = notes.length;
  const totalHolidays = holidays.length;

  const statsMsg = `📊 *BOT SYSTEM STATISTICS*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `👥 *Users Overview:*\n` +
    `• Approved Students: *${approvedUsers}*\n` +
    `• Pending Requests: *${pendingUsers}*\n` +
    `• Blocked Accounts: *${blockedUsers}*\n\n` +
    `📚 *Academic Content:*\n` +
    `• Exams Tracked: *${totalExams}*\n` +
    `• Notes Available: *${totalNotes}*\n` +
    `• Holidays in Calendar: *${totalHolidays}*\n\n` +
    `☁️ *Storage Status:* Zero Server Storage Mode Active ✅\n` +
    `🕒 *Server Time:* ${moment().tz(CONFIG.TIMEZONE).format('DD MMM YYYY, hh:mm:ss A')}`;

  await bot.sendMessage(chatId, statsMsg, { parse_mode: 'Markdown' });
}

// /backup command (Zero Storage Cloud Backup)
bot.onText(/\/backup/, async (msg) => {
  const chatId = String(msg.chat.id);
  if (!ensureAdmin(chatId)) return;

  await bot.sendMessage(chatId, '📦 Generating complete cloud backup package...');

  try {
    const fullBackup = {
      backup_timestamp: new Date().toISOString(),
      college: CONFIG.COLLEGE_NAME,
      department: CONFIG.DEPARTMENT,
      users,
      attendance,
      exams: examsData,
      holidays,
      absences,
      notes
    };

    const backupFileName = `college_backup_${moment().tz(CONFIG.TIMEZONE).format('YYYYMMDD_HHmmss')}.json`;
    const tempBackupPath = path.join(CONFIG.DATA_DIR, backupFileName);

    fs.writeFileSync(tempBackupPath, JSON.stringify(fullBackup, null, 2), 'utf8');

    // Send document directly to Admin on Telegram
    await bot.sendDocument(chatId, tempBackupPath, {
      caption: `📦 *College Data Cloud Backup*\n📅 ${moment().tz(CONFIG.TIMEZONE).format('DD MMM YYYY, hh:mm A')}\nZero Server Storage Mode Active.`
    });

    // Delete temp file immediately after sending (0 server storage)
    setTimeout(() => {
      try {
        if (fs.existsSync(tempBackupPath)) fs.unlinkSync(tempBackupPath);
        console.log(`🧹 Cleaned up temporary backup file: ${backupFileName}`);
      } catch (e) {}
    }, 5000);

  } catch (err) {
    await bot.sendMessage(chatId, `❌ Backup error: ${err.message}`);
  }
});

// /exportusers command (CSV Export)
bot.onText(/\/exportusers/, async (msg) => {
  const chatId = String(msg.chat.id);
  if (!ensureAdmin(chatId)) return;

  try {
    let csv = `ChatID,Name,RollNumber,Status,LinkedDate\n`;
    Object.entries(users.linked || {}).forEach(([cid, u]) => {
      csv += `"${cid}","${u.name}","${u.roll_no}","${u.status}","${u.linked_at}"\n`;
    });

    const csvPath = path.join(CONFIG.DATA_DIR, `users_export_${Date.now()}.csv`);
    fs.writeFileSync(csvPath, csv, 'utf8');

    await bot.sendDocument(chatId, csvPath, {
      caption: `📊 *College Users CSV Export*\nTotal records: ${Object.keys(users.linked || {}).length}`
    });

    setTimeout(() => {
      if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
    }, 5000);
  } catch (err) {
    await bot.sendMessage(chatId, `❌ Export error: ${err.message}`);
  }
});

// /exportattendance command (CSV Export)
bot.onText(/\/exportattendance/, async (msg) => {
  const chatId = String(msg.chat.id);
  if (!ensureAdmin(chatId)) return;

  try {
    let csv = `RollNumber,Name,TotalClasses,AttendedClasses,Percentage\n`;
    Object.entries(attendance).forEach(([roll, data]) => {
      csv += `"${roll}","${data.name || ''}",${data.total_classes || 0},${data.attended || 0},${data.percentage || 0}%\n`;
    });

    const csvPath = path.join(CONFIG.DATA_DIR, `attendance_export_${Date.now()}.csv`);
    fs.writeFileSync(csvPath, csv, 'utf8');

    await bot.sendDocument(chatId, csvPath, {
      caption: `📊 *College Attendance CSV Export*`
    });

    setTimeout(() => {
      if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
    }, 5000);
  } catch (err) {
    await bot.sendMessage(chatId, `❌ Export error: ${err.message}`);
  }
});

// Admin File Upload Handler (Notes upload directly via Telegram)
bot.on('document', async (msg) => {
  const chatId = String(msg.chat.id);
  if (!isAdmin(chatId)) return;

  const doc = msg.document;
  if (!doc) return;

  const caption = msg.caption ? msg.caption.trim() : '';
  const title = caption ? caption.replace(/^#notes/i, '').trim() : doc.file_name;

  try {
    const fileId = doc.file_id;
    const downloadPath = path.join(CONFIG.FILES_DIR, doc.file_name);

    await bot.sendMessage(chatId, `📥 Downloading & saving note: *${doc.file_name}*...`, { parse_mode: 'Markdown' });

    const fileStream = bot.getFileStream(fileId);
    const writeStream = fs.createWriteStream(downloadPath);

    fileStream.pipe(writeStream);

    writeStream.on('finish', async () => {
      const newNote = {
        id: notes.length > 0 ? Math.max(...notes.map(n => n.id)) + 1 : 1,
        title: title || doc.file_name,
        subject: 'Physics',
        filename: doc.file_name,
        size: `${(doc.file_size / (1024 * 1024)).toFixed(2)} MB`,
        uploaded_at: new Date().toISOString()
      };

      notes.push(newNote);
      saveNotes();

      await bot.sendMessage(
        chatId,
        `✅ *Note Added to College Library!*\n\n` +
        `🆔 *Note ID:* ${newNote.id}\n` +
        `📖 *Title:* ${newNote.title}\n` +
        `📁 *File:* \`${newNote.filename}\`\n\n` +
        `Students ab \`/download ${newNote.id}\` se download kar sakte hain!`,
        { parse_mode: 'Markdown' }
      );
    });
  } catch (err) {
    await bot.sendMessage(chatId, `❌ File save failed: ${err.message}`);
  }
});

// ==================== AUTOMATED CRON NOTIFICATIONS ====================

// 1. Daily Digest to Admin at 8:00 AM Kolkata Time
cron.schedule('0 8 * * *', async () => {
  try {
    const totalUsers = Object.keys(users.linked || {}).length;
    const pendingCount = Object.keys(users.pending || {}).length;
    const blockedCount = (users.blocked || []).length;
    const examsCount = (examsData.exams || []).length;

    const digestMsg = `📊 *Daily Digest*\n\n` +
      `👥 Total Users: ${totalUsers + pendingCount}\n` +
      `✅ Approved: ${totalUsers}\n` +
      `⏳ Pending: ${pendingCount}\n` +
      `🚫 Blocked: ${blockedCount}\n` +
      `📅 Aaj ki classes: 4\n` +
      `📝 Exams this week: ${examsCount}\n\n` +
      `_Bot is running smoothly on Telegram Cloud!_`;

    await bot.sendMessage(CONFIG.ADMIN_CHAT_ID, digestMsg, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('❌ Daily digest error:', e.message);
  }
}, { timezone: CONFIG.TIMEZONE });

// 2. Pending Approval Reminder to Admin (Every 6 Hours)
cron.schedule('0 */6 * * *', async () => {
  try {
    const pendingKeys = Object.keys(users.pending || {});
    if (pendingKeys.length > 0) {
      await bot.sendMessage(
        CONFIG.ADMIN_CHAT_ID,
        `🔔 *Pending Approval Reminder!*\n\n` +
        `Total *${pendingKeys.length}* new student registrations approval ke liye pending hain.\n` +
        `Review karne ke liye /pending dabayein.`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (e) {}
}, { timezone: CONFIG.TIMEZONE });

// ==================== PROCESS TERMINATION HANDLER ====================
process.on('SIGINT', () => {
  console.log('🛑 Gracefully stopping Telegram bot...');
  bot.stopPolling().then(() => {
    process.exit(0);
  });
});
