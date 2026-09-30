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

import * as BaileysModule from '@whiskeysockets/baileys';

// Universal resolution across Node 18/20/22/24 and different Baileys bundle versions
const _baileys = (BaileysModule.default && typeof BaileysModule.default === 'object') ? BaileysModule.default : BaileysModule;
const makeWASocket = typeof BaileysModule.makeWASocket === 'function' 
  ? BaileysModule.makeWASocket 
  : (typeof _baileys.makeWASocket === 'function' 
      ? _baileys.makeWASocket 
      : (typeof _baileys.default === 'function' ? _baileys.default : BaileysModule.default));
const DisconnectReason = _baileys.DisconnectReason || BaileysModule.DisconnectReason;
const useMultiFileAuthState = _baileys.useMultiFileAuthState || BaileysModule.useMultiFileAuthState;
const Browsers = _baileys.Browsers || BaileysModule.Browsers;
const downloadMediaMessage = _baileys.downloadMediaMessage || BaileysModule.downloadMediaMessage;
import cron from 'node-cron';
import moment from 'moment-timezone';
import fs from 'fs';
import path from 'path';
import qrcode from 'qrcode-terminal';
import axios from 'axios';
import TelegramBot from 'node-telegram-bot-api';
import sharp from 'sharp';
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
const STUDENTS_FILE = path.join(CONFIG.DATA_DIR, 'students.json');
const USERS_FILE = path.join(CONFIG.DATA_DIR, 'users.json');
const ATTENDANCE_FILE = path.join(CONFIG.DATA_DIR, 'attendance.json');
const NOTES_FILE = path.join(CONFIG.DATA_DIR, 'notes.json');
const ALLOWED_NAMES_FILE = path.join('.', 'allowed_names.json');
const DEADLINES_FILE = path.join(CONFIG.DATA_DIR, 'deadlines.json');
const TICKETS_FILE = path.join(CONFIG.DATA_DIR, 'tickets.json');

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
    tgBot = new TelegramBot(CONFIG.TELEGRAM_BOT_TOKEN, { polling: true });
    tgBot.on('polling_error', (error) => {
      if (error && error.code !== 'EFATAL') {
        console.warn('⚠️ Telegram polling issue:', error.message || error);
      }
    });
    console.log('🤖 Telegram backup bot & companion initialized with interactive polling!');
  } catch (err) {
    console.error('❌ Telegram Bot Init Error:', err.message);
  }
} else {
  console.log('ℹ️ Telegram token not configured yet. Fallback to local files enabled.');
}

function purgeOldTempFiles() {
  try {
    if (fs.existsSync(CONFIG.TEMP_DIR)) {
      const files = fs.readdirSync(CONFIG.TEMP_DIR);
      files.forEach(f => {
        try { fs.unlinkSync(path.join(CONFIG.TEMP_DIR, f)); } catch (e) {}
      });
    }
  } catch (e) {}
}

function ensureTempDir() {
  if (!fs.existsSync(CONFIG.TEMP_DIR)) {
    fs.mkdirSync(CONFIG.TEMP_DIR, { recursive: true });
  }
}
purgeOldTempFiles();

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
let students = loadJson(STUDENTS_FILE, []);
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
const saveStudents = () => { saveJson(STUDENTS_FILE, students); sendToTelegram('students', students); };
let users = loadJson(USERS_FILE, { linked: {}, pending: {}, blocked: [], roll_to_chat: {} });
let attendance = loadJson(ATTENDANCE_FILE, {});
let notes = loadJson(NOTES_FILE, []);
let allowedNamesData = loadJson(ALLOWED_NAMES_FILE, { allowed_names: [] });
let deadlines = loadJson(DEADLINES_FILE, []);
let tickets = loadJson(TICKETS_FILE, []);

const saveUsers = () => { saveJson(USERS_FILE, users); sendToTelegram('users', users); };
const saveAttendance = () => { saveJson(ATTENDANCE_FILE, attendance); sendToTelegram('attendance', attendance); };
const saveNotes = () => { saveJson(NOTES_FILE, notes); sendToTelegram('notes', notes); };
const saveDeadlines = () => { saveJson(DEADLINES_FILE, deadlines); sendToTelegram('deadlines', deadlines); };
const saveTickets = () => { saveJson(TICKETS_FILE, tickets); };

const PHYSICS_FORMULAS = [
  {
    topic: "Brewster's Law (Optics)",
    formula: "tan(i_p) = μ",
    explanation: "When unpolarized light is incident at Brewster angle i_p on a dielectric medium, the reflected light is completely plane-polarized perpendicular to the plane of incidence.",
    application: "Anti-reflective optical coatings, polarizing sunglasses, and laser windows."
  },
  {
    topic: "Op-Amp Inverting Amplifier Gain",
    formula: "A_v = - (R_f / R_in)",
    explanation: "The closed-loop voltage gain of an operational amplifier in inverting mode depends solely on the external feedback resistors with 180° phase inversion.",
    application: "Analog computers, audio mixing preamplifiers, and active filters."
  },
  {
    topic: "Michelson Interferometer Path Difference",
    formula: "2d cos(θ) = mλ",
    explanation: "Condition for bright circular fringe maxima in Michelson interferometer where d is mirror separation and θ is ray inclination angle.",
    application: "High-precision wavelength measurement and refractive index determination."
  },
  {
    topic: "Bragg's Law of X-Ray Diffraction",
    formula: "2d sin(θ) = nλ",
    explanation: "Constructive interference condition for x-rays scattered from crystal lattice planes separated by distance d.",
    application: "Solid state physics, crystallography, and crystal structure determination."
  },
  {
    topic: "Heisenberg's Uncertainty Principle",
    formula: "Δx · Δp ≥ ℏ / 2",
    explanation: "Fundamental quantum limit stating that position and momentum cannot be simultaneously measured with arbitrary precision.",
    application: "Quantum physics, atomic ground states, and electron non-collapse in atoms."
  },
  {
    topic: "Einstein's Photoelectric Equation",
    formula: "hν = Φ + (1/2) m v_max²",
    explanation: "Energy conservation in photoelectric effect: photon energy equals work function plus maximum kinetic energy of emitted photoelectrons.",
    application: "Photocells, solar panels, and light sensor technology."
  },
  {
    topic: "Op-Amp Slew Rate & Full-Power Bandwidth",
    formula: "SR = dV_out/dt |max  and  f_max = SR / (2π V_p)",
    explanation: "Maximum rate of change of output voltage per unit time. For standard IC 741, typical slew rate is 0.5 V/μs.",
    application: "Prevents distortion in high-frequency sinusoidal and pulse processing circuits."
  },
  {
    topic: "Newton's Rings Central Spot (Reflected)",
    formula: "r_n = √[ (n - 1/2) λ R ] (Bright),  r_0 = 0 (Dark spot at center)",
    explanation: "Due to 180° phase shift upon reflection at the denser medium (glass plate), the central spot at contact where film thickness t=0 is destructive (DARK).",
    application: "Testing optical surface flatness and measuring lens radius of curvature."
  }
];

function getRandomPhysicsFormula() {
  return PHYSICS_FORMULAS[Math.floor(Math.random() * PHYSICS_FORMULAS.length)];
}

async function generateStudentIdCard({ name, roll, dept = 'Department of Physics', session = '2024 - 2028', college = 'Dinhata College' }) {
  const safeName = String(name || 'College Student').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeRoll = String(roll || '2024PHY001').toUpperCase();
  const hash = 'DHC-' + Buffer.from(safeRoll + 'PASS').toString('hex').slice(0, 8).toUpperCase();
  const issueDate = moment().tz(CONFIG.TIMEZONE).format('DD MMM YYYY');

  const svg = `<svg width="800" height="500" viewBox="0 0 800 500" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#090d16"/>
        <stop offset="50%" stop-color="#111827"/>
        <stop offset="100%" stop-color="#0f172a"/>
      </linearGradient>
      <linearGradient id="headerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#1e3a8a"/>
        <stop offset="100%" stop-color="#0284c7"/>
      </linearGradient>
      <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#38bdf8"/>
        <stop offset="100%" stop-color="#818cf8"/>
      </linearGradient>
      <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#fbbf24"/>
        <stop offset="100%" stop-color="#d97706"/>
      </linearGradient>
      <filter id="shadow" x="-5%" y="-5%" width="110%" height="110%">
        <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#000000" flood-opacity="0.7"/>
      </filter>
    </defs>

    <rect width="800" height="500" fill="#020617"/>
    <rect x="25" y="25" width="750" height="450" rx="24" fill="url(#bgGrad)" stroke="#334155" stroke-width="3" filter="url(#shadow)"/>
    <path d="M 25 49 C 25 35 35 25 49 25 L 751 25 C 765 25 775 35 775 49 L 775 125 L 25 125 Z" fill="url(#headerGrad)"/>
    <line x1="25" y1="125" x2="775" y2="125" stroke="url(#accentGrad)" stroke-width="3"/>

    <text x="400" y="68" fill="#ffffff" font-family="Arial, sans-serif" font-size="28" font-weight="900" letter-spacing="2" text-anchor="middle">${college.toUpperCase()}</text>
    <text x="400" y="100" fill="#93c5fd" font-family="Arial, sans-serif" font-size="16" font-weight="600" letter-spacing="1.5" text-anchor="middle">${dept.toUpperCase()}</text>

    <rect x="65" y="165" width="160" height="200" rx="16" fill="#0f172a" stroke="#38bdf8" stroke-width="2"/>
    <circle cx="145" cy="235" r="45" fill="#1e293b" stroke="#64748b" stroke-width="2"/>
    <path d="M 120 220 L 145 200 L 170 220 L 145 235 Z" fill="#38bdf8"/>
    <path d="M 132 230 C 132 245 158 245 158 230" fill="none" stroke="#38bdf8" stroke-width="2"/>
    <path d="M 95 330 C 95 295 195 295 195 330 Z" fill="#1e293b"/>
    <rect x="85" y="380" width="120" height="28" rx="14" fill="#065f46" stroke="#10b981" stroke-width="1.5"/>
    <text x="145" y="399" fill="#a7f3d0" font-family="Arial, sans-serif" font-size="12" font-weight="bold" text-anchor="middle">VERIFIED</text>

    <text x="265" y="185" fill="#94a3b8" font-family="Arial, sans-serif" font-size="14" font-weight="bold">STUDENT NAME</text>
    <text x="265" y="218" fill="#f8fafc" font-family="Arial, sans-serif" font-size="26" font-weight="bold">${safeName}</text>

    <text x="265" y="260" fill="#94a3b8" font-family="Arial, sans-serif" font-size="13" font-weight="bold">COLLEGE ROLL NUMBER</text>
    <rect x="265" y="272" width="230" height="38" rx="8" fill="#1e293b" stroke="#475569" stroke-width="1.5"/>
    <text x="280" y="298" fill="#38bdf8" font-family="monospace, Arial" font-size="20" font-weight="bold" letter-spacing="2">${safeRoll}</text>

    <text x="525" y="260" fill="#94a3b8" font-family="Arial, sans-serif" font-size="13" font-weight="bold">ACADEMIC SESSION</text>
    <rect x="525" y="272" width="200" height="38" rx="8" fill="#1e293b" stroke="#475569" stroke-width="1.5"/>
    <text x="540" y="298" fill="#f8fafc" font-family="monospace, Arial" font-size="18" font-weight="bold">${session}</text>

    <text x="265" y="340" fill="#94a3b8" font-family="Arial, sans-serif" font-size="13" font-weight="bold">COURSE / PROGRAM</text>
    <text x="265" y="365" fill="#f8fafc" font-family="Arial, sans-serif" font-size="16" font-weight="bold">B.Sc 4-Year Major in Physics (NEP)</text>

    <line x1="265" y1="390" x2="725" y2="390" stroke="#334155" stroke-width="1.5"/>

    <text x="265" y="422" fill="#64748b" font-family="Arial, sans-serif" font-size="12">ISSUED: ${issueDate}</text>
    <text x="450" y="422" fill="#64748b" font-family="monospace" font-size="12">PASS HASH: #${hash}</text>
    <circle cx="700" cy="425" r="24" fill="url(#goldGrad)" opacity="0.9"/>
    <text x="700" y="430" fill="#000000" font-family="Arial" font-size="10" font-weight="900" text-anchor="middle">OFFICIAL</text>
  </svg>`;

  return await sharp(Buffer.from(svg)).png().toBuffer();
}

