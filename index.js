/**
 * ============================================================================
 * 🤖 COLLEGE WHATSAPP BOT - PRODUCTION SUITE (MAIN SERVER)
 * ============================================================================
 * Features:
 * 1. !showtomorrow with Holiday & Teacher Absence check
 * 2. !broadcast System (DM Reply -> Auto Forward to Group with Header)
 * 3. Open-Meteo Weather API integration with Good Morning message (No Storage)
 * 4. Nager.Date India Public Holiday API (24h In-Memory Cache, No Storage)
 *    Commands: !publicholidays, !nextholiday
 * 5. Telegram Cloud Backup System (Zero Server Storage: Temp -> Telegram -> Delete)
 * 6. Rate Limiting (30s cooldown for spam protection)
 * 7. Master Admin check for sensitive config (!setgroup, !setadmin)
 * 8. Config persistence across reboots via runtimeConfig.json
 * 9. Unified handleCommonCommands() to eliminate code duplication
 * ============================================================================
 */

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  Browsers,
  downloadMediaMessage
} from '@whiskeysockets/baileys';
import cron from 'node-cron';
import moment from 'moment-timezone';
import fs from 'fs';
import path from 'path';
import qrcode from 'qrcode-terminal';
import axios from 'axios';
import TelegramBot from 'node-telegram-bot-api';
import { fileURLToPath } from 'url';

import CONFIG from './config.js';
import DEFAULT_SCHEDULE from './schedule.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==================== DIRECTORY INITIALIZATION ====================
// Static data folder aur temporary folder setup
if (!fs.existsSync(CONFIG.DATA_DIR)) {
  fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true });
}
if (!fs.existsSync(CONFIG.TEMP_DIR)) {
  fs.mkdirSync(CONFIG.TEMP_DIR, { recursive: true });
}

const RUNTIME_CONFIG_FILE = path.join(CONFIG.DATA_DIR, 'runtimeConfig.json');
const REMINDERS_FILE = path.join(CONFIG.DATA_DIR, 'sentReminders.json');
const EXAMS_FILE = path.join(CONFIG.DATA_DIR, 'exams.json');
const SCHEDULE_FILE = path.join(CONFIG.DATA_DIR, 'schedule.json');
const HOLIDAYS_FILE = path.join(CONFIG.DATA_DIR, 'holidays.json');
const ABSENCES_FILE = path.join(CONFIG.DATA_DIR, 'absences.json');
const STARTED_FILE = path.join(CONFIG.DATA_DIR, 'startedClasses.json');
const POLL_FILE = path.join(CONFIG.DATA_DIR, 'pollMessage.json');

// ==================== LOAD RUNTIME CONFIG ====================
// Agar pehle se admin ya group change kiya tha to load kar lo
let runtimeConfig = {};
try {
  if (fs.existsSync(RUNTIME_CONFIG_FILE)) {
    runtimeConfig = JSON.parse(fs.readFileSync(RUNTIME_CONFIG_FILE, 'utf8'));
    console.log('⚙️ Runtime config loaded successfully:', runtimeConfig);
  }
} catch (e) {
  console.error('⚠️ Could not load runtimeConfig.json:', e.message);
}

let currentConfig = {
  ...CONFIG,
  ADMIN_NUMBER: runtimeConfig.ADMIN_NUMBER || CONFIG.MASTER_ADMIN_NUMBER,
  GROUP_ID: runtimeConfig.GROUP_ID || CONFIG.GROUP_ID
};

function saveRuntimeConfig() {
  const data = {
    ADMIN_NUMBER: currentConfig.ADMIN_NUMBER,
    GROUP_ID: currentConfig.GROUP_ID,
    updatedAt: new Date().toISOString()
  };
  try {
    fs.writeFileSync(RUNTIME_CONFIG_FILE, JSON.stringify(data, null, 2));
    sendToTelegram('runtimeConfig', data);
  } catch (e) {
    console.error('❌ Failed to save runtime config:', e.message);
  }
}

// ==================== TELEGRAM BACKUP SYSTEM ====================
// Server par storage 0 rakhne ke liye temp file banao, Telegram bhejo, aur delete karo
let tgBot = null;
if (CONFIG.TELEGRAM_BOT_TOKEN && CONFIG.TELEGRAM_BOT_TOKEN !== 'YOUR_BOT_TOKEN_HERE') {
  try {
    tgBot = new TelegramBot(CONFIG.TELEGRAM_BOT_TOKEN, { polling: false });
    console.log('🤖 Telegram backup bot initialized!');
  } catch (err) {
    console.error('❌ Telegram Bot Init Error:', err.message);
  }
} else {
  console.log('ℹ️ Telegram token not configured yet. Fallback to local files enabled.');
}

function ensureTempDir() {
  if (!fs.existsSync(CONFIG.TEMP_DIR)) {
    fs.mkdirSync(CONFIG.TEMP_DIR, { recursive: true });
  }
}

/**
 * Saara data Telegram pe bhejta hai aur 5 second baad temp file delete karta hai
 */
async function sendToTelegram(filename, data) {
  ensureTempDir();
  const timestamp = Date.now();
  const tempFileName = `${filename}_${timestamp}.json`;
  const tempFilePath = path.join(CONFIG.TEMP_DIR, tempFileName);

  try {
    // 1. Temp file banao
    fs.writeFileSync(tempFilePath, JSON.stringify(data, null, 2), 'utf8');

    // 2. Agar Telegram configured hai to send karo
    if (tgBot && CONFIG.ADMIN_CHAT_ID && CONFIG.ADMIN_CHAT_ID !== 'YOUR_CHAT_ID_HERE') {
      const readableTime = moment().tz(currentConfig.TIMEZONE).format('DD-MM-YYYY hh:mm A');
      await tgBot.sendDocument(CONFIG.ADMIN_CHAT_ID, tempFilePath, {
        caption: `📦 *College Bot Cloud Backup*\n📄 *File:* \`${filename}.json\`\n🕒 *Timestamp:* ${readableTime}\n🤖 *Status:* Securely Saved`
      }, {
        filename: tempFileName,
        contentType: 'application/json'
      });

      // 3. 5 second wait karo then delete karo
      setTimeout(() => {
        try {
          if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
            console.log(`✅ ${filename} → Telegram → Deleted`);
          }
        } catch (delErr) {
          console.error(`⚠️ Failed to delete temp file ${tempFileName}:`, delErr.message);
        }
      }, 5000);

    } else {
      // Telegram nahi hai to fallback local save (safety net)
      const fallbackPath = path.join(CONFIG.DATA_DIR, `${filename}.json`);
      fs.writeFileSync(fallbackPath, JSON.stringify(data, null, 2), 'utf8');
      console.log(`💾 Telegram unavailable: saved backup to ${fallbackPath}`);

      // Temp file cleanup
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    }
  } catch (err) {
    console.error(`❌ Telegram backup error for ${filename}:`, err.message);
    // Safety fallback: save in data/
    try {
      const fallbackPath = path.join(CONFIG.DATA_DIR, `${filename}.json`);
      fs.writeFileSync(fallbackPath, JSON.stringify(data, null, 2), 'utf8');
      console.log(`💾 Local fallback saved for ${filename}`);
    } catch (e) {}

    // Cleanup temp
    if (fs.existsSync(tempFilePath)) {
      try { fs.unlinkSync(tempFilePath); } catch (e) {}
    }
  }
}

// ==================== LOAD / SAVE HELPERS ====================
function loadJson(file, defaultVal = []) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (e) {
    console.error(`Error loading ${file}:`, e.message);
  }
  return defaultVal;
}

function saveJson(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(`Error saving ${file}:`, e.message);
  }
}

// ==================== SCHEDULE STATE ====================
let CLASS_SCHEDULE = {};
function loadSchedule() {
  try {
    if (fs.existsSync(SCHEDULE_FILE)) {
      CLASS_SCHEDULE = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8'));
      return;
    }
  } catch (e) {}
  CLASS_SCHEDULE = JSON.parse(JSON.stringify(DEFAULT_SCHEDULE));
  saveSchedule();
}

function saveSchedule() {
  saveJson(SCHEDULE_FILE, CLASS_SCHEDULE);
  sendToTelegram('schedule', CLASS_SCHEDULE);
}

loadSchedule();

// ==================== STATE VARIABLES ====================
let sentReminders = loadJson(REMINDERS_FILE, []);
let exams = loadJson(EXAMS_FILE, []);
let examMode = { active: false, data: {} };
let sock = null;
let holidays = loadJson(HOLIDAYS_FILE, []);
let absences = loadJson(ABSENCES_FILE, []);
let startedClasses = loadJson(STARTED_FILE, []);
let lastPollMessage = loadJson(POLL_FILE, null);
let isShuttingDown = false;
let cronStarted = false;
let hasSentOnlineMessage = false;
let pollVoteTracker = { key: null, voters: new Set() };

// Rate Limiter map: sender -> timestamp
const userCooldowns = new Map();

