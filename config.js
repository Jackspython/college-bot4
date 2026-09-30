/**
 * ========================================================
 * ⚙️ COLLEGE BOT CONFIGURATION FILE
 * ========================================================
 * Is file mein bot ke saare core settings hain:
 * - Admin number & WhatsApp Group ID
 * - Telegram Backup Token & Admin Chat ID
 * - Cron Timings & Timezone (Asia/Kolkata)
 * - Class Reminder Intervals ([30, 15, 5] minutes)
 * ========================================================
 */

export default {
  // 👑 Master Admin: Sirf yehi !setadmin aur !setgroup change kar sakta hai
  MASTER_ADMIN_NUMBER: '106128860008673',

  // 👥 WhatsApp Group ID jahan bot alerts and schedules bhejega
  GROUP_ID: '120363404317908043@g.us',

  // 🕒 Timezone
  TIMEZONE: 'Asia/Kolkata',

  // ⏰ Class shuru hone se kitne minute pehle alert bheje
  // Sirf 30 minute pehle alert (GC spam free rakhne ke liye)
  REMINDER_MINUTES: [30],

  // 📊 Daily attendance poll time (Raat ko 9:00 PM)
  POLL_TIME: '0 21 * * *',

  // 🚫 In dino poll nahi aayega (5 = Friday, 6 = Saturday)
  NO_POLL_DAYS: [5, 6],

  // 📁 Static aur persistent data directory
  DATA_DIR: './data',

  // 📂 Temporary files directory (Telegram upload ke baad delete ho jayegi - 0 server storage)
  TEMP_DIR: './temp',

  // 📂 Uploaded Notes aur PDFs ka folder
  FILES_DIR: './data/files',

  // 🤖 Telegram Bot Backup Settings (@BotFather & @userinfobot se lo)
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '8822830634:AAH3SSxMbDE6HynFisPD696hunYBgU3R0Mg',
  ADMIN_CHAT_ID: process.env.ADMIN_CHAT_ID || '5610762471',

  // 🎓 College details
  COLLEGE_NAME: 'Dinhata College',
  DEPARTMENT: 'Department of Physics',

  // 🌤️ Weather Location (Open-Meteo API ke liye - Kolkata default)
  WEATHER_LOCATION: {
    name: 'Kolkata',
    latitude: 22.5726,
    longitude: 88.3639
  },

  // 🖼️ Banner image (Restart / Online hone par group mein message ke saath jayega)
  BANNER_IMAGE: './data/banner.png',

  // ⏳ Rate limit cooldown for public commands (in seconds)
  RATE_LIMIT_SECONDS: 30,

  // ⏰ Scheduled Timings (Cron Syntax)
  GOOD_MORNING_TIME: '0 6 * * *',      // Subah 6:00 AM
  GOOD_NIGHT_TIME: '0 23 * * *',       // Raat 11:00 PM
  DAILY_SCHEDULE_TIME: '0 8 * * *',    // Subah 8:00 AM (Schedule message)
  COLLEGE_OVER_TIME: '30 16 * * *',    // Shaam 4:30 PM (Pack-up message)
  POLL_UNPIN_TIME: '0 9 * * *',        // Subah 9:00 AM (Poll result & unpin)
  DAILY_BACKUP_TIME: '0 0 * * *'       // Raat 12:00 AM (Complete Telegram Backup)
};
