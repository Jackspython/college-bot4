/**
 * ========================================================
 * ⚙️ TELEGRAM BOT CONFIGURATION
 * ========================================================
 * Is file mein Telegram bot ke core credentials hain.
 * Token @BotFather se aur Chat ID @userinfobot se liya gaya hai.
 * ========================================================
 */

export default {
  // 🤖 Telegram Bot Token (@BotFather se prapt)
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '8822830634:AAH3SSxMbDE6HynFisPD696hunYBgU3R0Mg',

  // 👑 Master Admin Telegram Chat ID (Sirf yehi admin commands chala sakta hai)
  ADMIN_CHAT_ID: process.env.ADMIN_CHAT_ID || '5610762471',

  // 🕒 Standard Timezone
  TIMEZONE: 'Asia/Kolkata',

  // 📁 Data Directory jahan JSON files store hongi
  DATA_DIR: './data',

  // 📂 Uploaded Notes aur PDFs ka folder
  FILES_DIR: './data/files',

  // ⏳ Rate limit cooldown for public commands (in seconds)
  RATE_LIMIT_SECONDS: 30,

  // 🎓 College Name
  COLLEGE_NAME: 'Dinhata College',
  DEPARTMENT: 'Department of Physics'
};