// Savers with Telegram backup trigger
const saveReminders = () => { saveJson(REMINDERS_FILE, sentReminders); };
const saveExams = () => { saveJson(EXAMS_FILE, exams); sendToTelegram('exams', exams); };
const saveHolidays = () => { saveJson(HOLIDAYS_FILE, holidays); sendToTelegram('holidays', holidays); };
const saveAbsences = () => { saveJson(ABSENCES_FILE, absences); sendToTelegram('absences', absences); };
const saveStarted = () => { saveJson(STARTED_FILE, startedClasses); };
const savePollMsg = () => { saveJson(POLL_FILE, lastPollMessage); };

// ==================== SYLLABUS DATA ====================
const SYLLABUS_IMAGES = {
  major3: './data/syllabus/major3_theory.jpg',
  major3lab: './data/syllabus/major3_lab.jpg',
  major4: './data/syllabus/major4_theory.jpg',
  major4lab: './data/syllabus/major4_lab.jpg',
};

const SYLLABUS_TITLES = {
  major3: '📘 Major 3: Waves & Optics (Theory)',
  major3lab: '🔬 Major 3 Lab: Waves & Optics (Practical)',
  major4: '📗 Major 4: Analog Electronics (Theory)',
  major4lab: '🔧 Major 4 Lab: Analog Electronics (Practical)',
  sec3: '💻 SEC 3: Computational Physics (Python)',
};

// ==================== DAILY GREETING MESSAGES ====================
const GOOD_MORNING_MESSAGES = [
  "☀️ *Good Morning everyone!*\n\nIt's Sunday! Take it easy, relax, and enjoy your well-deserved day off! 🌴",
  "☀️ *Good Morning everyone!*\n\nHappy Monday! A brand new week full of opportunities awaits. Have a wonderful day ahead! 🌟",
  "☀️ *Good Morning everyone!*\n\nIt's Tuesday! Stay focused and make today count. Have a productive day! 💪",
  "☀️ *Good Morning everyone!*\n\nMid-week Wednesday is here! Keep pushing forward, you're doing great! 🎯",
  "☀️ *Good Morning everyone!*\n\nHappy Thursday! One more day closer to the weekend. Make it amazing! ✨",
  "☀️ *Good Morning everyone!*\n\nIt's Friday! Finish the week strong and have a fantastic day! 🎉",
  "☀️ *Good Morning everyone!*\n\nHappy Saturday! Enjoy your weekend classes and have a great day! 🌈"
];

const GOOD_NIGHT_MESSAGES = [
  "🌙 *Good Night everyone!*\n\nSunday evening rest before the new week begins. Sleep well! 🛌",
  "🌙 *Good Night everyone!*\n\nMonday is done! Sleep well and recharge for tomorrow. Sweet dreams! 😴",
  "🌙 *Good Night everyone!*\n\nTuesday complete! Rest easy and prepare for another day of learning. Good night! 💤",
  "🌙 *Good Night everyone!*\n\nMid-week done! May you have peaceful dreams and wake up refreshed. 😊",
  "🌙 *Good Night everyone!*\n\nThursday is over! Tomorrow is another chance to learn something new. Sleep tight! 🌟",
  "🌙 *Good Night everyone!*\n\nWeekend is here! Enjoy your Friday night and have a great weekend! 🎊",
  "🌙 *Good Night everyone!*\n\nSaturday evening! Enjoy your weekend rest. Good night and sweet dreams! 🌌"
];

const COLLEGE_OVER_MESSAGES = [
  "🏫 *College is over for today!*\n\nIt's Sunday! No classes today. Enjoy your day off, spend time with family, and prepare for the exciting week ahead! 🌴",
  "🏫 *College is over for today!*\n\nHope you had a productive start to the week. Head home safely, revise what you learned, and get plenty of rest. Tomorrow brings new opportunities! 🏠📚",
  "🏫 *College is over for today!*\n\nAnother day of learning complete! Great job today. Now it's time to relax, recharge, and prepare for tomorrow. See you with fresh energy! 💪",
  "🏫 *College is over for today!*\n\nMid-week Wednesday done! You're halfway through the week. Enjoy your evening, go through your notes, and have a safe journey home! 🎯",
  "🏫 *College is over for today!*\n\nAlmost there! Thursday is complete. Use this evening to revise or just unwind with friends. Friday is just around the corner! ✨",
  "🏫 *College is over for today!*\n\nWeekend is here! College is officially over for the week at 4:30 PM. Enjoy your well-deserved break, have fun, and stay safe! 🎉",
  "🏫 *College is over for today!*\n\nSaturday session complete! Hope you had a good day. Enjoy the rest of your weekend and make the most of it! 🌈"
];

// ==================== WEATHER API (FEATURE 3) ====================
/**
 * Open-Meteo se fresh weather fetch karta hai (Zero storage, 5s timeout)
 */
function getWeatherCodeText(code) {
  if (code === 0) return 'Clear sky ☀️';
  if ([1, 2, 3].includes(code)) return 'Partly cloudy 🌤️';
  if ([45, 48].includes(code)) return 'Foggy 🌫️';
  if ([51, 53, 55].includes(code)) return 'Drizzle 🌦️';
  if ([61, 63, 65].includes(code)) return 'Rainy 🌧️';
  if ([71, 73, 75].includes(code)) return 'Snowy ❄️';
  if ([80, 81, 82].includes(code)) return 'Heavy rain ⛈️';
  if ([95, 96, 99].includes(code)) return 'Thunderstorm ⚡';
  return 'Clear sky ☀️';
}

async function fetchWeatherForecast() {
  const { latitude, longitude, name } = CONFIG.WEATHER_LOCATION;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia/Kolkata`;

  try {
    const res = await axios.get(url, { timeout: 5000 });
    const data = res.data;

    const current = data.current || {};
    const daily = data.daily || {};

    const minTemp = daily.temperature_2m_min?.[0] != null ? Math.round(daily.temperature_2m_min[0]) : Math.round(current.temperature_2m || 24);
    const maxTemp = daily.temperature_2m_max?.[0] != null ? Math.round(daily.temperature_2m_max[0]) : Math.round(current.temperature_2m || 31);
    const humidity = current.relative_humidity_2m != null ? current.relative_humidity_2m : 65;
    const rainProb = daily.precipitation_probability_max?.[0] != null ? daily.precipitation_probability_max[0] : 0;
    const sky = getWeatherCodeText(current.weather_code);

    return `\n\n🌤️ *Aaj ka Mausam:*\n📍 ${name}\n🌡️ Temp: ${minTemp}°C - ${maxTemp}°C\n💧 Humidity: ${humidity}%\n☔ Rain: ${rainProb}%\n🌥️ Sky: ${sky}`;
  } catch (err) {
    console.warn('⚠️ Weather API call skipped/failed:', err.message);
    return null; // Silent fallback: skip weather section if failed
  }
}

// ==================== HOLIDAY API (FEATURE 4) ====================
// In-Memory cache for 24 hours (No disk storage)
let holidayMemoryCache = {
  year: null,
  data: [],
  timestamp: 0
};

async function getPublicHolidays(year = moment().tz(CONFIG.TIMEZONE).year()) {
  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;

  if (holidayMemoryCache.year === year && (now - holidayMemoryCache.timestamp) < ONE_DAY && holidayMemoryCache.data.length > 0) {
    return holidayMemoryCache.data;
  }

  try {
    const url = `https://date.nager.at/api/v3/PublicHolidays/${year}/IN`;
    const res = await axios.get(url, { timeout: 5000 });
    if (Array.isArray(res.data)) {
      holidayMemoryCache = {
        year,
        data: res.data,
        timestamp: now
      };
      console.log(`🎉 Fetched ${res.data.length} public holidays from Nager.Date API for ${year}`);
      return res.data;
    }
  } catch (err) {
    console.warn(`⚠️ Public Holidays API failed for ${year}:`, err.message);
  }

  return holidayMemoryCache.data || [];
}

/**
 * Manual (holidays.json) + API holidays dono check karta hai
 * format input: DD-MM-YYYY
 */
async function checkIsHoliday(dateStrDDMMYYYY) {
  // 1. Check manual holidays array
  if (holidays.includes(dateStrDDMMYYYY)) {
    return { isHoliday: true, name: 'College Holiday', isManual: true };
  }

  // 2. Check API holidays
  try {
    const targetMoment = moment(dateStrDDMMYYYY, 'DD-MM-YYYY');
    const year = targetMoment.year();
    const apiHolidays = await getPublicHolidays(year);
    const targetIso = targetMoment.format('YYYY-MM-DD');

    const match = apiHolidays.find(h => h.date === targetIso);
    if (match) {
      return { isHoliday: true, name: match.name || match.localName, isManual: false };
    }
  } catch (e) {
    console.error('Error checking holiday API:', e.message);
  }

  return { isHoliday: false, name: null };
}

// ==================== ADMIN CHECKS ====================
function cleanNumber(num) {
  return (num || '').replace(/\D/g, '');
}