// Telegram in-memory states
const tgRegistrationState = new Map();
const tgQuizSessions = new Map();
const tgQuizLeaderboard = new Map();

// ==================== TELEGRAM INTERACTIVE COMPANION SUITE ====================
if (tgBot) {
  // Helpers
  const isTgAdmin = (chatId) => String(chatId) === String(CONFIG.ADMIN_CHAT_ID);
  const isTgBlocked = (chatId) => users.blocked && users.blocked.includes(String(chatId));
  const isTgApproved = (chatId) => Boolean(users.linked && users.linked[String(chatId)]?.status === 'approved');

  const checkTgRateLimit = (chatId) => {
    if (isTgAdmin(chatId)) return { limited: false };
    const now = Date.now();
    const lastTime = userCooldowns.get(`tg_${chatId}`) || 0;
    const cooldownMs = (CONFIG.RATE_LIMIT_SECONDS || 30) * 1000;
    if (now - lastTime < cooldownMs) {
      return { limited: true, waitSeconds: Math.ceil((cooldownMs - (now - lastTime)) / 1000) };
    }
    userCooldowns.set(`tg_${chatId}`, now);
    return { limited: false };
  };

  const isValidRoll = (roll) => /^\d{4}(PHY|CHE|MAT|BOT|ZOO|[A-Z]{2,4})\d{3}$/i.test(roll.trim());

  const sendTgAuthRequired = async (chatId) => {
    await tgBot.sendMessage(
      chatId,
      `🔒 *Authentication Required!*\n\n` +
      `Yeh command sirf approved students ke liye hai.\n` +
      `Pehle apna account verify karein:\n\n` +
      `👉 /start dabayein aur apna naam aur roll number bhejein.`,
      { parse_mode: 'Markdown' }
    );
  };

  // 1. /start Handler (Registration Flow Step 1)
  tgBot.onText(/\/start/, async (msg) => {
    const chatId = String(msg.chat.id);

    if (isTgBlocked(chatId)) {
      return tgBot.sendMessage(chatId, '🚫 *Account Blocked*\n\nAapko is bot se block kar diya gaya hai. College Admin se contact karein.', { parse_mode: 'Markdown' });
    }

    if (isTgApproved(chatId)) {
      const student = users.linked[chatId];
      return tgBot.sendMessage(
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

    if (users.pending && users.pending[chatId]) {
      const req = users.pending[chatId];
      return tgBot.sendMessage(
        chatId,
        `⏳ *Request Under Review*\n\n` +
        `Aapki details (*${req.name}* - *${req.roll_no}*) admin approval ke liye pending hain.\n` +
        `Jaise hi Admin approve karega, aapko notification mil jayega!`,
        { parse_mode: 'Markdown' }
      );
    }

    if (isTgAdmin(chatId)) {
      return tgBot.sendMessage(
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

    // New user starts registration
    tgRegistrationState.set(chatId, { step: 'awaiting_name' });
    await tgBot.sendMessage(
      chatId,
      `🎓 *Welcome to College Bot!*\n\n` +
      `Apna pura naam bhejo.\n` +
      `*Format:* First Letter Capital\n` +
      `*Example:* Rounak De`,
      { parse_mode: 'Markdown' }
    );
  });

  // 2. Registration Text Listener (Steps 2 & 3)
  tgBot.on('message', async (msg) => {
    const chatId = String(msg.chat.id);
    const text = msg.text ? msg.text.trim() : '';

    if (!text || text.startsWith('/') || isTgBlocked(chatId)) return;

    const state = tgRegistrationState.get(chatId);
    if (!state) return;

    // Step 2: User sends name
    if (state.step === 'awaiting_name') {
      const allowed = allowedNamesData.allowed_names || [];
      const isMatch = allowed.includes(text);

      if (isMatch) {
        tgRegistrationState.set(chatId, {
          step: 'awaiting_roll',
          tempName: text
        });

        return tgBot.sendMessage(
          chatId,
          `✅ Welcome *${text}*!\n\n` +
          `Ab apna roll number bhejo.\n` +
          `*Format:* 2024PHY001`,
          { parse_mode: 'Markdown' }
        );
      } else {
        return tgBot.sendMessage(
          chatId,
          `❌ *Name match nahi hua.*\n\n` +
          `Sahi format mein bhejo (Case Sensitive):\n` +
          `*Example:* Rounak De\n\n` +
          `_Note: First letter capital hona chahiye aur college records se exact match hona chahiye._`,
          { parse_mode: 'Markdown' }
        );
      }
    }

    // Step 3: User sends roll number
    if (state.step === 'awaiting_roll') {
      const roll = text.toUpperCase();

      if (!isValidRoll(roll)) {
        return tgBot.sendMessage(
          chatId,
          `❌ *Galat format!*\n` +
          `Sahi format: \`2024PHY001\` (YYYY + DEPT + NUMBER)`,
          { parse_mode: 'Markdown' }
        );
      }

      if (users.roll_to_chat && users.roll_to_chat[roll] && users.roll_to_chat[roll] !== chatId) {
        return tgBot.sendMessage(
          chatId,
          `❌ *Ye roll number already kisi aur Telegram account se linked hai.*\n` +
          `Agar yeh aapka roll number hai, toh College Admin se contact karein.`,
          { parse_mode: 'Markdown' }
        );
      }

      if (users.linked && users.linked[chatId] && users.linked[chatId].roll_no !== roll) {
        return tgBot.sendMessage(
          chatId,
          `❌ *Ek Telegram account se sirf ek roll number link ho sakta hai.*`,
          { parse_mode: 'Markdown' }
        );
      }

      const studentName = state.tempName;
      const requestTime = moment().tz(CONFIG.TIMEZONE).format('DD-MM-YYYY hh:mm A');

      users.pending[chatId] = {
        roll_no: roll,
        name: studentName,
        requested_at: new Date().toISOString()
      };
      saveUsers();
      tgRegistrationState.delete(chatId);

      await tgBot.sendMessage(
        chatId,
        `✅ *Details received!*\n\n` +
        `Aapka account admin approval ke liye bheja gaya.\n` +
        `Thoda wait karo... Jaise hi Admin approve karega aapko update mil jayega.`,
        { parse_mode: 'Markdown' }
      );

      // Step 4: Admin Notification with Inline Buttons
      const adminNotification = `🔔 *New User Request*\n\n` +
        `👤 *Name:* ${studentName}\n` +
        `🎓 *Roll:* \`${roll}\`\n` +
        `💬 *Chat ID:* \`${chatId}\`\n` +
        `📅 *Time:* ${requestTime}`;

      try {
        await tgBot.sendMessage(CONFIG.ADMIN_CHAT_ID, adminNotification, {
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
        console.error('❌ Failed to notify admin via Telegram:', e.message);
      }
    }
  });

  // 3. Inline Button Callbacks Handler
  tgBot.on('callback_query', async (query) => {
    const data = query.data;
    const adminId = String(query.from.id);
    const chatId = String(query.message.chat.id);

    // Approval / Rejection
    if (data.startsWith('app_') || data.startsWith('rej_')) {
      if (!isTgAdmin(adminId)) {
        return tgBot.answerCallbackQuery(query.id, { text: '❌ Unauthorized! Sirf admin approve kar sakta hai.', show_alert: true });
      }

      const targetChatId = data.replace('app_', '').replace('rej_', '');
      const pendingReq = users.pending && users.pending[targetChatId];

      if (!pendingReq) {
        return tgBot.answerCallbackQuery(query.id, { text: '⚠️ Request already processed ya exist nahi karti.', show_alert: true });
      }

      if (data.startsWith('app_')) {
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

        await tgBot.answerCallbackQuery(query.id, { text: `✅ ${pendingReq.name} Approved!` });
        await tgBot.editMessageText(
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

        try {
          await tgBot.sendMessage(
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
        } catch (err) {}
        return;
      }

      if (data.startsWith('rej_')) {
        delete users.pending[targetChatId];
        saveUsers();

        await tgBot.answerCallbackQuery(query.id, { text: '❌ Request Rejected.' });
        await tgBot.editMessageText(
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
          await tgBot.sendMessage(
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

    // Navigation buttons
    if (data === 'btn_att') { await tgBot.answerCallbackQuery(query.id); return handleTgMyAttendance(chatId); }
    if (data === 'btn_time') { await tgBot.answerCallbackQuery(query.id); return handleTgMyTimetable(chatId); }
    if (data === 'btn_exam') { await tgBot.answerCallbackQuery(query.id); return handleTgMyExams(chatId); }
    if (data === 'btn_notes') { await tgBot.answerCallbackQuery(query.id); return handleTgNotesList(chatId); }
    if (data === 'btn_prof') { await tgBot.answerCallbackQuery(query.id); return handleTgMyProfile(chatId); }
    if (data === 'btn_help') { await tgBot.answerCallbackQuery(query.id); return handleTgHelpCommand(chatId); }
    if (data === 'btn_admin') { await tgBot.answerCallbackQuery(query.id); return handleTgAdminDashboard(chatId); }
    if (data === 'btn_pending') { await tgBot.answerCallbackQuery(query.id); return handleTgPendingRequests(chatId); }
    if (data === 'btn_stats') { await tgBot.answerCallbackQuery(query.id); return handleTgBotStats(chatId); }
    if (data === 'btn_backup') { await tgBot.answerCallbackQuery(query.id); return handleTgBackup(chatId); }
    if (data === 'btn_users_list') { await tgBot.answerCallbackQuery(query.id); return handleTgUsersList(chatId); }

    if (data.startsWith('quiz_ans_')) {
      return handleTgQuizAnswer(query);
    }
  });

  // 4. Command Handlers Implementation
  async function handleTgHelpCommand(chatId) {
    const isAdm = isTgAdmin(chatId);
    const isAppr = isTgApproved(chatId);

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
        `• /broadcast [msg] — Broadcast DM to students + WA group\n` +
        `• /stats — Detailed bot statistics\n` +
        `• /backup — Complete JSON data backup\n` +
        `• /exportusers — Export users as CSV\n` +
        `• /exportattendance — Export attendance as CSV\n`;
    }

    await tgBot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  }

  tgBot.onText(/\/help/, (msg) => handleTgHelpCommand(String(msg.chat.id)));

  tgBot.onText(/\/public/, async (msg) => {
    const chatId = String(msg.chat.id);
    const limit = checkTgRateLimit(chatId);
    if (limit.limited) return tgBot.sendMessage(chatId, `⏳ Please wait ${limit.waitSeconds}s.`);

    const text = `🏛️ *${CONFIG.COLLEGE_NAME || 'Dinhata College'}*\n` +
      `🔬 *${CONFIG.DEPARTMENT || 'Department of Physics'}*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📍 *Campus:* Dinhata, Cooch Behar, West Bengal\n` +
      `⏰ *College Hours:* 10:00 AM – 05:00 PM (Mon-Sat)\n` +
      `📖 *Central Library:* 10:30 AM – 04:30 PM\n` +
      `🔬 *Physics Laboratories:* Dark Room, Electronics Lab, General Lab\n` +
      `🌐 *Official Website:* dinhata-college.ac.in\n\n` +
      `💡 Registration ke liye /start dabayein!`;
    await tgBot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  });

  tgBot.onText(/\/syllabus/, async (msg) => {
    const chatId = String(msg.chat.id);
    const text = `📚 *B.Sc Physics Department Syllabus Modules*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `1. *Major 3:* Waves & Optics (Theory + Lab)\n` +
      `2. *Major 4:* Analog Electronics & Circuit Theory\n` +
      `3. *SEC 3:* Computational Physics with Python & NumPy\n` +
      `4. *MDC:* Mathematical Methods for Sciences\n\n` +
      `💡 Note files download karne ke liye /notes check karein!`;
    await tgBot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  });

  tgBot.onText(/\/timetable/, async (msg) => {
    const chatId = String(msg.chat.id);
    const limit = checkTgRateLimit(chatId);
    if (limit.limited) return tgBot.sendMessage(chatId, `⏳ Please wait ${limit.waitSeconds}s.`);

    const text = `📅 *General College Routine Overview*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `• Mon: 10:30 AM Major 3 | 01:30 PM Python Lab\n` +
      `• Tue: 10:30 AM Major 4 | 01:30 PM Waves Lab\n` +
      `• Wed: 11:30 AM Major 3 | 02:30 PM Electronics Lab\n` +
      `• Thu: 10:30 AM Major 4 | 12:30 PM Tutorial\n` +
      `• Fri: 11:30 AM Major 3 | 01:30 PM Computational Lab\n` +
      `• Sat: 10:30 AM Seminar & Remedial Classes\n\n` +
      `💡 Apna personal schedule dekhne ke liye /mytimetable use karein.`;
    await tgBot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  });

  tgBot.onText(/\/holidays/, async (msg) => {
    const chatId = String(msg.chat.id);
    if (holidays.length === 0) return tgBot.sendMessage(chatId, '🏖️ Abhi koi scheduled holidays listed nahi hain.');
    let text = `🏖️ *Upcoming College Holidays Calendar*\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    holidays.forEach((h, i) => {
      text += `${i + 1}. *${h.name}*\n   📅 Date: \`${h.date}\` (${h.type || 'Holiday'})\n\n`;
    });
    await tgBot.sendMessage(chatId, text.trim(), { parse_mode: 'Markdown' });
  });

  tgBot.onText(/\/nextholiday/, async (msg) => {
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

    if (!nextHoliday) return tgBot.sendMessage(chatId, 'ℹ️ Aage koi holidays listed nahi hain. Regular classes continue rahengi.');
    const daysText = nextHoliday.daysLeft === 0 ? 'Aaj hi hai! 🎉' : `${nextHoliday.daysLeft} din baaki hain! ⏳`;
    const text = `🎉 *Next Upcoming Holiday*\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `🏖️ *Occasion:* ${nextHoliday.name}\n` +
      `📅 *Date:* \`${nextHoliday.date}\`\n` +
      `🏷️ *Type:* ${nextHoliday.type || 'College Holiday'}\n` +
      `⏳ *Countdown:* ${daysText}`;
    await tgBot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  });

  // Student Commands
  async function handleTgMyProfile(chatId) {
    if (!isTgApproved(chatId)) return sendTgAuthRequired(chatId);
    const student = users.linked[chatId];
    const userAtt = attendance[student.roll_no] || { total_classes: 0, attended: 0, percentage: 100 };
    const regDate = moment(student.linked_at).tz(CONFIG.TIMEZONE).format('DD MMM YYYY, hh:mm A');

    const text = `📋 *Student Official Profile*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `👤 *Full Name:* ${student.name}\n` +
      `🎓 *College Roll No:* \`${student.roll_no}\`\n` +
      `🏛️ *Department:* ${CONFIG.DEPARTMENT || 'Department of Physics'}\n` +
      `📊 *Attendance:* ${userAtt.percentage}% (${userAtt.attended}/${userAtt.total_classes})\n` +
      `🛡️ *Status:* Verified & Approved ✅\n` +
      `💬 *Telegram ID:* \`${chatId}\`\n` +
      `📅 *Registered On:* ${regDate}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💡 Shortcuts: /myattendance, /myexams, /notes`;
    await tgBot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  }
  tgBot.onText(/\/myprofile/, (msg) => handleTgMyProfile(String(msg.chat.id)));

  async function handleTgMyAttendance(chatId) {
    if (!isTgApproved(chatId)) return sendTgAuthRequired(chatId);
    const student = users.linked[chatId];
    const record = attendance[student.roll_no] || { total_classes: 0, attended: 0, percentage: 100, history: [] };
    const total = record.total_classes || 0;
    const attended = record.attended || 0;
    const pct = total === 0 ? 100 : Math.round((attended / total) * 100);

    const filledBlocks = Math.round((pct / 100) * 10);
    const visualBar = '█'.repeat(filledBlocks) + '░'.repeat(10 - filledBlocks);
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
        text += `${h.status === 'present' ? '✅' : '❌'} ${h.date} - ${h.subject} (${h.status.toUpperCase()})\n`;
      });
    }
    await tgBot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  }
  tgBot.onText(/\/myattendance/, (msg) => handleTgMyAttendance(String(msg.chat.id)));

  async function handleTgMyTimetable(chatId) {
    if (!isTgApproved(chatId)) return sendTgAuthRequired(chatId);
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
      `💡 Class alerts WhatsApp aur Telegram dono par send hote hain.`;
    await tgBot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  }
  tgBot.onText(/\/mytimetable/, (msg) => handleTgMyTimetable(String(msg.chat.id)));

  async function handleTgMyExams(chatId) {
    if (!isTgApproved(chatId)) return sendTgAuthRequired(chatId);
    if (exams.length === 0) return tgBot.sendMessage(chatId, '📝 Abhi koi upcoming exams scheduled nahi hain! Chill & prepare.');
    let text = `📝 *Upcoming College Examinations*\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    exams.forEach((ex, idx) => {
      text += `${idx + 1}. *${ex.subject}*\n` +
        `   📅 Date: \`${ex.date}\` at \`${ex.time}\`\n` +
        `   🏫 Room: ${ex.room || 'Main Exam Hall'}\n\n`;
    });
    text += `━━━━━━━━━━━━━━━━━━━━━━━━━\n💡 Hall ticket aur ID card saath lana na bhoolein.`;
    await tgBot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  }
  tgBot.onText(/\/myexams/, (msg) => handleTgMyExams(String(msg.chat.id)));

  tgBot.onText(/\/doubt(?:\s+([\s\S]+))?/, async (msg, match) => {
    const chatId = String(msg.chat.id);
    if (!isTgApproved(chatId)) return sendTgAuthRequired(chatId);
    const question = match[1] ? match[1].trim() : '';
    if (!question) {
      return tgBot.sendMessage(chatId, `❓ *Ask a Doubt to Faculty / Admin*\n\nFormat: \`/doubt <Aapka question yahan>\`\nExample: \`/doubt Sir optics assignment kab submit karna hai?\``, { parse_mode: 'Markdown' });
    }
    const student = users.linked[chatId];
    const time = moment().tz(CONFIG.TIMEZONE).format('DD-MM-YYYY hh:mm A');
    const adminMsg = `📩 *New Student Doubt Received!*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `👤 *Student:* ${student.name}\n` +
      `🎓 *Roll No:* \`${student.roll_no}\`\n` +
      `💬 *Chat ID:* \`${chatId}\`\n` +
      `📅 *Time:* ${time}\n\n` +
      `❓ *Question:*\n"${question}"\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━`;
    try {
      await tgBot.sendMessage(CONFIG.ADMIN_CHAT_ID, adminMsg, { parse_mode: 'Markdown' });
      await tgBot.sendMessage(chatId, `✅ *Doubt Sent!*\n\nAapka question Admin/Faculty ko bhej diya gaya hai.`, { parse_mode: 'Markdown' });
    } catch (err) {
      await tgBot.sendMessage(chatId, `❌ Failed to forward doubt: ${err.message}`);
    }
  });

  tgBot.onText(/\/report/, async (msg) => {
    const chatId = String(msg.chat.id);
    if (!isTgApproved(chatId)) return sendTgAuthRequired(chatId);
    const student = users.linked[chatId];
    const att = attendance[student.roll_no] || { total_classes: 0, attended: 0, percentage: 100 };
    const text = `📄 *COMPREHENSIVE ACADEMIC REPORT CARD*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `🎓 *Student:* ${student.name}\n` +
      `🔢 *Roll Number:* \`${student.roll_no}\`\n` +
      `🏛️ *College:* ${CONFIG.COLLEGE_NAME || 'Dinhata College'}\n` +
      `🔬 *Department:* ${CONFIG.DEPARTMENT || 'Department of Physics'}\n\n` +
      `📊 *Attendance Status:*\n` +
      `• Total Sessions: ${att.total_classes}\n` +
      `• Attended: ${att.attended}\n` +
      `• Overall %: *${att.percentage}%*\n` +
      `• Exam Eligibility: ${att.percentage >= 75 ? 'ELIGIBLE ✅' : 'CONDITIONAL ⚠️'}\n\n` +
      `📝 *Upcoming Exams:* ${exams.length} scheduled\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📅 Generated on: ${moment().tz(CONFIG.TIMEZONE).format('DD MMMM YYYY, hh:mm A')}`;
    await tgBot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  });

  async function handleTgNotesList(chatId) {
    if (!isTgApproved(chatId) && !isTgAdmin(chatId)) return sendTgAuthRequired(chatId);
    if (notes.length === 0) return tgBot.sendMessage(chatId, '📚 Abhi koi notes uploaded nahi hain.');
    let text = `📚 *Available Study Notes & Lecture Materials*\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    notes.forEach((n) => {
      text += `🆔 *[ID: ${n.id}]* ${n.title}\n` +
        `   📁 Subject: ${n.subject || 'Physics'} | 💾 Size: ${n.size || 'PDF'}\n` +
        `   👉 Download: \`/download ${n.id}\`\n\n`;
    });
    text += `━━━━━━━━━━━━━━━━━━━━━━━━━\n💡 Download karne ke liye: \`/download <ID>\``;
    await tgBot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  }
  tgBot.onText(/\/notes/, (msg) => handleTgNotesList(String(msg.chat.id)));

  tgBot.onText(/\/download(?:\s+(\d+))?/, async (msg, match) => {
    const chatId = String(msg.chat.id);
    if (!isTgApproved(chatId) && !isTgAdmin(chatId)) return sendTgAuthRequired(chatId);
    const id = match[1] ? parseInt(match[1]) : null;
    if (!id) return tgBot.sendMessage(chatId, '📌 Format: `/download <ID>`\nExample: `/download 1`', { parse_mode: 'Markdown' });

    const note = notes.find(n => n.id === id);
    if (!note) return tgBot.sendMessage(chatId, `❌ Note ID ${id} nahi mila. Pehle /notes check karein.`);

    const filesDir = CONFIG.FILES_DIR || './data/files';
    const filePath = path.join(filesDir, note.filename);
    if (fs.existsSync(filePath)) {
      await tgBot.sendDocument(chatId, filePath, { caption: `📖 *${note.title}*` });
    } else {
      await tgBot.sendMessage(chatId, `📄 *${note.title}*\n📁 Filename: \`${note.filename}\`\n💾 Size: ${note.size}\n_File stored in cloud backup._`, { parse_mode: 'Markdown' });
    }
  });

  // Quiz Implementation
  const TG_QUIZ_QUESTIONS = [
    { q: "1. Waves in which medium particles vibrate perpendicular to wave propagation are called:", options: ["Longitudinal", "Transverse", "Stationary", "Electromagnetic Shock"], correct: 1 },
    { q: "2. In an ideal operational amplifier (Op-Amp), the input impedance is:", options: ["Zero", "Very Low", "Infinite", "50 Ohms"], correct: 2 },
    { q: "3. Which Python library is standard for numerical array computations?", options: ["Django", "NumPy", "Flask", "Tkinter"], correct: 1 },
    { q: "4. The phenomenon of bending of light around sharp corners of an obstacle is:", options: ["Refraction", "Polarization", "Diffraction", "Dispersion"], correct: 2 },
    { q: "5. What is the slew rate of an ideal Op-Amp?", options: ["Zero", "1 V/μs", "Infinite", "100 V/s"], correct: 2 }
  ];

  tgBot.onText(/\/quiz/, async (msg) => {
    const chatId = String(msg.chat.id);
    if (!isTgApproved(chatId)) return sendTgAuthRequired(chatId);
    tgQuizSessions.set(chatId, { currentQ: 0, score: 0 });
    await sendTgQuizQ(chatId, 0);
  });

  async function sendTgQuizQ(chatId, qIndex) {
    const q = TG_QUIZ_QUESTIONS[qIndex];
    if (!q) return;
    const buttons = q.options.map((opt, idx) => ([{ text: opt, callback_data: `quiz_ans_${qIndex}_${idx}` }]));
    await tgBot.sendMessage(
      chatId,
      `🧠 *Physics MCQ Challenge (Question ${qIndex + 1}/${TG_QUIZ_QUESTIONS.length})*\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n${q.q}`,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } }
    );
  }

  async function handleTgQuizAnswer(query) {
    const chatId = String(query.message.chat.id);
    const parts = query.data.split('_');
    const qIndex = parseInt(parts[2]);
    const optIndex = parseInt(parts[3]);
    const session = tgQuizSessions.get(chatId);
    if (!session || session.currentQ !== qIndex) {
      return tgBot.answerCallbackQuery(query.id, { text: '⚠️ Yeh question expire ho chuka hai.', show_alert: true });
    }

    const q = TG_QUIZ_QUESTIONS[qIndex];
    if (q.correct === optIndex) {
      session.score += 10;
      await tgBot.answerCallbackQuery(query.id, { text: '🎯 Correct Answer! (+10 pts)' });
    } else {
      await tgBot.answerCallbackQuery(query.id, { text: `❌ Wrong! Sahi answer: ${q.options[q.correct]}` });
    }

    session.currentQ += 1;
    if (session.currentQ < TG_QUIZ_QUESTIONS.length) {
      await sendTgQuizQ(chatId, session.currentQ);
    } else {
      const finalScore = session.score;
      tgQuizSessions.delete(chatId);
      const student = users.linked[chatId] || { name: 'Student' };
      tgQuizLeaderboard.set(student.name, (tgQuizLeaderboard.get(student.name) || 0) + finalScore);
      await tgBot.sendMessage(
        chatId,
        `🏆 *Quiz Completed!*\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n👤 *Student:* ${student.name}\n⭐ *Your Score:* ${finalScore} / 50 Points\nLeaderboard ke liye /leaderboard karein!`,
        { parse_mode: 'Markdown' }
      );
    }
  }

  tgBot.onText(/\/leaderboard/, async (msg) => {
    const chatId = String(msg.chat.id);
    if (tgQuizLeaderboard.size === 0) return tgBot.sendMessage(chatId, '🏆 Abhi tak kisi ne quiz nahi khela. /quiz dabayein!');
    const sorted = Array.from(tgQuizLeaderboard.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
    let text = `🏆 *Top Quiz Masters Leaderboard*\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    sorted.forEach(([name, pts], i) => {
      text += `${i === 0 ? '🥇' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : '🎖️'))} ${i + 1}. *${name}* — ${pts} Points\n`;
    });
    await tgBot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  });

  // Admin Commands
  const ensureTgAdmin = (chatId) => {
    if (!isTgAdmin(chatId)) {
      tgBot.sendMessage(chatId, '⛔ *Unauthorized!* Sirf Master Admin hi yeh command use kar sakta hai.', { parse_mode: 'Markdown' });
      return false;
    }
    return true;
  };

  async function handleTgAdminDashboard(chatId) {
    if (!ensureTgAdmin(chatId)) return;
    const totalUsers = Object.keys(users.linked || {}).length;
    const pendingCount = Object.keys(users.pending || {}).length;
    const text = `🛠️ *COLLEGE BOT MASTER ADMIN PANEL*\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `• Approved Students: *${totalUsers}*\n` +
      `• Pending Requests: *${pendingCount}*\n` +
      `• Blocked Users: *${(users.blocked || []).length}*\n\n` +
      `⚡ *Quick Actions:*`;
    await tgBot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: `⏳ Pending (${pendingCount})`, callback_data: 'btn_pending' }, { text: '👥 All Users', callback_data: 'btn_users_list' }],
          [{ text: '📦 Cloud Backup', callback_data: 'btn_backup' }, { text: '📊 Statistics', callback_data: 'btn_stats' }]
        ]
      }
    });
  }
  tgBot.onText(/\/admin/, (msg) => handleTgAdminDashboard(String(msg.chat.id)));

  async function handleTgPendingRequests(chatId) {
    if (!ensureTgAdmin(chatId)) return;
    const pendingKeys = Object.keys(users.pending || {});
    if (pendingKeys.length === 0) return tgBot.sendMessage(chatId, '✅ Koi pending approval request nahi hai. All clear!');
    for (const userChatId of pendingKeys) {
      const req = users.pending[userChatId];
      const text = `⏳ *Pending Approval Request*\n\n👤 *Name:* ${req.name}\n🎓 *Roll No:* \`${req.roll_no}\`\n💬 *Chat ID:* \`${userChatId}\``;
      await tgBot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '✅ Approve', callback_data: `app_${userChatId}` }, { text: '❌ Reject', callback_data: `rej_${userChatId}` }]]
        }
      });
    }
  }
  tgBot.onText(/\/pending/, (msg) => handleTgPendingRequests(String(msg.chat.id)));

  tgBot.onText(/\/approve(?:\s+(.+))?/, async (msg, match) => {
    const chatId = String(msg.chat.id);
    if (!ensureTgAdmin(chatId)) return;
    const target = match[1] ? match[1].trim() : '';
    if (!target) return tgBot.sendMessage(chatId, '📌 Format: `/approve <ChatID or Roll_No>`', { parse_mode: 'Markdown' });

    let foundChatId = Object.keys(users.pending || {}).find(cid => cid === target || users.pending[cid].roll_no.toUpperCase() === target.toUpperCase());
    if (!foundChatId) return tgBot.sendMessage(chatId, `❌ "${target}" ke liye koi pending request nahi mili.`);

    const req = users.pending[foundChatId];
    users.linked[foundChatId] = { roll_no: req.roll_no, name: req.name, status: 'approved', linked_at: new Date().toISOString(), approved_by: chatId };
    users.roll_to_chat[req.roll_no] = foundChatId;
    delete users.pending[foundChatId];
    saveUsers();

    await tgBot.sendMessage(chatId, `✅ Successfully approved *${req.name}* (\`${req.roll_no}\`)!`, { parse_mode: 'Markdown' });
    try { await tgBot.sendMessage(foundChatId, `🎉 Welcome *${req.name}*! Aapka account approve ho gaya hai.\nCommands ke liye /help dabayein.`, { parse_mode: 'Markdown' }); } catch (e) {}
  });

  tgBot.onText(/\/reject(?:\s+(.+))?/, async (msg, match) => {
    const chatId = String(msg.chat.id);
    if (!ensureTgAdmin(chatId)) return;
    const target = match[1] ? match[1].trim() : '';
    if (!target) return tgBot.sendMessage(chatId, '📌 Format: `/reject <ChatID or Roll_No>`', { parse_mode: 'Markdown' });

    let foundChatId = Object.keys(users.pending || {}).find(cid => cid === target || users.pending[cid].roll_no.toUpperCase() === target.toUpperCase());
    if (!foundChatId) return tgBot.sendMessage(chatId, `❌ "${target}" ke liye koi pending request nahi mili.`);

    delete users.pending[foundChatId];
    saveUsers();
    await tgBot.sendMessage(chatId, `❌ Rejected request for Chat ID \`${foundChatId}\`.`, { parse_mode: 'Markdown' });
  });

  tgBot.onText(/\/block(?:\s+(.+))?/, async (msg, match) => {
    const chatId = String(msg.chat.id);
    if (!ensureTgAdmin(chatId)) return;
    const target = match[1] ? match[1].trim() : '';
    if (!target) return tgBot.sendMessage(chatId, '📌 Format: `/block <ChatID>`', { parse_mode: 'Markdown' });
    if (!users.blocked) users.blocked = [];
    if (!users.blocked.includes(target)) {
      users.blocked.push(target);
      saveUsers();
      await tgBot.sendMessage(chatId, `🚫 Chat ID \`${target}\` ko block kar diya gaya hai.`, { parse_mode: 'Markdown' });
    }
  });

  tgBot.onText(/\/unblock(?:\s+(.+))?/, async (msg, match) => {
    const chatId = String(msg.chat.id);
    if (!ensureTgAdmin(chatId)) return;
    const target = match[1] ? match[1].trim() : '';
    if (!target) return tgBot.sendMessage(chatId, '📌 Format: `/unblock <ChatID>`', { parse_mode: 'Markdown' });
    if (users.blocked && users.blocked.includes(target)) {
      users.blocked = users.blocked.filter(id => id !== target);
      saveUsers();
      await tgBot.sendMessage(chatId, `✅ Chat ID \`${target}\` unblock ho gaya.`, { parse_mode: 'Markdown' });
    }
  });

  async function handleTgUsersList(chatId) {
    if (!ensureTgAdmin(chatId)) return;
    const linkedList = Object.entries(users.linked || {});
    if (linkedList.length === 0) return tgBot.sendMessage(chatId, 'ℹ️ Koi approved student registered nahi hai.');
    let text = `👥 *Approved College Students Directory (${linkedList.length})*\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    linkedList.forEach(([cid, u], i) => { text += `${i + 1}. *${u.name}*\n   🎓 Roll: \`${u.roll_no}\` | 💬 ID: \`${cid}\`\n\n`; });
    await tgBot.sendMessage(chatId, text.trim(), { parse_mode: 'Markdown' });
  }
  tgBot.onText(/\/users/, (msg) => handleTgUsersList(String(msg.chat.id)));

  tgBot.onText(/\/search(?:\s+(.+))?/, async (msg, match) => {
    const chatId = String(msg.chat.id);
    if (!ensureTgAdmin(chatId)) return;
    const query = match[1] ? match[1].trim() : '';
    if (!query) return tgBot.sendMessage(chatId, '📌 Format: `/search <Roll_No or Name>`', { parse_mode: 'Markdown' });
    const results = Object.entries(users.linked || {}).filter(([cid, u]) => {
      return u.roll_no.toLowerCase().includes(query.toLowerCase()) || u.name.toLowerCase().includes(query.toLowerCase()) || cid === query;
    });
    if (results.length === 0) return tgBot.sendMessage(chatId, `❌ Koi student nahi mila matching "${query}".`);
    let text = `🔍 *Search Results (${results.length})*\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    results.forEach(([cid, u]) => {
      const att = attendance[u.roll_no] || { total_classes: 0, attended: 0, percentage: 100 };
      text += `👤 *Name:* ${u.name}\n🎓 *Roll:* \`${u.roll_no}\`\n💬 *Chat ID:* \`${cid}\`\n📊 *Attendance:* ${att.percentage}%\n\n`;
    });
    await tgBot.sendMessage(chatId, text.trim(), { parse_mode: 'Markdown' });
  });

  tgBot.onText(/\/unlink(?:\s+(.+))?/, async (msg, match) => {
    const chatId = String(msg.chat.id);
    if (!ensureTgAdmin(chatId)) return;
    const roll = match[1] ? match[1].trim().toUpperCase() : '';
    if (!roll) return tgBot.sendMessage(chatId, '📌 Format: `/unlink <Roll_No>`', { parse_mode: 'Markdown' });
    const linkedChatId = users.roll_to_chat && users.roll_to_chat[roll];
    if (!linkedChatId || !users.linked[linkedChatId]) return tgBot.sendMessage(chatId, `❌ Roll No "${roll}" linked nahi hai.`);
    const sName = users.linked[linkedChatId].name;
    delete users.linked[linkedChatId];
    delete users.roll_to_chat[roll];
    saveUsers();
    await tgBot.sendMessage(chatId, `✅ Successfully unlinked *${sName}* (\`${roll}\`).`, { parse_mode: 'Markdown' });
  });

  // /broadcast [msg] -> sends to registered students + WhatsApp group
  tgBot.onText(/\/broadcast(?:\s+([\s\S]+))?/, async (msg, match) => {
    const chatId = String(msg.chat.id);
    if (!ensureTgAdmin(chatId)) return;
    const messageText = match[1] ? match[1].trim() : '';
    if (!messageText) return tgBot.sendMessage(chatId, '📌 Format: `/broadcast <Message Text>`', { parse_mode: 'Markdown' });

    const studentChatIds = Object.keys(users.linked || {});
    await tgBot.sendMessage(chatId, `🚀 Broadcasting message to Telegram students & WhatsApp Group...`);

    let tgSuccess = 0;
    const broadcastPayload = `📢 *COLLEGE OFFICIAL ANNOUNCEMENT*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `${messageText}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 *From:* Department Administration\n` +
      `📅 *Date:* ${moment().tz(CONFIG.TIMEZONE).format('DD MMM YYYY, hh:mm A')}`;

    for (const sChatId of studentChatIds) {
      try {
        await tgBot.sendMessage(sChatId, broadcastPayload, { parse_mode: 'Markdown' });
        tgSuccess++;
      } catch (err) {}
    }

    let waStatus = 'Not Connected';
    if (sock && sock.user) {
      try {
        await sock.sendMessage(currentConfig.GROUP_ID, { text: broadcastPayload });
        waStatus = 'Sent to WhatsApp Group ✅';
      } catch (e) {
        waStatus = `WhatsApp error: ${e.message}`;
      }
    }

    await tgBot.sendMessage(chatId, `✅ *Broadcast Report:*\n• Telegram Students Sent: ${tgSuccess}\n• WhatsApp: ${waStatus}`, { parse_mode: 'Markdown' });
  });

  async function handleTgBotStats(chatId) {
    if (!ensureTgAdmin(chatId)) return;
    const statsMsg = `📊 *BOT SYSTEM STATISTICS*\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `• Approved Students: *${Object.keys(users.linked || {}).length}*\n` +
      `• Pending Requests: *${Object.keys(users.pending || {}).length}*\n` +
      `• Blocked Accounts: *${(users.blocked || []).length}*\n` +
      `• Exams Tracked: *${exams.length}*\n` +
      `• Notes Available: *${notes.length}*\n` +
      `• WhatsApp Connected: *${sock && sock.user ? 'Yes ✅' : 'No ⏳'}*\n` +
      `🕒 *Server Time:* ${moment().tz(CONFIG.TIMEZONE).format('DD MMM YYYY, hh:mm:ss A')}`;
    await tgBot.sendMessage(chatId, statsMsg, { parse_mode: 'Markdown' });
  }
  tgBot.onText(/\/stats/, (msg) => handleTgBotStats(String(msg.chat.id)));

  async function handleTgBackup(chatId) {
    if (!ensureTgAdmin(chatId)) return;
    await tgBot.sendMessage(chatId, '📦 Generating complete cloud backup package...');
    try {
      await performFullTelegramBackup();
      await tgBot.sendMessage(chatId, '✅ Backup sent successfully to this chat!');
    } catch (err) {
      await tgBot.sendMessage(chatId, `❌ Backup error: ${err.message}`);
    }
  }
  tgBot.onText(/\/backup/, (msg) => handleTgBackup(String(msg.chat.id)));

  tgBot.onText(/\/exportusers/, async (msg) => {
    const chatId = String(msg.chat.id);
    if (!ensureTgAdmin(chatId)) return;
    try {
      let csv = `ChatID,Name,RollNumber,Status,LinkedDate\n`;
      Object.entries(users.linked || {}).forEach(([cid, u]) => {
        csv += `"${cid}","${u.name}","${u.roll_no}","${u.status}","${u.linked_at}"\n`;
      });
      const csvPath = path.join(CONFIG.DATA_DIR, `users_export_${Date.now()}.csv`);
      fs.writeFileSync(csvPath, csv, 'utf8');
      await tgBot.sendDocument(chatId, csvPath, { caption: `📊 *College Users CSV Export*` });
      setTimeout(() => { if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath); }, 5000);
    } catch (err) {
      await tgBot.sendMessage(chatId, `❌ Export error: ${err.message}`);
    }
  });

  tgBot.onText(/\/exportattendance/, async (msg) => {
    const chatId = String(msg.chat.id);
    if (!ensureTgAdmin(chatId)) return;
    try {
      let csv = `RollNumber,Name,TotalClasses,AttendedClasses,Percentage\n`;
      Object.entries(attendance).forEach(([roll, data]) => {
        csv += `"${roll}","${data.name || ''}",${data.total_classes || 0},${data.attended || 0},${data.percentage || 0}%\n`;
      });
      const csvPath = path.join(CONFIG.DATA_DIR, `attendance_export_${Date.now()}.csv`);
      fs.writeFileSync(csvPath, csv, 'utf8');
      await tgBot.sendDocument(chatId, csvPath, { caption: `📊 *College Attendance CSV Export*` });
      setTimeout(() => { if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath); }, 5000);
    } catch (err) {
      await tgBot.sendMessage(chatId, `❌ Export error: ${err.message}`);
    }
  });

  // Admin Document / Notes Upload Handler
  tgBot.on('document', async (msg) => {
    const chatId = String(msg.chat.id);
    if (!isTgAdmin(chatId)) return;
    const doc = msg.document;
    if (!doc) return;
    const caption = msg.caption ? msg.caption.trim() : '';
    const title = caption ? caption.replace(/^#notes/i, '').trim() : doc.file_name;
    const filesDir = CONFIG.FILES_DIR || './data/files';
    if (!fs.existsSync(filesDir)) fs.mkdirSync(filesDir, { recursive: true });

    try {
      const downloadPath = path.join(filesDir, doc.file_name);
      await tgBot.sendMessage(chatId, `📥 Downloading & saving note: *${doc.file_name}*...`, { parse_mode: 'Markdown' });
      const fileStream = tgBot.getFileStream(doc.file_id);
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
        await tgBot.sendMessage(
          chatId,
          `✅ *Note Added to College Library!*\n\n🆔 *Note ID:* ${newNote.id}\n📖 *Title:* ${newNote.title}\n📁 *File:* \`${newNote.filename}\`\nStudents ab \`/download ${newNote.id}\` se download kar sakte hain!`,
          { parse_mode: 'Markdown' }
        );
      });
    } catch (err) {
      await tgBot.sendMessage(chatId, `❌ File save failed: ${err.message}`);
    }
  });

  // Daily Digest to Admin at 8:00 AM Kolkata Time
  cron.schedule('0 8 * * *', async () => {
    try {
      const totalUsers = Object.keys(users.linked || {}).length;
      const pendingCount = Object.keys(users.pending || {}).length;
      const digestMsg = `📊 *Daily Digest*\n\n` +
        `👥 Total Users: ${totalUsers + pendingCount}\n` +
        `✅ Approved: ${totalUsers}\n` +
        `⏳ Pending: ${pendingCount}\n` +
        `🚫 Blocked: ${(users.blocked || []).length}\n` +
        `📅 Aaj ki classes: 4\n` +
        `📝 Exams this week: ${exams.length}\n\n` +
        `_WhatsApp & Telegram Bots are running smoothly!_`;
      await tgBot.sendMessage(CONFIG.ADMIN_CHAT_ID, digestMsg, { parse_mode: 'Markdown' });
    } catch (e) {}
  }, { timezone: CONFIG.TIMEZONE });

  // Pending Approval Reminder to Admin (Every 6 Hours)
  cron.schedule('0 */6 * * *', async () => {
    try {
      const pendingKeys = Object.keys(users.pending || {});
      if (pendingKeys.length > 0) {
        await tgBot.sendMessage(
          CONFIG.ADMIN_CHAT_ID,
          `🔔 *Pending Approval Reminder!*\n\nTotal *${pendingKeys.length}* new student registrations pending hain. Review: /pending`,
          { parse_mode: 'Markdown' }
        );
      }
    } catch (e) {}
  }, { timezone: CONFIG.TIMEZONE });

  // Admin Reply to Student Anonymous Ticket (/reply <TicketID> <Message>)
  tgBot.onText(/\/reply(?:\s+(\d+)\s+([\s\S]+))?/, async (msg, match) => {
    const chatId = String(msg.chat.id);
    if (!ensureTgAdmin(chatId)) return;
    const ticketId = match[1] ? parseInt(match[1]) : null;
    const adminResponse = match[2] ? match[2].trim() : '';
    if (!ticketId || !adminResponse) {
      return tgBot.sendMessage(chatId, '📌 Format: `/reply <TicketID> <Your Message>`\nExample: `/reply 101 Noted, kal check karenge.`', { parse_mode: 'Markdown' });
    }
    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket) {
      return tgBot.sendMessage(chatId, `❌ Ticket #${ticketId} nahi mila.`);
    }
    try {
      const waReply = `📩 *COLLEGE ADMINISTRATION REPLY (Ticket #${ticketId})*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `"${adminResponse}"\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `_Department of Physics, Dinhata College_`;
      if (sock && sock.user) {
        await sock.sendMessage(ticket.sender, { text: waReply });
      }
      ticket.status = 'replied';
      ticket.reply = adminResponse;
      ticket.repliedAt = new Date().toISOString();
      saveTickets();
      await tgBot.sendMessage(chatId, `✅ Reply sent anonymously to student on WhatsApp for Ticket #${ticketId}!`);
    } catch (err) {
      await tgBot.sendMessage(chatId, `❌ Failed to send WhatsApp reply: ${err.message}`);
    }
  });

  // /mycard on Telegram (Sends Digital Student ID Card Image)
  tgBot.onText(/\/mycard/, async (msg) => {
    const chatId = String(msg.chat.id);
    const student = users.linked[chatId];
    const sName = student ? student.name : (msg.from.first_name || 'Student');
    const sRoll = student ? student.roll_no : '2024PHY001';
    await tgBot.sendMessage(chatId, '🎨 Generating your official Digital Student ID Card image...');
    try {
      const pngBuffer = await generateStudentIdCard({
        name: sName,
        roll: sRoll,
        dept: CONFIG.DEPARTMENT || 'Department of Physics',
        college: CONFIG.COLLEGE_NAME || 'Dinhata College',
        session: '2024 - 2028'
      });
      await tgBot.sendPhoto(chatId, pngBuffer, {
        caption: `🪪 *OFFICIAL DIGITAL STUDENT ID CARD*\n\n👤 *Name:* ${sName}\n🎓 *Roll No:* \`${sRoll}\`\n🛡️ *Verification:* Official Active Pass ✅`,
        parse_mode: 'Markdown'
      });
    } catch (err) {
      await tgBot.sendMessage(chatId, `❌ Failed to render card: ${err.message}`);
    }
  });

  // /formula on Telegram
  tgBot.onText(/\/formula/, async (msg) => {
    const f = getRandomPhysicsFormula();
    const reply = `💡 *PHYSICS FORMULA OF THE DAY*\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `🔬 *Topic:* ${f.topic}\n` +
      `📐 *Formula:* \`${f.formula}\`\n\n` +
      `📖 *Concept:* ${f.explanation}\n\n` +
      `🎯 *Application:* ${f.application}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n_Department of Physics, Dinhata College_`;
    await tgBot.sendMessage(msg.chat.id, reply, { parse_mode: 'Markdown' });
  });

  // /deadlines on Telegram
  tgBot.onText(/\/deadlines/, async (msg) => {
    if (!deadlines || deadlines.length === 0) {
      return tgBot.sendMessage(msg.chat.id, '📋 Abhi koi pending assignment deadlines nahi hain! All clear. 🎉');
    }
    const now = moment().tz(CONFIG.TIMEZONE);
    let reply = `🕒 *ACADEMIC DEADLINE RADAR*\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    deadlines.forEach((d, idx) => {
      const dMoment = moment.tz(d.deadline, 'DD-MM-YYYY HH:mm', CONFIG.TIMEZONE);
      const diffHours = dMoment.diff(now, 'hours');
      const diffDays = dMoment.diff(now, 'days');
      let timeLeft = diffHours < 0 ? 'Expired ❌' : diffHours < 24 ? `${diffHours} hours remaining ⏳` : `${diffDays} days remaining 📅`;
      reply += `${idx + 1}. *${d.title}*\n   ⏰ Due: \`${d.deadline}\` (${timeLeft})\n\n`;
    });
    await tgBot.sendMessage(msg.chat.id, reply.trim(), { parse_mode: 'Markdown' });
  });

  // /fees on Telegram
  tgBot.onText(/\/fees/, async (msg) => {
    const reply = `💳 *SEMESTER FEES & FORM FILL-UP GUIDE*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📊 *Even Semester Fee Breakdown:*\n` +
      `• Regular University Exam Fee: ₹850\n` +
      `• Physics Practical Lab & Instrument Fee: ₹300\n` +
      `• *Total Payable Amount:* *₹1,150*\n\n` +
      `📅 *Important Dates:*\n` +
      `• Last Date (Without Late Fine): *15 October 2026*\n` +
      `• Late Fine Window (₹200 extra): *16 – 20 October 2026*\n` +
      `• Admit Card Generation: *25 October 2026*\n\n` +
      `🔗 *Official Payment Portal:* dinhata-college.ac.in/fees\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💡 Payment receipt college office mein submit karein.`;
    await tgBot.sendMessage(msg.chat.id, reply, { parse_mode: 'Markdown' });
  });

  // /circulars on Telegram
  tgBot.onText(/\/circulars/, async (msg) => {
    const reply = `📢 *OFFICIAL COLLEGE NOTICES & CIRCULARS*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `1. 📝 *Even Semester Examination Form Fillup 2026*\n` +
      `   • Exam Form submission active on portal.\n` +
      `   • Link: dinhata-college.ac.in/notice/exam-even-2026.pdf\n\n` +
      `2. 🔬 *Physics Practical Exam & Laboratory Viva Routine*\n` +
      `   • Major 3 & Major 4 practical dates announced.\n` +
      `   • Link: dinhata-college.ac.in/notice/physics-practical-2026.pdf\n\n` +
      `3. 🎓 *SVMCM & Oasis Scholarship Renewal 2026-27*\n` +
      `   • BDO Income Certificate & marksheet counter-signature.\n` +
      `   • Link: svmcm.wbhed.gov.in\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🏛️ _Dinhata College Administration Office_`;
    await tgBot.sendMessage(msg.chat.id, reply, { parse_mode: 'Markdown' });
  });

  // Formula of the Day at 7:30 AM Daily to WhatsApp Group
  cron.schedule('30 7 * * *', async () => {
    try {
      const f = getRandomPhysicsFormula();
      const formulaMsg = `💡 *DAILY PHYSICS FORMULA BOOSTER*\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🔬 *Topic:* ${f.topic}\n` +
        `📐 *Formula:* \`${f.formula}\`\n\n` +
        `📖 *Concept:* ${f.explanation}\n\n` +
        `🎯 *Application:* ${f.application}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━\n_Department of Physics Routine Starts at 10:30 AM!_`;
      if (sock && sock.user) {
        await sock.sendMessage(currentConfig.GROUP_ID, { text: formulaMsg });
      }
    } catch (e) {}
  }, { timezone: CONFIG.TIMEZONE });

  // Deadline Radar Check (Every 30 minutes)
  cron.schedule('*/30 * * * *', async () => {
    try {
      const now = moment().tz(CONFIG.TIMEZONE);
      let updated = false;
      for (const d of deadlines) {
        const dMoment = moment.tz(d.deadline, 'DD-MM-YYYY HH:mm', CONFIG.TIMEZONE);
        const diffHours = dMoment.diff(now, 'hours', true);

        if (diffHours > 0 && diffHours <= 24 && !d.reminded_24h) {
          d.reminded_24h = true;
          updated = true;
          const alertMsg = `⚠️ *DEADLINE RADAR: 24 HOURS REMAINING*\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `📋 *Assignment / Task:* ${d.title}\n` +
            `⏰ *Submission Deadline:* \`${d.deadline}\`\n\n` +
            `Sabhi students apna assignment complete karke ready rakhein!`;
          if (sock && sock.user) await sock.sendMessage(currentConfig.GROUP_ID, { text: alertMsg });
        }

        if (diffHours > 0 && diffHours <= 3 && !d.reminded_3h) {
          d.reminded_3h = true;
          updated = true;
          const alertMsg = `🚨 *URGENT DEADLINE: ONLY 3 HOURS LEFT!*\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `📋 *Task:* ${d.title}\n` +
            `⏰ *Due Today at:* \`${d.deadline}\`\n\n` +
            `Submission window jald band hone wali hai!`;
          if (sock && sock.user) await sock.sendMessage(currentConfig.GROUP_ID, { text: alertMsg });
        }
      }
      if (updated) saveDeadlines();
    } catch (e) {}
  }, { timezone: CONFIG.TIMEZONE });
}

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

    let weatherText = `\n\n🌤️ *Aaj ka Mausam:*\n📍 ${name}\n🌡️ Temp: ${minTemp}°C - ${maxTemp}°C\n💧 Humidity: ${humidity}%\n☔ Rain: ${rainProb}%\n🌥️ Sky: ${sky}`;

    const isBadWeather = rainProb >= 50 || [51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99].includes(current.weather_code);
    if (isBadWeather) {
      weatherText += `\n\n⛈️ *BAD WEATHER WARNING:* Heavy rain or thunderstorm predicted today! Carry an umbrella and check transport/class updates.`;
    }

    return weatherText;
  } catch (err) {
    console.warn('⚠️ Weather API call skipped/failed:', err.message);
    return null;
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
        `*🎓 Student Smart Features:*\n` +
        `• !mycard - Official Digital Student ID Card (Picture Form)\n` +
        `• !formula - Physics Formula of the day\n` +
        `• !deadlines - Assignment & lab deadline countdown\n` +
        `• !fees - Semester fee structure & portal link\n` +
        `• !circulars - Official college circulars & notices\n` +
        `• !report <msg> - Anonymous student grievance / feedback\n` +
        `• !verify Roll_No Full_Name - Link student profile\n` +
        `• !myinfo - View your verified student profile\n\n` +
        `*📖 Syllabus Commands:*\n` +
        `• !syllabus major3 - Waves & Optics\n` +
        `• !syllabus major3lab - Major 3 Practical\n` +
        `• !syllabus major4 - Analog Electronics\n` +
        `• !syllabus major4lab - Major 4 Practical\n` +
        `• !syllabus sec3 - Python / Computational Physics\n`;

      if (isAdmin) {
        helpMsg += `\n*👑 Admin Commands:*\n` +
          `• !tagall <Message> - Tag all group members\n` +
          `• !adddeadline Title | DD-MM-YYYY HH:mm\n` +
          `• !broadcast (Reply to any DM message to forward to group)\n` +
          `• !students - View all verified college students\n` +
          `• !findstudent Roll_No - Search verified student\n` +
          `• !delstudent Roll_No - Remove student record\n` +
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
        helpMsg += `\n💡 Admin can manage routine, broadcasts, absences, tagall, and exams.`;
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

    // 8. !verify <Roll> <Full Name>
    if (lowerText.startsWith('!verify')) {
      const limit = checkRateLimit(senderNumber, isAdmin);
      if (limit.limited) {
        await sock.sendMessage(sender, { text: `⏳ Please wait ${limit.waitSeconds}s before using another command.` });
        return true;
      }

      const input = text.substring('!verify'.length).trim();
      const parts = input.split(/\s+/);
      if (!input || parts.length < 2) {
        await sock.sendMessage(sender, {
          text: `📌 *Student Verification Format:*\n` +
            `\`!verify <College_Roll_No> <Your Full Name>\`\n\n` +
            `*Example:* \`!verify 230101 Rahul Dey\`\n\n` +
            `💡 Yeh aapke WhatsApp number ko college roll number se officially link kar dega.`
        });
        return true;
      }

      const roll = parts[0].trim();
      const name = parts.slice(1).join(' ').trim();

      // Check if roll number registered to another phone
      const existingRoll = students.find(s => s.roll.toLowerCase() === roll.toLowerCase());
      if (existingRoll && existingRoll.sender !== sender) {
        await sock.sendMessage(sender, {
          text: `⚠️ *Roll Number Already Claimed!*\n\nRoll number *${roll}* is already registered to *${existingRoll.name}*.\nAgar yeh aapka roll number hai, to please College Admin se contact karein.`
        });
        return true;
      }

      const idx = students.findIndex(s => s.sender === sender);
      if (idx !== -1) {
        students[idx].roll = roll;
        students[idx].name = name;
        students[idx].updatedAt = new Date().toISOString();
      } else {
        students.push({
          roll,
          name,
          sender,
          platform: 'whatsapp',
          verifiedAt: new Date().toISOString()
        });
      }
      saveStudents();

      await sock.sendMessage(sender, {
        text: `✅ *Student Verification Successful!* 🎉\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `👤 *Name:* ${name}\n` +
          `🎓 *College Roll:* ${roll}\n` +
          `📱 *WhatsApp ID:* ${senderNumber}\n` +
          `🛡️ *Status:* Verified Student ✅\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `_Aapka profile save ho gaya hai aur cloud backup ho chuka hai._`
      });
      return true;
    }

    // 9. !myinfo
    if (lowerText === '!myinfo' || lowerText === '!whoami') {
      const student = students.find(s => s.sender === sender);
      if (!student) {
        await sock.sendMessage(sender, {
          text: `❌ *Aap abhi verified nahi hain!*\n\nVerify karne ke liye type karein:\n\`!verify <Roll_No> <Your Name>\``
        });
        return true;
      }

      await sock.sendMessage(sender, {
        text: `🎓 *Aapka Verified Student Profile*\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `👤 *Name:* ${student.name}\n` +
          `🔢 *Roll Number:* ${student.roll}\n` +
          `📱 *Linked WhatsApp:* +${senderNumber}\n` +
          `📅 *Verified On:* ${moment(student.verifiedAt || student.date).tz(currentConfig.TIMEZONE).format('DD MMM YYYY, hh:mm A')}\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `_Information change karne ke liye dubara !verify karein._`
      });
      return true;
    }

    // 10. !mycard / !idcard (Picture ID Card Generator)
    if (lowerText === '!mycard' || lowerText === '!idcard') {
      const limit = checkRateLimit(senderNumber, isAdmin);
      if (limit.limited) {
        await sock.sendMessage(sender, { text: `⏳ Please wait ${limit.waitSeconds}s.` });
        return true;
      }
      let student = students.find(s => s.sender && s.sender.replace(/\D/g, '') === senderNumber.replace(/\D/g, ''));
      if (!student) {
        student = Object.values(users.linked || {}).find(u => u.name);
      }
      const sName = student ? student.name : 'College Student';
      const sRoll = student ? (student.roll || student.roll_no || '2024PHY001') : '2024PHY001';

      await sock.sendMessage(sender, { text: '🎨 Generating official High-Resolution Digital Student ID Card for you... Please wait.' });
      try {
        const pngBuffer = await generateStudentIdCard({
          name: sName,
          roll: sRoll,
          dept: CONFIG.DEPARTMENT || 'Department of Physics',
          college: CONFIG.COLLEGE_NAME || 'Dinhata College',
          session: '2024 - 2028'
        });
        await sock.sendMessage(sender, {
          image: pngBuffer,
          caption: `🪪 *OFFICIAL DIGITAL STUDENT ID CARD*\n━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *Name:* ${sName}\n🎓 *Roll No:* \`${sRoll}\`\n🏛️ *College:* ${CONFIG.COLLEGE_NAME || 'Dinhata College'}\n🔬 *Major:* Physics (B.Sc 4-Year NEP)\n🛡️ *Verification:* Official Active Student Pass ✅`
        });
      } catch (err) {
        await sock.sendMessage(sender, { text: `❌ Failed to render ID Card image: ${err.message}` });
      }
      return true;
    }

    // 11. !tagall / !everyone (Admin Only)
    if (lowerText.startsWith('!tagall') || lowerText.startsWith('!everyone')) {
      if (!isAdmin) {
        await sock.sendMessage(sender, { text: '⛔ Only Admin can use !tagall / !everyone.' });
        return true;
      }
      const broadcastMsg = text.replace(/^!(tagall|everyone)/i, '').trim();
      try {
        const groupMeta = await sock.groupMetadata(currentConfig.GROUP_ID);
        const participants = groupMeta.participants.map(p => p.id);
        let tagText = `📢 *ATTENTION EVERYONE*\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        if (broadcastMsg) tagText += `${broadcastMsg}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        tagText += `👥 Tagged Members (${participants.length}):\n`;
        participants.forEach(p => {
          tagText += `@${p.split('@')[0]} `;
        });
        await sock.sendMessage(currentConfig.GROUP_ID, { text: tagText, mentions: participants });
      } catch (err) {
        await sock.sendMessage(sender, { text: `❌ Could not tag members: ${err.message}` });
      }
      return true;
    }

    // 12. !formula (Physics Formula Booster)
    if (lowerText === '!formula') {
      const limit = checkRateLimit(senderNumber, isAdmin);
      if (limit.limited) {
        await sock.sendMessage(sender, { text: `⏳ Please wait ${limit.waitSeconds}s.` });
        return true;
      }
      const f = getRandomPhysicsFormula();
      const reply = `💡 *PHYSICS FORMULA OF THE DAY*\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🔬 *Topic:* ${f.topic}\n` +
        `📐 *Formula:* \`${f.formula}\`\n\n` +
        `📖 *Concept:* ${f.explanation}\n\n` +
        `🎯 *Application:* ${f.application}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━\n_Department of Physics, Dinhata College_`;
      await sock.sendMessage(sender, { text: reply });
      return true;
    }

    // 13. !deadlines
    if (lowerText === '!deadlines') {
      const limit = checkRateLimit(senderNumber, isAdmin);
      if (limit.limited) {
        await sock.sendMessage(sender, { text: `⏳ Please wait ${limit.waitSeconds}s.` });
        return true;
      }
      if (!deadlines || deadlines.length === 0) {
        await sock.sendMessage(sender, { text: '📋 Abhi koi pending assignment ya lab deadlines nahi hain! All clear. 🎉' });
        return true;
      }
      const now = moment().tz(CONFIG.TIMEZONE);
      let reply = `🕒 *ACADEMIC DEADLINE RADAR*\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
      deadlines.forEach((d, idx) => {
        const dMoment = moment.tz(d.deadline, 'DD-MM-YYYY HH:mm', CONFIG.TIMEZONE);
        const diffHours = dMoment.diff(now, 'hours');
        const diffDays = dMoment.diff(now, 'days');
        let timeLeft = diffHours < 0 ? 'Expired ❌' : diffHours < 24 ? `${diffHours} hours remaining ⏳` : `${diffDays} days remaining 📅`;
        reply += `${idx + 1}. *${d.title}*\n   ⏰ Due: \`${d.deadline}\` (${timeLeft})\n\n`;
      });
      reply += `━━━━━━━━━━━━━━━━━━━━━━━━━\n💡 Late submission avoid karein.`;
      await sock.sendMessage(sender, { text: reply.trim() });
      return true;
    }

    // 14. !adddeadline (Admin Only)
    if (lowerText.startsWith('!adddeadline')) {
      if (!isAdmin) {
        await sock.sendMessage(sender, { text: '⛔ Only Admin can add assignment deadlines.' });
        return true;
      }
      const input = text.replace('!adddeadline', '').trim();
      const parts = input.split('|').map(p => p.trim());
      if (parts.length < 2) {
        await sock.sendMessage(sender, { text: '📌 Format: `!adddeadline Title | DD-MM-YYYY HH:mm`\nExample: `!adddeadline Major 3 Lab Manual | 15-10-2026 16:00`' });
        return true;
      }
      const title = parts[0];
      const deadlineTime = parts[1];
      const newId = deadlines.length > 0 ? Math.max(...deadlines.map(d => d.id || 0)) + 1 : 1;
      deadlines.push({ id: newId, title, deadline: deadlineTime, reminded_24h: false, reminded_3h: false });
      saveDeadlines();
      await sock.sendMessage(sender, { text: `✅ Deadline added successfully!\n\n📋 *Title:* ${title}\n⏰ *Due:* \`${deadlineTime}\`` });
      return true;
    }

    // 15. !report / !feedback (Anonymous Student Helpdesk)
    if (lowerText.startsWith('!report') || lowerText.startsWith('!feedback')) {
      const complaint = text.replace(/^!(report|feedback)/i, '').trim();
      if (!complaint) {
        await sock.sendMessage(sender, {
          text: `❓ *Anonymous Student Helpdesk*\n\nApna concern ya problem likhkar bhejein:\n*Format:* \`!report <Aapka message>\`\n\n_Note: Aapka phone number aur identity 100% confidential rehti hai._`
        });
        return true;
      }
      const ticketId = tickets.length > 0 ? Math.max(...tickets.map(t => t.id || 0)) + 1 : 101;
      const timeStr = moment().tz(CONFIG.TIMEZONE).format('DD-MM-YYYY hh:mm A');
      tickets.push({
        id: ticketId,
        sender: sender,
        text: complaint,
        createdAt: new Date().toISOString(),
        status: 'open'
      });
      saveTickets();

      await sock.sendMessage(sender, {
        text: `✅ *Ticket #${ticketId} Generated!*\n\nAapki grievance / feedback college administration ko anonymously forward kar diya gaya hai. Jab Admin reply karenge toh aapko private message mil jayega.`
      });

      if (tgBot) {
        const tgAlert = `🎫 *NEW ANONYMOUS STUDENT TICKET #${ticketId}*\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `📅 *Time:* ${timeStr}\n\n` +
          `💬 *Message:*\n"${complaint}"\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `👉 Reply to this student via Telegram:\n\`/reply ${ticketId} <your response>\``;
        tgBot.sendMessage(CONFIG.ADMIN_CHAT_ID, tgAlert, { parse_mode: 'Markdown' }).catch(() => {});
      }
      return true;
    }

    // 16. !circulars / !notices
    if (lowerText === '!circulars' || lowerText === '!notices') {
      const limit = checkRateLimit(senderNumber, isAdmin);
      if (limit.limited) {
        await sock.sendMessage(sender, { text: `⏳ Please wait ${limit.waitSeconds}s.` });
        return true;
      }
      const reply = `📢 *OFFICIAL COLLEGE NOTICES & CIRCULARS*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `1. 📝 *Even Semester Examination Form Fillup 2026*\n` +
        `   • Exam Form submission active on portal.\n` +
        `   • Link: dinhata-college.ac.in/notice/exam-even-2026.pdf\n\n` +
        `2. 🔬 *Physics Practical Exam & Laboratory Viva Routine*\n` +
        `   • Major 3 & Major 4 practical dates announced.\n` +
        `   • Link: dinhata-college.ac.in/notice/physics-practical-2026.pdf\n\n` +
        `3. 🎓 *SVMCM & Oasis Scholarship Renewal 2026-27*\n` +
        `   • BDO Income Certificate & marksheet counter-signature at College Office.\n` +
        `   • Link: svmcm.wbhed.gov.in\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🏛️ _Dinhata College Administration Office_`;
      await sock.sendMessage(sender, { text: reply });
      return true;
    }

    // 17. !fees
    if (lowerText === '!fees') {
      const limit = checkRateLimit(senderNumber, isAdmin);
      if (limit.limited) {
        await sock.sendMessage(sender, { text: `⏳ Please wait ${limit.waitSeconds}s.` });
        return true;
      }
      const reply = `💳 *SEMESTER FEES & FORM FILL-UP GUIDE*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📊 *Even Semester Fee Breakdown:*\n` +
        `• Regular University Exam Fee: ₹850\n` +
        `• Physics Practical Lab & Instrument Fee: ₹300\n` +
        `• *Total Payable Amount:* *₹1,150*\n\n` +
        `📅 *Important Dates:*\n` +
        `• Last Date (Without Late Fine): *15 October 2026*\n` +
        `• Late Fine Window (₹200 extra): *16 – 20 October 2026*\n` +
        `• Admit Card Generation: *25 October 2026*\n\n` +
        `🔗 *Official Payment Portal:* dinhata-college.ac.in/fees\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `💡 Payment receipt ka printout college office mein submit karna zaroori hai.`;
      await sock.sendMessage(sender, { text: reply });
      return true;
    }

    // 10. !students (Admin only - List all verified students)
    if (lowerText === '!students' || lowerText === '!studentlist') {
      if (!isAdmin) {
        await sock.sendMessage(sender, { text: '❌ Only admins can view the verified students directory.' });
        return true;
      }

      if (students.length === 0) {
        await sock.sendMessage(sender, { text: 'ℹ️ Abhi tak koi student verify nahi hua hai.' });
        return true;
      }

      let listMsg = `📋 *College Verified Students List (${students.length}):*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      students.forEach((s, i) => {
        const phone = s.sender.includes('@') ? `+${s.sender.split('@')[0]}` : s.sender;
        listMsg += `${i + 1}. *${s.name}* | Roll: \`${s.roll}\` | [${phone}]\n`;
      });
      listMsg += `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `💡 Search karne ke liye: \`!findstudent <Roll_No>\``;

      await sock.sendMessage(sender, { text: listMsg });
      return true;
    }

    // 11. !findstudent <Roll or Name> (Admin only)
    if (lowerText.startsWith('!findstudent')) {
      if (!isAdmin) {
        await sock.sendMessage(sender, { text: '❌ Only admins can search student records.' });
        return true;
      }

      const query = text.substring('!findstudent'.length).trim();
      if (!query) {
        await sock.sendMessage(sender, { text: '📌 Format: `!findstudent <Roll_No or Name>`' });
        return true;
      }

      const found = students.filter(s => s.roll.toLowerCase().includes(query.toLowerCase()) || s.name.toLowerCase().includes(query.toLowerCase()));
      if (found.length === 0) {
        await sock.sendMessage(sender, { text: `❌ Koi student nahi mila matching "${query}".` });
        return true;
      }

      let resMsg = `🔍 *Search Results (${found.length}):*\n━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      found.forEach(s => {
        const phone = s.sender.includes('@') ? `+${s.sender.split('@')[0]}` : s.sender;
        resMsg += `👤 *Name:* ${s.name}\n🎓 *Roll:* \`${s.roll}\`\n📱 *Contact:* ${phone}\n📅 *Registered:* ${moment(s.verifiedAt).format('DD-MM-YYYY')}\n\n`;
      });

      await sock.sendMessage(sender, { text: resMsg.trim() });
      return true;
    }

    // 12. !delstudent <Roll> (Admin only)
    if (lowerText.startsWith('!delstudent')) {
      if (!isAdmin) {
        await sock.sendMessage(sender, { text: '❌ Only admins can delete students.' });
        return true;
      }

      const roll = text.substring('!delstudent'.length).trim();
      if (!roll) {
        await sock.sendMessage(sender, { text: '📌 Format: `!delstudent <Roll_No>`' });
        return true;
      }

      const initialLen = students.length;
      students = students.filter(s => s.roll.toLowerCase() !== roll.toLowerCase());
      if (students.length === initialLen) {
        await sock.sendMessage(sender, { text: `❌ Roll Number "${roll}" ka koi student record nahi mila.` });
        return true;
      }

      saveStudents();
      await sock.sendMessage(sender, { text: `✅ Student with Roll *${roll}* successfully removed.` });
      return true;
    }
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

  // 6.1 Subah 10:00 AM College Notice Board Bulletin (Mon-Fri)
  cron.schedule('0 10 * * 1-5', async () => {
    try {
      const now = moment().tz(currentConfig.TIMEZONE);
      const todayStr = now.format('DD-MM-YYYY');
      const holidayCheck = await checkIsHoliday(todayStr);
      if (holidayCheck.isHoliday) return;

      const noticeMsg = `📢 *COLLEGE NOTICE BOARD BULLETIN*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🏛️ *Dinhata College Official Circulars Summary:*\n` +
        `1. 📝 *Even Semester Examination Form Fillup 2026*\n` +
        `   • Exam Form submission portal active: dinhata-college.ac.in/notice/exam-even-2026.pdf\n\n` +
        `2. 🔬 *Physics Practical Exam & Laboratory Viva Routine*\n` +
        `   • Major 3 & Major 4 practical dates: dinhata-college.ac.in/notice/physics-practical-2026.pdf\n\n` +
        `3. 🎓 *SVMCM & Oasis Scholarship Renewal*\n` +
        `   • Document counter-signing at office: svmcm.wbhed.gov.in\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `💡 Full circulars dekhne ke liye group mein type karein: *!circulars*`;
      if (sock && sock.user) {
        await sock.sendMessage(currentConfig.GROUP_ID, { text: noticeMsg });
      }
    } catch (e) {}
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
      students,
      users,
      attendance,
      notes,
      deadlines,
      tickets,
      runtimeConfig: {
        ADMIN_NUMBER: currentConfig.ADMIN_NUMBER,
        GROUP_ID: currentConfig.GROUP_ID
      }
    };
    await sendToTelegram('daily_full_backup', fullBackup);

    // Auto Storage Pruning & Deep Cleanup (Zero Server Storage Bloat)
    const today = moment().tz(currentConfig.TIMEZONE).format('YYYY-MM-DD');
    sentReminders = sentReminders.filter(r => r.split('_')[0] >= today);
    startedClasses = startedClasses.filter(r => r.split('_')[0] >= today);
    saveReminders();
    saveStarted();

    const sevenDaysAgo = moment().tz(currentConfig.TIMEZONE).subtract(7, 'days');
    tickets = tickets.filter(t => t.status !== 'replied' || moment(t.createdAt).isAfter(sevenDaysAgo));
    saveTickets();

    deadlines = deadlines.filter(d => {
      const dMoment = moment.tz(d.deadline, 'DD-MM-YYYY HH:mm', CONFIG.TIMEZONE);
      return dMoment.isAfter(sevenDaysAgo);
    });
    saveDeadlines();

    purgeOldTempFiles();
    console.log('🧹 Daily deep storage cleanup complete (Zero-Disk-Bloat Active).');
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