function isAdminUser(senderJid) {
  const adminNum = cleanNumber(currentConfig.ADMIN_NUMBER);
  let senderNum = senderJid.split('@')[0];

  if (senderNum === adminNum) return true;

  const senderWithout91 = senderNum.startsWith('91') ? senderNum.slice(2) : senderNum;
  const adminWithout91 = adminNum.startsWith('91') ? adminNum.slice(2) : adminNum;

  if (senderWithout91 === adminWithout91) return true;

  if (senderJid.includes('@lid')) {
    const phoneMatch = senderJid.match(/\d{10,12}/);
    if (phoneMatch) {
      const extractedNum = phoneMatch[0];
      const extractedWithout91 = extractedNum.startsWith('91') ? extractedNum.slice(2) : extractedNum;
      if (extractedWithout91 === adminWithout91 || extractedNum === adminNum) {
        return true;
      }
    }
  }
  return false;
}

function isMasterAdmin(senderJid) {
  const masterNum = cleanNumber(CONFIG.MASTER_ADMIN_NUMBER);
  let senderNum = senderJid.split('@')[0];

  if (senderNum === masterNum) return true;

  const senderWithout91 = senderNum.startsWith('91') ? senderNum.slice(2) : senderNum;
  const masterWithout91 = masterNum.startsWith('91') ? masterNum.slice(2) : masterNum;

  return senderWithout91 === masterWithout91;
}

// ==================== ABSENCE & CLASS HELPERS ====================
function isClassAbsent(teacher, dateStr, time) {
  return absences.some(a => {
    const matchTeacher = a.teacher.toLowerCase().trim() === teacher.toLowerCase().trim();
    const matchDate = a.date === dateStr;
    const matchTime = a.time === 'all' || a.time === time;
    return matchTeacher && matchDate && matchTime;
  });
}

function getClassesForDay(dayName, dateStr) {
  const classes = CLASS_SCHEDULE[dayName] || [];
  return classes.filter(c => {
    if (isClassAbsent(c.teacher, dateStr, c.time)) return false;
    return true;
  });
}

// ==================== RATE LIMIT CHECK ====================
function checkRateLimit(senderJid, isAdmin) {
  if (isAdmin) return true; // Admins bypass cooldown

  const now = Date.now();
  const lastTime = userCooldowns.get(senderJid) || 0;
  const cooldownMs = (CONFIG.RATE_LIMIT_SECONDS || 30) * 1000;

  if (now - lastTime < cooldownMs) {
    const waitSeconds = Math.ceil((cooldownMs - (now - lastTime)) / 1000);
    return { limited: true, waitSeconds };
  }

  userCooldowns.set(senderJid, now);
  return { limited: false };
}

// ==================== MAINTENANCE MESSAGE ====================
async function sendMaintenanceMessage() {
  if (!sock || isShuttingDown) return;
  isShuttingDown = true;
  try {
    await sock.sendMessage(currentConfig.GROUP_ID, {
      text: '🔧 *Bot is under maintenance.*\n\nPlease wait, we will be back shortly! Thank you for your patience.'
    });
    console.log('🔧 Maintenance message sent.');
    await new Promise(r => setTimeout(r, 2000));
  } catch (err) {
    console.error('❌ Failed to send maintenance message:', err.message);
  }
}

process.on('SIGINT', async () => {
  console.log('\n🛑 SIGINT received. Shutting down cleanly...');
  await sendMaintenanceMessage();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 SIGTERM received. Shutting down cleanly...');
  await sendMaintenanceMessage();
  process.exit(0);
});

// ==================== WHATSAPP CONNECT ====================
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');

  sock = makeWASocket({
    printQRInTerminal: true,
    auth: state,
    browser: Browsers.macOS('Chrome'),
    syncFullHistory: false,
    markOnlineOnConnect: true,
    keepAliveIntervalMs: 30000,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    emitOwnEvents: true,
    patchMessageBeforeSending: (message) => {
      const requiresPatch = !!(
        message.buttonsMessage ||
        message.templateMessage ||
        message.listMessage
      );
      if (requiresPatch) {
        message = {
          viewOnceMessage: {
            message: {
              messageContextInfo: {
                deviceListMetadata: {},
                deviceListMetadataVersion: 2,
              },
              ...message,
            },
          },
        };
      }
      return message;
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n📱 SCAN QR CODE TO LOGIN:\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`❌ Connection closed (code: ${statusCode}). Reconnecting: ${shouldReconnect}`);
      if (shouldReconnect) {
        setTimeout(connectToWhatsApp, 5000);
      }
    } else if (connection === 'open') {
      console.log('✅✅✅ WHATSAPP BOT CONNECTED! ✅✅✅');
      console.log(`👤 Active Admin: ${currentConfig.ADMIN_NUMBER}`);
      console.log(`👑 Master Admin: ${CONFIG.MASTER_ADMIN_NUMBER}`);
      console.log(`👥 Target Group: ${currentConfig.GROUP_ID}`);
      console.log(`🔔 Reminder Timings: [${CONFIG.REMINDER_MINUTES.join(', ')}] min`);

      if (!hasSentOnlineMessage) {
        try {
          const onlineCaption = '🟢 *College Bot is online & active!* ✅\n\nTimetables, reminders, broadcasts, weather, and exam schedules ready! Use *!help* to see available commands. 🤖';
          const bannerPng = CONFIG.BANNER_IMAGE || path.join(CONFIG.DATA_DIR, 'banner.png');
          const bannerJpg = path.join(CONFIG.DATA_DIR, 'banner.jpg');
          const bannerJpeg = path.join(CONFIG.DATA_DIR, 'banner.jpeg');

          if (fs.existsSync(bannerPng)) {
            await sock.sendMessage(currentConfig.GROUP_ID, {
              image: fs.readFileSync(bannerPng),
              caption: onlineCaption
            });
            console.log('🟢 Bot online greeting broadcasted with Banner Image (PNG).');
          } else if (fs.existsSync(bannerJpg)) {
            await sock.sendMessage(currentConfig.GROUP_ID, {
              image: fs.readFileSync(bannerJpg),
              caption: onlineCaption
            });
            console.log('🟢 Bot online greeting broadcasted with Banner Image (JPG).');
          } else if (fs.existsSync(bannerJpeg)) {
            await sock.sendMessage(currentConfig.GROUP_ID, {
              image: fs.readFileSync(bannerJpeg),
              caption: onlineCaption
            });
            console.log('🟢 Bot online greeting broadcasted with Banner Image (JPEG).');
          } else {
            await sock.sendMessage(currentConfig.GROUP_ID, {
              text: onlineCaption
            });
            console.log('🟢 Bot online greeting broadcasted (Text only, banner not found in data/banner.png).');
          }
          hasSentOnlineMessage = true;
        } catch (err) {
          console.error('❌ Failed to send online message:', err.message);
        }
      }

      startCronJobs();
    }
  });

  sock.ev.on('messages.update', async (updates) => {
    try {
      for (const update of updates) {
        if (lastPollMessage && update.key && update.key.id === lastPollMessage.id) {
          if (update.update?.pollUpdates) {
            const voter = update.key.participant || update.key.remoteJid;
            if (voter) {
              pollVoteTracker.voters.add(voter);
              console.log(`📊 Poll Vote detected from ${voter}. Total Votes: ${pollVoteTracker.voters.size}`);
            }
          }
        }
      }
    } catch (err) {
      console.error('❌ Error in poll tracker update:', err);
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    try {
      const msg = m.messages[0];
      if (!msg.message) return;

      const sender = msg.key.remoteJid;
      const isGroup = sender.endsWith('@g.us');
      const senderNumber = msg.key.participant || sender;

      const text = msg.message.conversation ||
                   msg.message.extendedTextMessage?.text ||
                   msg.message.imageMessage?.caption ||
                   msg.message.videoMessage?.caption ||
                   msg.message.documentMessage?.caption || '';
      const lowerText = text.toLowerCase().trim();

      const adminCheck = isAdminUser(senderNumber);

      // Check if command is common to public & admin
      const isHandled = await handleCommonCommands(sender, text, lowerText, adminCheck, senderNumber);
      if (isHandled) return;

      // Admin commands
      if (adminCheck) {
        await handleAdminCommands(sender, text, lowerText, isGroup, msg);
      }
    } catch (err) {
      console.error('❌ Error handling incoming message:', err);
    }
  });

  sock.ev.on('error', (err) => {
    if (err.message && err.message.includes('Timed Out')) return;
    console.error('⚠️ Socket error:', err);
  });

  process.on('unhandledRejection', (reason) => {
    if (reason && reason.message && reason.message.includes('Timed Out')) return;
    console.error('Unhandled Rejection:', reason);
  });
}

// ==================== UNIFIED COMMON COMMANDS ====================
/**
 * Public aur Admin dono ke liye commands (Code duplication hatane ke liye)
 */
async function handleCommonCommands(sender, text, lowerText, isAdmin, senderNumber) {
  try {
    // 1. !showschedule
    if (lowerText === '!showschedule') {
      const limit = checkRateLimit(senderNumber, isAdmin);
      if (limit.limited) {
        await sock.sendMessage(sender, { text: `⏳ Please wait ${limit.waitSeconds}s before using another command.` });
        return true;
      }

      let reply = '*📅 Full College Routine:*\n\n';
      for (const [day, classes] of Object.entries(CLASS_SCHEDULE)) {
        reply += `*${day}:*\n`;
        if (classes.length === 0) {
          reply += '  No classes scheduled\n\n';
        } else {
          classes.forEach(c => {
            reply += `  • *${c.subject}* (${c.type})\n    👨‍🏫 ${c.teacher}\n    📖 ${c.topic}\n    ⏰ ${c.time}\n\n`;
          });
        }
      }
      await sock.sendMessage(sender, { text: reply.trim() });
      return true;
    }

    // 2. !showtoday
    if (lowerText === '!showtoday') {
      const limit = checkRateLimit(senderNumber, isAdmin);
      if (limit.limited) {
        await sock.sendMessage(sender, { text: `⏳ Please wait ${limit.waitSeconds}s before using another command.` });
        return true;
      }

      const now = moment().tz(currentConfig.TIMEZONE);
      const today = now.format('dddd');
      const dateStr = now.format('DD-MM-YYYY');

      const holidayStatus = await checkIsHoliday(dateStr);
      if (holidayStatus.isHoliday) {
        await sock.sendMessage(sender, {
          text: `🎉 *Holiday!*\n\nToday (${dateStr}) is a holiday${holidayStatus.name ? ` for *${holidayStatus.name}*` : ''}. No classes scheduled! Enjoy your day off. 🌴`
        });
        return true;
      }

      const classes = getClassesForDay(today, dateStr);
      let reply = `*📅 ${today}'s Schedule (${dateStr}):*\n\n`;
      if (classes.length === 0) {
        reply += 'No classes today! 🎉';
      } else {
        classes.forEach(c => {
          reply += `• *${c.subject}* (${c.type})\n  👨‍🏫 ${c.teacher}\n  📖 ${c.topic}\n  ⏰ ${c.time}\n\n`;
        });
        reply += 'Have a productive day ahead! 🎓';
      }
      await sock.sendMessage(sender, { text: reply });
      return true;
    }

    // 3. FEATURE 1: !showtomorrow COMMAND
    if (lowerText === '!showtomorrow') {
      const limit = checkRateLimit(senderNumber, isAdmin);
      if (limit.limited) {
        await sock.sendMessage(sender, { text: `⏳ Please wait ${limit.waitSeconds}s before using another command.` });
        return true;
      }

      const tomorrow = moment().tz(currentConfig.TIMEZONE).add(1, 'day');
      const tomorrowDay = tomorrow.format('dddd');
      const tomorrowDateStr = tomorrow.format('DD-MM-YYYY');
      const tomorrowFormatted = tomorrow.format('DD MMM YYYY');

      // Check Holiday (Manual + API)
      const holidayStatus = await checkIsHoliday(tomorrowDateStr);
      if (holidayStatus.isHoliday) {
        await sock.sendMessage(sender, { text: '🎉 Holiday! Kal class nahi hai. Enjoy!' });
        return true;
      }

      // Check Sunday
      if (tomorrowDay === 'Sunday') {
        await sock.sendMessage(sender, { text: '🌴 Sunday! No classes tomorrow.' });
        return true;
      }

      // Get classes excluding absent teachers
      const tomorrowClasses = getClassesForDay(tomorrowDay, tomorrowDateStr);

      if (tomorrowClasses.length === 0) {
        await sock.sendMessage(sender, { text: 'No classes tomorrow! 🎉' });
        return true;
      }

      let reply = `📅 *Tomorrow's Schedule - ${tomorrowDay}, ${tomorrowFormatted}*\n\n`;
      tomorrowClasses.forEach(c => {
        reply += `• *${c.subject}* (${c.type})\n  👨‍🏫 ${c.teacher}\n  📖 ${c.topic}\n  ⏰ ${c.time}\n\n`;
      });
      reply += 'Have a great day ahead! 🎓';

      await sock.sendMessage(sender, { text: reply.trim() });
      return true;
    }

    // 4. FEATURE 4: !publicholidays COMMAND
    if (lowerText === '!publicholidays') {
      const limit = checkRateLimit(senderNumber, isAdmin);
      if (limit.limited) {
        await sock.sendMessage(sender, { text: `⏳ Please wait ${limit.waitSeconds}s before using another command.` });
        return true;
      }

      const currentYear = moment().tz(currentConfig.TIMEZONE).year();
      const holidaysList = await getPublicHolidays(currentYear);

      if (!holidaysList || holidaysList.length === 0) {
        await sock.sendMessage(sender, { text: '❌ Holiday API unavailable' });
        return true;
      }

      let reply = `🎉 *India Public Holidays ${currentYear}*\n\n`;
      holidaysList.forEach((h, index) => {
        const formattedDate = moment(h.date, 'YYYY-MM-DD').format('DD-MM-YYYY');
        reply += `${index + 1}. ${formattedDate} - ${h.name || h.localName}\n`;
      });

      await sock.sendMessage(sender, { text: reply.trim() });
      return true;
    }

    // 5. FEATURE 4: !nextholiday COMMAND
    if (lowerText === '!nextholiday') {
      const limit = checkRateLimit(senderNumber, isAdmin);
      if (limit.limited) {
        await sock.sendMessage(sender, { text: `⏳ Please wait ${limit.waitSeconds}s before using another command.` });
        return true;
      }

      const now = moment().tz(currentConfig.TIMEZONE).startOf('day');
      const currentYear = now.year();
      const holidaysList = await getPublicHolidays(currentYear);

      if (!holidaysList || holidaysList.length === 0) {
        await sock.sendMessage(sender, { text: '❌ Holiday API unavailable' });
        return true;
      }

      // Find upcoming holidays
      const upcoming = holidaysList
        .map(h => ({
          name: h.name || h.localName,
          momentDate: moment(h.date, 'YYYY-MM-DD'),
          dateFormatted: moment(h.date, 'YYYY-MM-DD').format('DD-MM-YYYY')
        }))
        .filter(h => h.momentDate.isSameOrAfter(now))
        .sort((a, b) => a.momentDate.diff(b.momentDate));

      if (upcoming.length === 0) {
        await sock.sendMessage(sender, { text: '🌴 No more public holidays remaining for this year!' });
        return true;
      }

      const next = upcoming[0];
      const daysDiff = next.momentDate.diff(now, 'days');
      const daysText = daysDiff === 0 ? 'Today!' : daysDiff === 1 ? '1 day remaining' : `${daysDiff} days remaining`;

      const reply = `🎉 *Next Holiday*\n\n📅 ${next.name}\n🗓️ ${next.dateFormatted}\n⏳ ${daysText}`;
      await sock.sendMessage(sender, { text: reply });
      return true;
    }

    // 6. !help
    if (lowerText === '!help') {
      const limit = checkRateLimit(senderNumber, isAdmin);
      if (limit.limited) {
        await sock.sendMessage(sender, { text: `⏳ Please wait ${limit.waitSeconds}s before using another command.` });
        return true;
      }

      let helpMsg = `*🤖 College WhatsApp Bot - Help Menu*\n\n` +
        `*📅 Routine & Schedule Commands:*\n` +
        `• !showschedule - Full weekly timetable\n` +
        `• !showtoday - Today's classes\n` +
        `• !showtomorrow - Tomorrow's classes\n` +
        `• !nextholiday - Days left for next public holiday\n` +
        `• !publicholidays - All Indian public holidays\n\n` +
        `*📖 Syllabus Commands:*\n` +
        `• !syllabus major3 - Waves & Optics\n` +
        `• !syllabus major3lab - Major 3 Practical\n` +
        `• !syllabus major4 - Analog Electronics\n` +
        `• !syllabus major4lab - Major 4 Practical\n` +
        `• !syllabus sec3 - Python / Computational Physics\n`;

      if (isAdmin) {
        helpMsg += `\n*👑 Admin Commands:*\n` +
          `• !broadcast (Reply to any DM message to forward to group)\n` +
          `• !addclass Day | Subject | Teacher | Type | Time | Topic\n` +
          `• !removeclass Day | Subject\n` +
          `• !cleanschedule - Clear all timetable\n` +
          `• !holidaytoday - Mark today as manual holiday\n` +
          `• !unholiday DD-MM-YYYY - Remove holiday\n` +
          `• !showholidays - List manual holidays\n` +
          `• !absent Teacher | DD-MM-YYYY [| Time]\n` +
          `• !removeabsent Teacher | DD-MM-YYYY [| Time]\n` +
          `• !showabsent - List upcoming teacher leaves\n` +
          `• exam time / !done / !cancel - Exam scheduling\n` +
          `• !show exams / !removeexam / !clearexams\n` +
          `• !status - Bot system status\n` +
          `• !setgroup ID (Master Admin only)\n` +
          `• !setadmin Number (Master Admin only)\n`;
      } else {
        helpMsg += `\n💡 Admin can manage routine, broadcasts, absences, and exams.`;
      }

      await sock.sendMessage(sender, { text: helpMsg.trim() });
      return true;
    }

    // 7. !syllabus
    if (lowerText.startsWith('!syllabus')) {
      const limit = checkRateLimit(senderNumber, isAdmin);
      if (limit.limited) {
        await sock.sendMessage(sender, { text: `⏳ Please wait ${limit.waitSeconds}s before using another command.` });
        return true;
      }

      const subject = lowerText.replace('!syllabus', '').trim();
      if (!subject || !SYLLABUS_TITLES[subject]) {
        await sock.sendMessage(sender, {
          text: `❌ Syllabus not found!\n\nAvailable options:\n` +
            `• !syllabus major3\n` +
            `• !syllabus major3lab\n` +
            `• !syllabus major4\n` +
            `• !syllabus major4lab\n` +
            `• !syllabus sec3`
        });
        return true;
      }

      const imagePath = SYLLABUS_IMAGES[subject];
      if (imagePath && fs.existsSync(imagePath)) {
        await sock.sendMessage(sender, {
          image: fs.readFileSync(imagePath),
          caption: `*${SYLLABUS_TITLES[subject]}*`
        });
      } else if (subject === 'sec3') {
        await sock.sendMessage(sender, {
          text: `*${SYLLABUS_TITLES[subject]}*\n\n` +
            `*Python Programming Basics*\n` +
            `• Variables, data types, operators, expressions\n` +
            `• Modules, I/O statements, loops (for/while)\n` +
            `• Lists, tuples, dictionaries, strings, sets\n` +
            `• Object Oriented Programming basics\n\n` +
            `*NumPy & Scientific Computing*\n` +
            `• Arrays, indexing, slicing, vectorization\n` +
            `• Linear algebra: matrix multiplication, eigenvalues\n\n` +
            `*Matplotlib / PyPlot*\n` +
            `• 2D & 3D plots, log plots, curves, subplots\n\n` +
            `*Numerical Methods*\n` +
            `• Roots: Newton-Raphson, Bisection\n` +
            `• ODEs: Euler, Runge-Kutta 2nd & 4th order\n` +
            `• Monte Carlo simulations`
        });
      } else {
        await sock.sendMessage(sender, {
          text: `❌ Syllabus image not found for ${subject}. Please add the image in ${imagePath}`
        });
      }
      return true;
    }

    return false; // Not a common command
  } catch (err) {
    console.error('❌ Error in handleCommonCommands:', err);
    return false;
  }
}

// ==================== ADMIN COMMANDS & BROADCAST ====================
async function handleAdminCommands(sender, text, lowerText, isGroup, msg) {
  try {
    // ----------------------------------------------------
    // FEATURE 2: !broadcast SYSTEM
    // Flow: Admin replies to a DM message with !broadcast
    // ----------------------------------------------------
    if (lowerText === '!broadcast') {
      const quotedContext = msg.message?.extendedTextMessage?.contextInfo;
      const quotedMsg = quotedContext?.quotedMessage;

      if (!quotedMsg) {
        await sock.sendMessage(sender, {
          text: '❌ Kisi message pe reply karke !broadcast likho'
        });
        return;
      }

      const targetGroup = currentConfig.GROUP_ID;
      const broadcastHeader = '📢 *Broadcast from Admin*';

      try {
        // Case A: Text message
        if (quotedMsg.conversation || quotedMsg.extendedTextMessage) {
          const originalText = quotedMsg.conversation || quotedMsg.extendedTextMessage?.text || '';
          await sock.sendMessage(targetGroup, {
            text: `${broadcastHeader}\n\n${originalText}`
          });
        }
        // Case B: Image message
        else if (quotedMsg.imageMessage) {
          const buffer = await downloadMediaMessage(
            { key: { remoteJid: sender, id: quotedContext.stanzaId, participant: quotedContext.participant }, message: quotedMsg },
            'buffer',
            {}
          );
          const origCaption = quotedMsg.imageMessage.caption ? `\n\n${quotedMsg.imageMessage.caption}` : '';
          await sock.sendMessage(targetGroup, {
            image: buffer,
            caption: `${broadcastHeader}${origCaption}`
          });
        }
        // Case C: Video message
        else if (quotedMsg.videoMessage) {
          const buffer = await downloadMediaMessage(
            { key: { remoteJid: sender, id: quotedContext.stanzaId, participant: quotedContext.participant }, message: quotedMsg },
            'buffer',
            {}
          );
          const origCaption = quotedMsg.videoMessage.caption ? `\n\n${quotedMsg.videoMessage.caption}` : '';
          await sock.sendMessage(targetGroup, {
            video: buffer,
            caption: `${broadcastHeader}${origCaption}`
          });
        }
        // Case D: Document message
        else if (quotedMsg.documentMessage) {
          const buffer = await downloadMediaMessage(
            { key: { remoteJid: sender, id: quotedContext.stanzaId, participant: quotedContext.participant }, message: quotedMsg },
            'buffer',
            {}
          );
          const origCaption = quotedMsg.documentMessage.caption ? `\n\n${quotedMsg.documentMessage.caption}` : '';
          await sock.sendMessage(targetGroup, {
            document: buffer,
            mimetype: quotedMsg.documentMessage.mimetype || 'application/octet-stream',
            fileName: quotedMsg.documentMessage.fileName || 'document.pdf',
            caption: `${broadcastHeader}${origCaption}`
          });
        }
        // Case E: Audio message
        else if (quotedMsg.audioMessage) {
          const buffer = await downloadMediaMessage(
            { key: { remoteJid: sender, id: quotedContext.stanzaId, participant: quotedContext.participant }, message: quotedMsg },
            'buffer',
            {}
          );
          await sock.sendMessage(targetGroup, { text: broadcastHeader });
          await sock.sendMessage(targetGroup, {
            audio: buffer,
            mimetype: quotedMsg.audioMessage.mimetype || 'audio/mp4',
            ptt: !!quotedMsg.audioMessage.ptt
          });
        } else {
          await sock.sendMessage(sender, {
            text: '❌ Unsupported message type for broadcast.'
          });
          return;
        }

        await sock.sendMessage(sender, {
          text: '✅ Broadcast sent to group!'
        });
        console.log(`📢 Broadcast delivered to group ${targetGroup}`);
      } catch (bcErr) {
        console.error('❌ Broadcast forwarding failed:', bcErr);
        await sock.sendMessage(sender, {
          text: `❌ Broadcast failed: ${bcErr.message}`
        });
      }
      return;
    }

    // ----------------------------------------------------
    // SCHEDULE MANAGEMENT
    // ----------------------------------------------------
    if (lowerText.startsWith('!addclass')) {
      const parts = text.replace(/!addclass\s*/i, '').split('|').map(p => p.trim());
      if (parts.length < 6) {
        await sock.sendMessage(sender, {
          text: '❌ Wrong format!\n\nCorrect format:\n`!addclass Monday | Math | Prof. Sharma | Major3 | 10:30 AM | Waves`'
        });
        return;
      }
      const [day, subject, teacher, type, time, topic] = parts;
      const validDays = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
      if (!validDays.includes(day)) {
        await sock.sendMessage(sender, { text: `❌ Invalid day! Valid options: ${validDays.join(', ')}` });
        return;
      }
      if (!CLASS_SCHEDULE[day]) CLASS_SCHEDULE[day] = [];
      CLASS_SCHEDULE[day].push({ subject, teacher, type, time, topic });
      CLASS_SCHEDULE[day].sort((a, b) => moment(a.time, 'h:mm A').diff(moment(b.time, 'h:mm A')));
      saveSchedule();

      const reply = `✅ *Class Added!*\n\n📚 ${subject}\n👨‍🏫 ${teacher}\n📌 ${type}\n📖 ${topic}\n⏰ ${time}\n📅 ${day}`;
      await sock.sendMessage(sender, { text: reply });
      return;
    }

    if (lowerText.startsWith('!removeclass')) {
      const parts = text.replace(/!removeclass\s*/i, '').split('|').map(p => p.trim());
      if (parts.length < 2) {
        await sock.sendMessage(sender, { text: '❌ Format: `!removeclass Monday | Math`' });
        return;
      }
      const [day, subject] = parts;
      if (!CLASS_SCHEDULE[day]) {
        await sock.sendMessage(sender, { text: `❌ No classes found on ${day}!` });
        return;
      }
      const beforeLen = CLASS_SCHEDULE[day].length;
      CLASS_SCHEDULE[day] = CLASS_SCHEDULE[day].filter(c => c.subject.toLowerCase() !== subject.toLowerCase());
      if (CLASS_SCHEDULE[day].length === beforeLen) {
        await sock.sendMessage(sender, { text: `❌ Class "${subject}" not found on ${day}!` });
        return;
      }
      saveSchedule();
      await sock.sendMessage(sender, { text: `✅ *${subject}* removed from ${day}!` });
      return;
    }

    if (lowerText === '!cleanschedule') {
      CLASS_SCHEDULE = { Monday:[], Tuesday:[], Wednesday:[], Thursday:[], Friday:[], Saturday:[], Sunday:[] };
      saveSchedule();
      await sock.sendMessage(sender, { text: '✅ *Schedule completely cleared!*' });
      return;
    }

    // ----------------------------------------------------
    // SENSITIVE CONFIG COMMANDS (Master Admin Only)
    // ----------------------------------------------------
    if (lowerText.startsWith('!setgroup')) {
      if (!isMasterAdmin(sender)) {
        await sock.sendMessage(sender, { text: '❌ Sirf Master Admin hi Group ID change kar sakta hai!' });
        return;
      }
      const gid = text.replace(/!setgroup\s*/i, '').trim();
      if (!gid.includes('@g.us')) {
        await sock.sendMessage(sender, { text: '❌ Invalid group ID! Format: `1203630...@g.us`' });
        return;
      }
      currentConfig.GROUP_ID = gid;
      saveRuntimeConfig();
      await sock.sendMessage(sender, { text: `✅ Group ID set to: ${gid} (Persisted & Backed Up)` });
      return;
    }

    if (lowerText.startsWith('!setadmin')) {
      if (!isMasterAdmin(sender)) {
        await sock.sendMessage(sender, { text: '❌ Sirf Master Admin hi Admin Number change kar sakta hai!' });
        return;
      }
      const num = text.replace(/!setadmin\s*/i, '').trim().replace(/\D/g, '');
      if (num.length < 10) {
        await sock.sendMessage(sender, { text: '❌ Invalid phone number! Format: `!setadmin 919876543210`' });
        return;
      }
      currentConfig.ADMIN_NUMBER = num.startsWith('91') ? num : '91' + num;
      saveRuntimeConfig();
      await sock.sendMessage(sender, { text: `✅ Admin number set to: ${currentConfig.ADMIN_NUMBER} (Persisted & Backed Up)` });
      return;
    }

    // ----------------------------------------------------
    // STATUS COMMAND
    // ----------------------------------------------------
    if (lowerText === '!status') {
      const now = moment().tz(currentConfig.TIMEZONE);
      const today = now.format('dddd');
      const todayClasses = getClassesForDay(today, now.format('DD-MM-YYYY'));
      const reply = `*🤖 Bot System Status:*\n\n` +
        `📅 Today: ${today} (${now.format('DD-MM-YYYY')})\n` +
        `⏰ Current Time: ${now.format('hh:mm A')}\n` +
        `📚 Classes Today: ${todayClasses.length}\n` +
        `📝 Scheduled Exams: ${exams.length}\n` +
        `🌴 Holidays: ${holidays.length} manual\n` +
        `👨‍🏫 Absences: ${absences.length} recorded\n` +
        `👤 Active Admin: ${currentConfig.ADMIN_NUMBER}\n` +
        `👑 Master Admin: ${CONFIG.MASTER_ADMIN_NUMBER}\n` +
        `👥 Target Group: ${currentConfig.GROUP_ID}\n` +
        `🔔 Reminders: [${CONFIG.REMINDER_MINUTES.join(', ')}] min\n` +
        `☁️ Telegram Backup: ${tgBot ? 'Connected ✅' : 'Local Fallback ⚠️'}\n` +
        `⚡ WhatsApp Connection: Online`;
      await sock.sendMessage(sender, { text: reply });
      return;
    }

    // ----------------------------------------------------
    // HOLIDAY MANAGEMENT
    // ----------------------------------------------------
    if (lowerText === '!holidaytoday') {
      const now = moment().tz(currentConfig.TIMEZONE);
      const dateStr = now.format('DD-MM-YYYY');
      const dayName = now.format('dddd');

      if (holidays.includes(dateStr)) {
        await sock.sendMessage(sender, { text: `❌ ${dateStr} is already marked as a holiday!` });
        return;
      }

      holidays.push(dateStr);
      saveHolidays();

      const notifyMsg = `🎉 *Holiday Announcement*\n\n` +
        `📅 Date: ${dateStr} (${dayName})\n` +
        `🌴 Today has been declared a college holiday! No classes scheduled.\n\n` +
        `Enjoy your day off everyone! 🎊`;

      await sock.sendMessage(currentConfig.GROUP_ID, { text: notifyMsg });
      await sock.sendMessage(sender, { text: `✅ Holiday set for ${dateStr}!` });
      return;
    }

    if (lowerText.startsWith('!unholiday')) {
      const dateStr = text.replace(/!unholiday\s*/i, '').trim();
      const idx = holidays.indexOf(dateStr);
      if (idx === -1) {
        await sock.sendMessage(sender, { text: `❌ ${dateStr} is not marked as a holiday!` });
        return;
      }
      holidays.splice(idx, 1);
      saveHolidays();
      await sock.sendMessage(sender, { text: `✅ Holiday removed for ${dateStr}!` });
      return;
    }

    if (lowerText === '!showholidays') {
      if (holidays.length === 0) {
        await sock.sendMessage(sender, { text: '📅 No manual holidays set.' });
        return;
      }
      let msg = '*🎉 Manual College Holidays:*\n\n';
      holidays.forEach((h, i) => {
        msg += `${i + 1}. ${h}\n`;
      });
      await sock.sendMessage(sender, { text: msg });
      return;
    }

    // ----------------------------------------------------
    // TEACHER ABSENCE COMMANDS
    // ----------------------------------------------------
    if (lowerText.startsWith('!absent')) {
      const parts = text.replace(/!absent\s*/i, '').split('|').map(p => p.trim());
      if (parts.length < 2) {
        await sock.sendMessage(sender, {
          text: '❌ Format:\n`!absent Prof. Name | DD-MM-YYYY | 10:30 AM`\nOR\n`!absent Prof. Name | DD-MM-YYYY` (Full day)'
        });
        return;
      }
      const [teacher, dateStr, time] = parts;
      const timeVal = time || 'all';

      absences.push({ teacher, date: dateStr, time: timeVal, createdAt: new Date().toISOString() });
      saveAbsences();

      const timeText = timeVal === 'all' ? 'All classes today' : `Class at ${timeVal}`;
      const notifyMsg = `📢 *Class Cancellation Notice*\n\n` +
        `👨‍🏫 *Teacher:* ${teacher}\n` +
        `📅 *Date:* ${dateStr}\n` +
        `⏰ *Cancelled:* ${timeText}\n\n` +
        `Please plan your schedule accordingly. 📚`;

      await sock.sendMessage(currentConfig.GROUP_ID, { text: notifyMsg });
      await sock.sendMessage(sender, { text: `✅ Absence recorded for ${teacher} on ${dateStr} (${timeText})!` });
      return;
    }

    if (lowerText.startsWith('!removeabsent')) {
      const parts = text.replace(/!removeabsent\s*/i, '').split('|').map(p => p.trim());
      if (parts.length < 2) {
        await sock.sendMessage(sender, { text: '❌ Format: `!removeabsent Prof. Name | DD-MM-YYYY`' });
        return;
      }
      const [teacher, dateStr, time] = parts;
      const timeVal = time || 'all';

      const beforeLen = absences.length;
      absences = absences.filter(a => !(a.teacher.toLowerCase() === teacher.toLowerCase() && a.date === dateStr && (time ? a.time === timeVal : true)));

      if (absences.length === beforeLen) {
        await sock.sendMessage(sender, { text: '❌ Absence record not found!' });
        return;
      }
      saveAbsences();
      await sock.sendMessage(sender, { text: `✅ Absence removed for ${teacher} on ${dateStr}!` });
      return;
    }

    if (lowerText === '!showabsent') {
      const now = moment().tz(currentConfig.TIMEZONE);
      const todayStr = now.format('DD-MM-YYYY');
      const upcomingAbsences = absences.filter(a => a.date >= todayStr);

      if (upcomingAbsences.length === 0) {
        await sock.sendMessage(sender, { text: '📋 No upcoming teacher absences recorded.' });
        return;
      }
      let msg = '*📋 Recorded Teacher Absences:*\n\n';
      upcomingAbsences.forEach((a, i) => {
        msg += `${i + 1}. 👨‍🏫 *${a.teacher}*\n   📅 Date: ${a.date}\n   ⏰ Time: ${a.time === 'all' ? 'Full Day' : a.time}\n\n`;
      });
      await sock.sendMessage(sender, { text: msg.trim() });
      return;
    }

    // ----------------------------------------------------
    // EXAM MANAGEMENT
    // ----------------------------------------------------
    if (lowerText === 'exam time' || lowerText === '!exam') {
      examMode = { active: true, data: {} };
      await sock.sendMessage(sender, {
        text: '📚 *Exam Mode Activated* 📚\n\nSend exam details in format:\n`Subject | DD-MM-YYYY | 10:00 AM`\n\nType `!done` to complete or `!cancel` to abort.'
      });
      return;
    }

    if (examMode.active) {
      await handleExamInput(sender, text);
      return;
    }

    if (lowerText === '!show exams') {
      if (exams.length === 0) {
        await sock.sendMessage(sender, { text: '❌ No exams scheduled.' });
      } else {
        let msg = '*📋 Scheduled College Exams:*\n\n';
        exams.forEach((e, i) => {
          msg += `${i + 1}. *${e.subject}*\n📅 ${e.date} | ⏰ ${e.time}\n\n`;
        });
        await sock.sendMessage(sender, { text: msg.trim() });
      }
      return;
    }

    if (lowerText.startsWith('!removeexam')) {
      const num = parseInt(text.replace(/!removeexam\s*/i, '').trim());
      if (isNaN(num) || num < 1 || num > exams.length) {
        await sock.sendMessage(sender, { text: '❌ Invalid exam index! Usage: `!removeexam 1`' });
        return;
      }
      const removed = exams.splice(num - 1, 1)[0];
      saveExams();
      await sock.sendMessage(sender, { text: `✅ *${removed.subject}* exam removed!` });
      return;
    }

    if (lowerText === '!clearexams') {
      exams = [];
      saveExams();
      await sock.sendMessage(sender, { text: '✅ *All exams cleared!*' });
      return;
    }
  } catch (err) {
    console.error('❌ Admin command error:', err);
  }
}

// ==================== EXAM MODE INPUT ====================
async function handleExamInput(sender, text) {
  try {
    const lower = text.toLowerCase().trim();

    if (lower === '!cancel') {
      examMode = { active: false, data: {} };
      await sock.sendMessage(sender, { text: '❌ Exam mode cancelled.' });
      return;
    }

    if (lower === '!done') {
      examMode = { active: false, data: {} };
      await sock.sendMessage(sender, { text: '✅ Exam entry session complete!' });
      return;
    }

    let subject, date, time;

    if (text.includes('|')) {
      const parts = text.split('|').map(p => p.trim());
      if (parts.length >= 3) {
        [subject, date, time] = parts;
      }
    } else {
      const subMatch = text.match(/[Ss]ubject[:\-]?\s*(.+)/);
      const dateMatch = text.match(/[Dd]ate[:\-]?\s*(.+)/);
      const timeMatch = text.match(/[Tt]ime[:\-]?\s*(.+)/);
      if (subMatch) subject = subMatch[1].trim();
      if (dateMatch) date = dateMatch[1].trim();
      if (timeMatch) time = timeMatch[1].trim();
    }

    if (subject && date && time) {
      const exam = {
        id: Date.now(),
        subject,
        date,
        time,
        createdAt: new Date().toISOString()
      };
      exams.push(exam);
      saveExams();

      await sock.sendMessage(sender, {
        text: `✅ *Exam Saved!*\n\n📘 ${subject}\n📅 ${date}\n⏰ ${time}\n\nSend next exam or type *!done* to finish.`
      });
    } else {
      await sock.sendMessage(sender, {
        text: '❌ Format not recognized.\n\nUse: `Subject | 25-08-2026 | 10:00 AM`'
      });
    }
  } catch (err) {
    console.error('❌ Exam input error:', err);
  }
}

// ==================== CRON JOBS SETUP ====================
function startCronJobs() {
  if (cronStarted) return;
  cronStarted = true;

  console.log('⏰ Scheduling background cron jobs with timezone:', currentConfig.TIMEZONE);
  const cronOptions = { timezone: currentConfig.TIMEZONE };

  // 1. Har minute class reminder & started check
  cron.schedule('* * * * *', async () => {
    await checkClassReminders();
  }, cronOptions);

  // 2. Raat 9:00 PM attendance poll
  cron.schedule(currentConfig.POLL_TIME, async () => {
    await sendDailyPoll();
  }, cronOptions);

  // 3. Subah 9:00 AM poll unpin aur result announcement
  cron.schedule(currentConfig.POLL_UNPIN_TIME, async () => {
    await unpinPollAndSendResults();
  }, cronOptions);

  // 4. Subah 7:00 AM Exam reminders
  cron.schedule('0 7 * * *', async () => {
    await sendExamReminders();
  }, cronOptions);

  // 5. Subah 6:00 AM Good Morning (with Weather API & Public Holiday greeting)
  cron.schedule(currentConfig.GOOD_MORNING_TIME, async () => {
    await sendGoodMorning();
  }, cronOptions);

  // 6. Subah 8:00 AM Daily schedule
  cron.schedule(currentConfig.DAILY_SCHEDULE_TIME, async () => {
    await sendDailySchedule();
  }, cronOptions);

  // 7. Shaam 4:30 PM College over message
  cron.schedule(currentConfig.COLLEGE_OVER_TIME, async () => {
    await sendCollegeOverMessage();
  }, cronOptions);

  // 8. Raat 11:00 PM Good Night message
  cron.schedule(currentConfig.GOOD_NIGHT_TIME, async () => {
    await sendGoodNight();
  }, cronOptions);

  // 9. Raat 12:00 AM Daily Complete Telegram Cloud Backup & cache cleanup
  cron.schedule(CONFIG.DAILY_BACKUP_TIME || '0 0 * * *', async () => {
    console.log('📦 Triggering midnight Telegram cloud backup...');
    await performFullTelegramBackup();
  }, cronOptions);
}

// ==================== FULL TELEGRAM BACKUP ====================
async function performFullTelegramBackup() {
  try {
    const fullBackup = {
      timestamp: new Date().toISOString(),
      schedule: CLASS_SCHEDULE,
      exams,
      holidays,
      absences,
      runtimeConfig: {
        ADMIN_NUMBER: currentConfig.ADMIN_NUMBER,
        GROUP_ID: currentConfig.GROUP_ID
      }
    };
    await sendToTelegram('daily_full_backup', fullBackup);

    // Old reminder cleanup
    const today = moment().tz(currentConfig.TIMEZONE).format('YYYY-MM-DD');
    sentReminders = sentReminders.filter(r => r.split('_')[0] >= today);
    startedClasses = startedClasses.filter(r => r.split('_')[0] >= today);
    saveReminders();
    saveStarted();
    console.log('🧹 Daily cleanup complete.');
  } catch (err) {
    console.error('❌ Daily Telegram backup failed:', err);
  }
}

// ==================== CLASS REMINDERS ====================
async function checkClassReminders() {
  try {
    const now = moment().tz(currentConfig.TIMEZONE);
    const today = now.format('dddd');
    const currentTime = now.format('h:mm A');
    const todayStr = now.format('YYYY-MM-DD');
    const todayStrDisplay = now.format('DD-MM-YYYY');

    // Agar aaj holiday hai to reminder mat bhejo
    const holidayCheck = await checkIsHoliday(todayStrDisplay);
    if (holidayCheck.isHoliday) return;

    const todayClasses = CLASS_SCHEDULE[today] || [];

    for (const cls of todayClasses) {
      if (isClassAbsent(cls.teacher, todayStrDisplay, cls.time)) continue;

      const classTime = moment(cls.time, 'h:mm A');

      // Check [30, 15, 5] minutes reminders
      if (CONFIG.REMINDER_MINUTES && CONFIG.REMINDER_MINUTES.length > 0) {
        for (const minutes of CONFIG.REMINDER_MINUTES) {
          const reminderTime = classTime.clone().subtract(minutes, 'minutes');
          const reminderTimeStr = reminderTime.format('h:mm A');
          const reminderId = `${todayStr}_${cls.subject}_${cls.time}_${minutes}`;

          if (currentTime === reminderTimeStr && !sentReminders.includes(reminderId)) {
            const emoji = minutes === 30 ? '⏰' : minutes === 15 ? '⚡' : '🔥';
            const message = `${emoji} *Class Alert!*\n\n` +
              `📚 *Subject:* ${cls.subject}\n` +
              `👨‍🏫 *Teacher:* ${cls.teacher}\n` +
              `📌 *Type:* ${cls.type}\n` +
              `📖 *Topic:* ${cls.topic}\n` +
              `⏰ *Time:* ${cls.time}\n\n` +
              `*${minutes} minutes until class starts!* 📖`;

            try {
              await sock.sendMessage(currentConfig.GROUP_ID, { text: message });
              sentReminders.push(reminderId);
              saveReminders();
              console.log(`✅ Reminder sent: ${cls.subject} (${minutes}m ahead)`);
            } catch (err) {
              console.error('❌ Reminder error:', err.message);
            }
          }
        }
      }

      // Check Class Started Notification
      const classTimeStr = classTime.format('h:mm A');
      const startedId = `${todayStr}_${cls.subject}_${cls.time}`;

      if (currentTime === classTimeStr && !startedClasses.includes(startedId)) {
        const message = `🎓 *Class Started!*\n\n` +
          `📚 *Subject:* ${cls.subject}\n` +
          `👨‍🏫 *Teacher:* ${cls.teacher}\n` +
          `📌 *Type:* ${cls.type}\n` +
          `📖 *Topic:* ${cls.topic}\n` +
          `⏰ *Time:* ${cls.time}\n\n` +
          `Best of luck everyone! Stay attentive and take good notes! 💪`;

        try {
          await sock.sendMessage(currentConfig.GROUP_ID, { text: message });
          startedClasses.push(startedId);
          saveStarted();
          console.log(`✅ Class started message sent: ${cls.subject}`);
        } catch (err) {
          console.error('❌ Class started message error:', err.message);
        }
      }
    }
  } catch (err) {
    console.error('❌ Error in checkClassReminders:', err);
  }
}

// ==================== DAILY ATTENDANCE POLL ====================
async function sendDailyPoll() {
  try {
    const now = moment().tz(currentConfig.TIMEZONE);
    const today = now.day();

    if (CONFIG.NO_POLL_DAYS.includes(today)) {
      console.log('📅 No poll scheduled for Friday/Saturday evening');
      return;
    }

    const tomorrow = now.clone().add(1, 'day');
    const tomorrowDay = tomorrow.format('dddd');
    const tomorrowDateStr = tomorrow.format('DD-MM-YYYY');

    // Agar kal chhutti hai to poll mat bhejo
    const holidayCheck = await checkIsHoliday(tomorrowDateStr);
    if (holidayCheck.isHoliday) {
      console.log(`🌴 Kal chhutti hai (${holidayCheck.name || 'Holiday'}), skipping poll.`);
      return;
    }

    const tomorrowClasses = getClassesForDay(tomorrowDay, tomorrowDateStr);
    const majorClasses = tomorrowClasses.filter(c => c.type.toLowerCase().includes('major'));
    const dateStr = tomorrow.format('DD MMMM');

    if (majorClasses.length === 0) {
      await sock.sendMessage(currentConfig.GROUP_ID, {
        text: `📢 *Reminder*\n\n*No major classes tomorrow (${dateStr}).*\n\nEnjoy your evening! 🎉`
      });
      return;
    }

    const pollMsg = await sock.sendMessage(currentConfig.GROUP_ID, {
      poll: {
        name: `🏫 Will you attend college tomorrow? (${dateStr})\n\nTomorrow's major classes:\n${majorClasses.map(c => `• ${c.subject} - ${c.time} (${c.topic})`).join('\n')}`,
        values: ['✅ Yes, I will attend', '❌ No, I will not attend'],
        selectableCount: 1
      }
    });

    console.log('📊 Poll sent successfully');

    if (pollMsg && pollMsg.key) {
      lastPollMessage = pollMsg.key;
      pollVoteTracker = { key: pollMsg.key, voters: new Set() };
      savePollMsg();

      try {
        await sock.sendMessage(currentConfig.GROUP_ID, { pin: pollMsg.key });
        console.log('📌 Poll message pinned');
      } catch (err) {
        console.error('❌ Failed to pin poll:', err.message);
      }
    }
  } catch (err) {
    console.error('❌ Failed to send daily poll:', err.message);
  }
}

async function unpinPollAndSendResults() {
  try {
    if (!lastPollMessage) {
      console.log('📌 No active poll message to unpin');
      return;
    }

    try {
      await sock.sendMessage(currentConfig.GROUP_ID, { unpin: lastPollMessage });
      console.log('📌 Poll message unpinned');
    } catch (err) {
      console.error('❌ Failed to unpin poll:', err.message);
    }

    const yesterday = moment().tz(currentConfig.TIMEZONE).clone().subtract(1, 'day').format('DD MMMM');
    const totalVotes = pollVoteTracker.voters ? pollVoteTracker.voters.size : 0;

    const resultsMsg = `📊 *Poll Closed*\n\n` +
      `The attendance poll for ${yesterday} has been closed.\n\n` +
      `🗳️ *Total Votes Cast:* ${totalVotes}\n\n` +
      `Best of luck to everyone attending college today! Stay focused and make the most of your classes. You've got this! 🎓💪`;

    await sock.sendMessage(currentConfig.GROUP_ID, { text: resultsMsg });

    // Cloud Backup of poll result to Telegram
    sendToTelegram('poll_result', {
      date: yesterday,
      totalVotes,
      voters: Array.from(pollVoteTracker.voters || [])
    });

    lastPollMessage = null;
    pollVoteTracker = { key: null, voters: new Set() };
    savePollMsg();
  } catch (err) {
    console.error('❌ Unpin poll error:', err.message);
  }
}

// ==================== EXAM REMINDERS ====================
async function sendExamReminders() {
  try {
    if (exams.length === 0) return;

    const now = moment().tz(currentConfig.TIMEZONE);
    const todayStr = now.format('DD-MM-YYYY');
    const todayExams = exams.filter(e => e.date === todayStr);

    for (const exam of todayExams) {
      const message = `📝 *EXAM TODAY!*\n\n` +
        `📘 *Subject:* ${exam.subject}\n` +
        `⏰ *Time:* ${exam.time}\n\n` +
        `Give it your best shot! Best of luck everyone! 💪🎓`;

      try {
        await sock.sendMessage(currentConfig.GROUP_ID, { text: message });
        console.log(`📝 Exam reminder broadcasted: ${exam.subject}`);
      } catch (err) {
        console.error('❌ Exam reminder error:', err.message);
      }
    }
  } catch (err) {
    console.error('❌ sendExamReminders error:', err);
  }
}

// ==================== GOOD MORNING (FEATURE 3 & 4) ====================
async function sendGoodMorning() {
  try {
    const now = moment().tz(currentConfig.TIMEZONE);
    const dayIndex = now.day();
    const todayStr = now.format('DD-MM-YYYY');

    // 1. Holiday API Check
    const holidayCheck = await checkIsHoliday(todayStr);
    if (holidayCheck.isHoliday) {
      const holidayMsg = `☀️ *Good Morning everyone!*\n\n🎉 Aaj *${holidayCheck.name || 'Holiday'}* hai! Enjoy your day off! 🌴`;
      await sock.sendMessage(currentConfig.GROUP_ID, { text: holidayMsg });
      console.log('☀️ Good morning holiday message sent.');
      return;
    }

    // 2. Regular message + Weather API
    let message = GOOD_MORNING_MESSAGES[dayIndex];

    const weatherSection = await fetchWeatherForecast();
    if (weatherSection) {
      // Weather information append karo
      message += weatherSection;
      message += '\n\nHave a wonderful day ahead! ✨';
    }

    await sock.sendMessage(currentConfig.GROUP_ID, { text: message });
    console.log('☀️ Good morning message sent with weather!');
  } catch (err) {
    console.error('❌ Good morning broadcast error:', err.message);
  }
}

// ==================== GOOD NIGHT ====================
async function sendGoodNight() {
  try {
    const now = moment().tz(currentConfig.TIMEZONE);
    const dayIndex = now.day();
    const message = GOOD_NIGHT_MESSAGES[dayIndex];
    await sock.sendMessage(currentConfig.GROUP_ID, { text: message });
    console.log('🌙 Good night sent');
  } catch (err) {
    console.error('❌ Good night failed:', err.message);
  }
}

// ==================== DAILY SCHEDULE (8 AM) ====================
async function sendDailySchedule() {
  try {
    const now = moment().tz(currentConfig.TIMEZONE);
    const today = now.format('dddd');
    const dateStr = now.format('DD-MM-YYYY');
    const fullDate = now.format('DD MMMM YYYY');

    // Check holiday (Manual + API)
    const holidayCheck = await checkIsHoliday(dateStr);
    if (holidayCheck.isHoliday) {
      await sock.sendMessage(currentConfig.GROUP_ID, {
        text: `🎉 *${holidayCheck.name || 'Holiday'}*\n\nAaj college band hai! Enjoy! 🌴`
      });
      return;
    }

    const classes = getClassesForDay(today, dateStr);

    if (classes.length === 0) {
      await sock.sendMessage(currentConfig.GROUP_ID, {
        text: `📅 *Today's Schedule - ${today}, ${fullDate}*\n\nNo classes today! Enjoy your free day! 🎉`
      });
      return;
    }

    let msg = `📅 *Today's Schedule - ${today}, ${fullDate}*\n\n`;
    classes.forEach(c => {
      msg += `• *${c.subject}* (${c.type})\n  👨‍🏫 ${c.teacher}\n  📖 ${c.topic}\n  ⏰ ${c.time}\n\n`;
    });
    msg += `Have a great day ahead! 🎓`;

    await sock.sendMessage(currentConfig.GROUP_ID, { text: msg });
    console.log('📅 Daily schedule sent');
  } catch (err) {
    console.error('❌ Daily schedule failed:', err.message);
  }
}

// ==================== COLLEGE OVER (4:30 PM) ====================
async function sendCollegeOverMessage() {
  try {
    const now = moment().tz(currentConfig.TIMEZONE);
    const dayIndex = now.day();
    const message = COLLEGE_OVER_MESSAGES[dayIndex];
    await sock.sendMessage(currentConfig.GROUP_ID, { text: message });
    console.log('🏫 College over message sent');
  } catch (err) {
    console.error('❌ College over failed:', err.message);
  }
}

// ==================== START BOT ====================
connectToWhatsApp();
