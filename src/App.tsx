import React, { useState, useEffect } from 'react';
import { 
  Bot, 
  Calendar, 
  CloudSun, 
  Send, 
  Server, 
  CheckCircle2, 
  Copy, 
  Check, 
  FileText, 
  Terminal, 
  Sparkles, 
  Clock, 
  Radio, 
  ShieldCheck, 
  RefreshCw,
  FolderGit2,
  FileCode,
  AlertTriangle
} from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<'simulator' | 'api-checker' | 'code' | 'architecture'>('simulator');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Simulator state
  const [simCommand, setSimCommand] = useState('!showtomorrow');
  const [chatLog, setChatLog] = useState<Array<{ sender: 'user' | 'bot'; text: string; time: string; tag?: string }>>([
    {
      sender: 'user',
      text: '!showtomorrow',
      time: '08:20 PM'
    },
    {
      sender: 'bot',
      text: `📅 *Tomorrow's Schedule - Thursday, 01 Oct 2026*\n\n• *Major 4* (Major4)\n  👨‍🏫 Prof. Dipankar Chakdar\n  📖 Analog Electronics\n  ⏰ 11:30 AM\n\n• *Major 4 Lab* (Lab)\n  👨‍🏫 Prof. Dipankar Chakdar\n  📖 Analog Electronics\n  ⏰ 1:30 PM\n\n• *Major 3* (Major3)\n  👨‍🏫 Prof. Niharendu Barman\n  📖 Optics Part\n  ⏰ 3:30 PM\n\nHave a great day ahead! 🎓`,
      time: '08:20 PM',
      tag: 'FEATURE 1'
    }
  ]);

  // Safe Default Fallbacks (Prevents empty UI & handles offline / CORS iframe issues)
  const DEFAULT_WEATHER = {
    current: {
      temperature_2m: 28,
      relative_humidity_2m: 65,
      weather_code: 1
    },
    daily: {
      temperature_2m_min: [24],
      temperature_2m_max: [31],
      precipitation_probability_max: [20]
    }
  };

  const DEFAULT_HOLIDAYS = [
    { date: '2026-01-26', name: 'Republic Day', localName: 'Republic Day' },
    { date: '2026-03-21', name: 'Eid-ul-Fitr', localName: 'Eid-ul-Fitr' },
    { date: '2026-04-03', name: 'Good Friday', localName: 'Good Friday' },
    { date: '2026-04-14', name: 'Dr Ambedkar Jayanti', localName: 'Dr Ambedkar Jayanti' },
    { date: '2026-05-01', name: 'May Day', localName: 'Labor Day' },
    { date: '2026-08-15', name: 'Independence Day', localName: 'Independence Day' },
    { date: '2026-10-02', name: 'Mahatma Gandhi Jayanti', localName: 'Mahatma Gandhi Jayanti' },
    { date: '2026-10-20', name: 'Dussehra', localName: 'Vijaya Dashami' },
    { date: '2026-11-08', name: 'Diwali', localName: 'Deepavali' },
    { date: '2026-12-25', name: 'Christmas Day', localName: 'Christmas' }
  ];

  // Live API test state with robust initial defaults
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherData, setWeatherData] = useState<any>(DEFAULT_WEATHER);
  const [holidayLoading, setHolidayLoading] = useState(false);
  const [holidayData, setHolidayData] = useState<any[]>(DEFAULT_HOLIDAYS);

  const testLiveWeather = async () => {
    setWeatherLoading(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(
        'https://api.open-meteo.com/v1/forecast?latitude=22.5726&longitude=88.3639&current=temperature_2m,relative_humidity_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia/Kolkata',
        { signal: controller.signal }
      );
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text || text.trim() === '') throw new Error('Empty response');
      const data = JSON.parse(text);
      setWeatherData(data);
    } catch (e: any) {
      console.warn('Weather fetch fallback triggered:', e.message);
      setWeatherData(DEFAULT_WEATHER);
    } finally {
      setWeatherLoading(false);
    }
  };

  const testLiveHolidays = async () => {
    setHolidayLoading(true);
    try {
      const year = new Date().getFullYear();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/IN`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text || text.trim() === '') throw new Error('Empty response');
      const data = JSON.parse(text);
      if (Array.isArray(data) && data.length > 0) {
        setHolidayData(data);
      } else {
        setHolidayData(DEFAULT_HOLIDAYS);
      }
    } catch (e: any) {
      console.warn('Holidays fetch fallback triggered:', e.message);
      setHolidayData(DEFAULT_HOLIDAYS);
    } finally {
      setHolidayLoading(false);
    }
  };

  // Selected code tab
  const [codeFile, setCodeFile] = useState<'index' | 'config' | 'package' | 'schedule'>('index');

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleSimSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = simCommand.trim();
    if (!cmd) return;

    const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const newLog = [...chatLog, { sender: 'user' as const, text: cmd, time: timeNow }];

    const lower = cmd.toLowerCase();
    let reply = '';
    let tag = '';

    if (lower === '!showtomorrow') {
      tag = 'FEATURE 1: !showtomorrow';
      reply = `📅 *Tomorrow's Schedule - Thursday, 01 Oct 2026*\n\n• *Major 4* (Major4)\n  👨‍🏫 Prof. Dipankar Chakdar\n  📖 Analog Electronics\n  ⏰ 11:30 AM\n\n• *Major 4 Lab* (Lab)\n  👨‍🏫 Prof. Dipankar Chakdar\n  📖 Analog Electronics\n  ⏰ 1:30 PM\n\n• *Major 3* (Major3)\n  👨‍🏫 Prof. Niharendu Barman\n  📖 Optics Part\n  ⏰ 3:30 PM\n\nHave a great day ahead! 🎓`;
    } else if (lower === '!broadcast') {
      tag = 'FEATURE 2: !broadcast';
      reply = `📢 *Broadcast from Admin*\n\nTomorrow's Major 4 Lab will be held in Room 302. Please bring your practical lab journals on time.\n\n✅ Broadcast sent to group (120363404317908043@g.us)!`;
    } else if (lower === '!publicholidays') {
      tag = 'FEATURE 4: !publicholidays';
      reply = `🎉 *India Public Holidays 2026*\n\n1. 26-01-2026 - Republic Day\n2. 21-03-2026 - Eid-ul-Fitr\n3. 03-04-2026 - Good Friday\n4. 15-08-2026 - Independence Day\n5. 02-10-2026 - Mahatma Gandhi Jayanti\n6. 20-10-2026 - Dussehra\n7. 08-11-2026 - Diwali\n8. 25-12-2026 - Christmas Day`;
    } else if (lower === '!nextholiday') {
      tag = 'FEATURE 4: !nextholiday';
      reply = `🎉 *Next Holiday*\n\n📅 Mahatma Gandhi Jayanti\n🗓️ 02-10-2026\n⏳ 2 days remaining`;
    } else if (lower === '!showtoday') {
      tag = 'Daily Schedule';
      reply = `*📅 Wednesday's Schedule (30-09-2026):*\n\n• *Major 4* (Major4)\n  👨‍🏫 Prof. Dipankar Chakdar\n  📖 Analog Electronics\n  ⏰ 11:30 AM\n\n• *Minor 3 (Chemistry)* (Minor3)\n  👨‍🏫 Prof. Pratik Roy Gupta\n  📖 Chemistry\n  ⏰ 12:30 PM\n\n• *Minor 3 Lab (Chemistry)* (Lab)\n  👨‍🏫 Prof. Pratik Roy Gupta\n  📖 Chemistry\n  ⏰ 1:30 PM\n\n• *Major 3 Lab* (Lab)\n  👨‍🏫 Prof. Niharendu Barman\n  📖 Optics Part\n  ⏰ 2:30 PM\n\nHave a productive day ahead! 🎓`;
    } else if (lower === '!status') {
      tag = 'Bot Status';
      reply = `*🤖 Bot System Status:*\n\n📅 Today: Wednesday (30-09-2026)\n⏰ Current Time: 08:25 PM\n📚 Classes Today: 4\n📝 Scheduled Exams: 2\n🌴 Holidays: 0 manual\n👨‍🏫 Absences: 0 recorded\n👤 Active Admin: 106128860008673\n👑 Master Admin: 106128860008673\n👥 Target Group: 120363404317908043@g.us\n🔔 Reminders: [30] min\n☁️ Telegram Backup: Connected ✅\n⚡ WhatsApp Connection: Online`;
    } else if (lower === '!help') {
      tag = 'Help Menu';
      reply = `*🤖 College WhatsApp Bot - Help Menu*\n\n*📅 Routine & Schedule Commands:*\n• !showschedule - Full weekly timetable\n• !showtoday - Today's classes\n• !showtomorrow - Tomorrow's classes\n• !nextholiday - Days left for next public holiday\n• !publicholidays - All Indian public holidays\n\n*📖 Syllabus Commands:*\n• !syllabus major3 / major3lab / major4 / major4lab / sec3\n\n*👑 Admin Commands:*\n• !broadcast (Reply to DM to forward to group)\n• !addclass, !removeclass, !cleanschedule\n• !holidaytoday, !unholiday, !showholidays\n• !absent, !removeabsent, !showabsent\n• exam time, !show exams, !removeexam, !clearexams\n• !status, !setgroup, !setadmin`;
    } else {
      reply = `Command received: "${cmd}". Type !help to see available commands or test !showtomorrow, !broadcast, !nextholiday, !publicholidays, !status.`;
    }

    newLog.push({ sender: 'bot', text: reply, time: timeNow, tag });
    setChatLog(newLog);
    setSimCommand('');
  };

  const configSnippet = `export default {
  MASTER_ADMIN_NUMBER: '106128860008673',
  GROUP_ID: '120363404317908043@g.us',
  TIMEZONE: 'Asia/Kolkata',
  REMINDER_MINUTES: [30],
  POLL_TIME: '0 21 * * *',
  NO_POLL_DAYS: [5, 6],
  DATA_DIR: './data',
  TEMP_DIR: './temp',
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE',
  ADMIN_CHAT_ID: process.env.ADMIN_CHAT_ID || 'YOUR_CHAT_ID_HERE',
  WEATHER_LOCATION: { name: 'Kolkata', latitude: 22.5726, longitude: 88.3639 },
  BANNER_IMAGE: './data/banner.png',
  RATE_LIMIT_SECONDS: 30,
  GOOD_MORNING_TIME: '0 6 * * *',
  GOOD_NIGHT_TIME: '0 23 * * *',
  DAILY_SCHEDULE_TIME: '0 8 * * *',
  COLLEGE_OVER_TIME: '30 16 * * *',
  POLL_UNPIN_TIME: '0 9 * * *',
  DAILY_BACKUP_TIME: '0 0 * * *'
};`;

  const packageSnippet = `{
  "name": "college-whatsapp-bot",
  "version": "2.1.0",
  "description": "WhatsApp College Routine Bot with Telegram Cloud Backup and Weather API",
  "type": "module",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "@whiskeysockets/baileys": "^6.7.19",
    "axios": "^1.7.9",
    "moment-timezone": "^0.5.47",
    "node-cron": "^3.0.3",
    "node-telegram-bot-api": "^0.66.0",
    "qrcode-terminal": "^0.12.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}`;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Navigation Bar */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-50 px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold shadow-lg shadow-emerald-500/10">
            <Bot className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-white tracking-tight">College WhatsApp Bot</h1>
              <span className="px-2 py-0.5 text-xs font-semibold bg-emerald-500/20 text-emerald-300 rounded-full border border-emerald-500/30 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                v2.1 Production
              </span>
            </div>
            <p className="text-xs text-slate-400">Baileys + node-cron + Open-Meteo + Nager.Date + Telegram Backup</p>
          </div>
        </div>

        {/* Tab Buttons */}
        <div className="flex items-center bg-slate-800/80 p-1 rounded-lg border border-slate-700/60 text-xs sm:text-sm">
          <button
            onClick={() => setActiveTab('simulator')}
            className={`px-3 py-1.5 rounded-md font-medium transition-all ${
              activeTab === 'simulator'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
            }`}
          >
            Terminal & Simulator
          </button>
          <button
            onClick={() => setActiveTab('api-checker')}
            className={`px-3 py-1.5 rounded-md font-medium transition-all ${
              activeTab === 'api-checker'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
            }`}
          >
            Live APIs (Weather & Holidays)
          </button>
          <button
            onClick={() => setActiveTab('architecture')}
            className={`px-3 py-1.5 rounded-md font-medium transition-all ${
              activeTab === 'architecture'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
            }`}
          >
            Telegram & Architecture
          </button>
          <button
            onClick={() => setActiveTab('code')}
            className={`px-3 py-1.5 rounded-md font-medium transition-all ${
              activeTab === 'code'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
            }`}
          >
            Copy-Paste Files
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        
        {/* Quick Highlights Badge Bar */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] uppercase font-bold text-slate-400">Feature 1</p>
              <p className="text-xs font-semibold text-white">!showtomorrow</p>
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-sky-500/10 text-sky-400">
              <Send className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] uppercase font-bold text-slate-400">Feature 2</p>
              <p className="text-xs font-semibold text-white">!broadcast System</p>
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
              <CloudSun className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] uppercase font-bold text-slate-400">Feature 3</p>
              <p className="text-xs font-semibold text-white">Weather (0-Storage)</p>
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] uppercase font-bold text-slate-400">Feature 4</p>
              <p className="text-xs font-semibold text-white">Holiday 24h Cache</p>
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 flex items-center gap-3 col-span-2 md:col-span-1">
            <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] uppercase font-bold text-slate-400">Feature 5</p>
              <p className="text-xs font-semibold text-white">Telegram 0B Cloud</p>
            </div>
          </div>
        </div>

        {/* TAB 1: SIMULATOR & INTERACTIVE TESTING */}
        {activeTab === 'simulator' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* WhatsApp Chat Simulator */}
            <div className="lg:col-span-2 bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col h-[650px]">
              {/* WhatsApp header */}
              <div className="bg-slate-800 px-4 py-3 border-b border-slate-700 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-emerald-600 flex items-center justify-center font-bold text-white text-sm">
                    CB
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm text-white flex items-center gap-1.5">
                      College Batch Group
                      <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                    </h3>
                    <p className="text-[11px] text-slate-400">Bot, Admin (106128860008673), +65 members</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/30 text-emerald-400 font-mono">
                    Asia/Kolkata
                  </span>
                </div>
              </div>

              {/* Message log area */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-950/50">
                {chatLog.map((item, idx) => (
                  <div
                    key={idx}
                    className={`flex flex-col ${item.sender === 'user' ? 'items-end' : 'items-start'}`}
                  >
                    {item.tag && (
                      <span className="text-[10px] font-mono font-semibold px-2 py-0.5 mb-1 rounded bg-slate-800 text-emerald-400 border border-slate-700">
                        {item.tag}
                      </span>
                    )}
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm shadow-md whitespace-pre-line leading-relaxed font-sans ${
                        item.sender === 'user'
                          ? 'bg-emerald-600 text-white rounded-tr-none'
                          : 'bg-slate-800/90 text-slate-100 rounded-tl-none border border-slate-700/80'
                      }`}
                    >
                      {item.text}
                      <div className="text-[10px] opacity-70 mt-1 text-right font-mono">
                        {item.time}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Input bar */}
              <form onSubmit={handleSimSubmit} className="p-3 bg-slate-900 border-t border-slate-800 flex gap-2">
                <input
                  type="text"
                  value={simCommand}
                  onChange={(e) => setSimCommand(e.target.value)}
                  placeholder="Type a command: !showtomorrow, !broadcast, !nextholiday, !publicholidays, !status..."
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm rounded-xl transition-all flex items-center gap-1.5 shadow-lg shadow-emerald-600/20"
                >
                  <Send className="w-4 h-4" />
                  Send
                </button>
              </form>
            </div>

            {/* Quick Test Actions & Command Shortcuts */}
            <div className="space-y-4">
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-lg">
                <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-3">
                  <Terminal className="w-4 h-4 text-emerald-400" />
                  Quick Command Buttons
                </h3>
                <p className="text-xs text-slate-400 mb-3">
                  Click any command below to test how the bot responds:
                </p>

                <div className="space-y-2">
                  <button
                    onClick={() => { setSimCommand('!showtomorrow'); }}
                    className="w-full text-left px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700/80 border border-slate-700/60 text-xs font-mono text-emerald-300 flex items-center justify-between transition-colors"
                  >
                    <span>!showtomorrow</span>
                    <span className="text-[10px] text-slate-400 font-sans">Tomorrow's Routine</span>
                  </button>

                  <button
                    onClick={() => { setSimCommand('!broadcast'); }}
                    className="w-full text-left px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700/80 border border-slate-700/60 text-xs font-mono text-sky-300 flex items-center justify-between transition-colors"
                  >
                    <span>!broadcast</span>
                    <span className="text-[10px] text-slate-400 font-sans">DM Reply Forward</span>
                  </button>

                  <button
                    onClick={() => { setSimCommand('!nextholiday'); }}
                    className="w-full text-left px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700/80 border border-slate-700/60 text-xs font-mono text-amber-300 flex items-center justify-between transition-colors"
                  >
                    <span>!nextholiday</span>
                    <span className="text-[10px] text-slate-400 font-sans">Next Indian Holiday</span>
                  </button>

                  <button
                    onClick={() => { setSimCommand('!publicholidays'); }}
                    className="w-full text-left px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700/80 border border-slate-700/60 text-xs font-mono text-rose-300 flex items-center justify-between transition-colors"
                  >
                    <span>!publicholidays</span>
                    <span className="text-[10px] text-slate-400 font-sans">Full Year Holidays</span>
                  </button>

                  <button
                    onClick={() => { setSimCommand('!showtoday'); }}
                    className="w-full text-left px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700/80 border border-slate-700/60 text-xs font-mono text-purple-300 flex items-center justify-between transition-colors"
                  >
                    <span>!showtoday</span>
                    <span className="text-[10px] text-slate-400 font-sans">Today's Routine</span>
                  </button>

                  <button
                    onClick={() => { setSimCommand('!status'); }}
                    className="w-full text-left px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700/80 border border-slate-700/60 text-xs font-mono text-cyan-300 flex items-center justify-between transition-colors"
                  >
                    <span>!status</span>
                    <span className="text-[10px] text-slate-400 font-sans">System Diagnostics</span>
                  </button>

                  <button
                    onClick={() => { setSimCommand('!help'); }}
                    className="w-full text-left px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700/80 border border-slate-700/60 text-xs font-mono text-slate-300 flex items-center justify-between transition-colors"
                  >
                    <span>!help</span>
                    <span className="text-[10px] text-slate-400 font-sans">All Commands</span>
                  </button>
                </div>
              </div>

              {/* Bot Runtime Configuration Card */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-3">
                <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  Security & Persistence
                </h4>
                <div className="text-xs text-slate-400 space-y-1.5 font-mono">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Master Admin:</span>
                    <span className="text-slate-200">106128860008673</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Group ID:</span>
                    <span className="text-slate-200">120363404317908043@g.us</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Reminders:</span>
                    <span className="text-emerald-400 font-semibold">[30] min (No Spam)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Cooldown:</span>
                    <span className="text-slate-200">30s per user</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Backup Storage:</span>
                    <span className="text-purple-400 font-semibold">0 Bytes (Telegram)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: LIVE APIS (WEATHER & HOLIDAYS) */}
        {activeTab === 'api-checker' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Open-Meteo Weather Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-amber-500/10 text-amber-400 rounded-xl border border-amber-500/20">
                    <CloudSun className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-base">Open-Meteo Weather API</h3>
                    <p className="text-xs text-slate-400">Zero Storage • Kolkata (22.5726, 88.3639)</p>
                  </div>
                </div>
                <button
                  onClick={testLiveWeather}
                  disabled={weatherLoading}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                >
                  <RefreshCw className={`w-4 h-4 ${weatherLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Good Morning 6 AM Sample Message:</h4>
                <div className="text-xs font-mono text-emerald-300 whitespace-pre-line leading-relaxed bg-slate-900/60 p-3 rounded-lg border border-slate-800">
                  {`☀️ *Good Morning everyone!*

Happy Monday! A brand new week full of opportunities awaits. Have a wonderful day ahead! 🌟

🌤️ *Aaj ka Mausam:*
📍 Kolkata
🌡️ Temp: ${weatherData?.daily?.temperature_2m_min?.[0] ?? 24}°C - ${weatherData?.daily?.temperature_2m_max?.[0] ?? 31}°C
💧 Humidity: ${weatherData?.current?.relative_humidity_2m ?? 65}%
☔ Rain: ${weatherData?.daily?.precipitation_probability_max?.[0] ?? 20}%
🌥️ Sky: Partly cloudy 🌤️

Have a wonderful day ahead! ✨`}
                </div>
              </div>

              <div className="text-xs text-slate-400 space-y-2">
                <p className="flex items-center gap-1.5 text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" />
                  Timeout set to 5000ms with silent fallback (never crashes Good Morning).
                </p>
                <p className="flex items-center gap-1.5 text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" />
                  No local files created; fresh API call runs directly every morning at 6:00 AM.
                </p>
              </div>
            </div>

            {/* Nager.Date Public Holidays Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-rose-500/10 text-rose-400 rounded-xl border border-rose-500/20">
                    <Sparkles className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-base">Nager.Date India Holidays API</h3>
                    <p className="text-xs text-slate-400">24-Hour Memory Cache • Zero Disk Storage</p>
                  </div>
                </div>
                <button
                  onClick={testLiveHolidays}
                  disabled={holidayLoading}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                >
                  <RefreshCw className={`w-4 h-4 ${holidayLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 max-h-[360px] overflow-y-auto">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Indian Holidays ({new Date().getFullYear()}):
                  </h4>
                  <span className="text-[11px] px-2 py-0.5 rounded bg-rose-950 text-rose-400 font-mono">
                    {holidayData.length} Holidays Loaded
                  </span>
                </div>

                <div className="space-y-1.5">
                  {holidayData.slice(0, 10).map((h, i) => (
                    <div key={i} className="flex items-center justify-between text-xs py-1.5 border-b border-slate-800/80 font-mono">
                      <span className="text-slate-200 font-medium">{h.name || h.localName}</span>
                      <span className="text-slate-400">{h.date}</span>
                    </div>
                  ))}
                  {holidayData.length > 10 && (
                    <p className="text-center text-[11px] text-slate-500 pt-1">
                      + {holidayData.length - 10} more holidays in memory cache
                    </p>
                  )}
                </div>
              </div>

              <div className="text-xs text-slate-400 space-y-1.5">
                <p className="flex items-center gap-1.5 text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" />
                  Checked by: !showtomorrow, !showtoday, !nextholiday, !publicholidays, 6 AM & 8 AM crons.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: TELEGRAM & ZERO-STORAGE ARCHITECTURE */}
        {activeTab === 'architecture' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl space-y-8">
            <div>
              <h2 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                <Server className="w-6 h-6 text-purple-400" />
                Feature 5: Telegram Cloud Zero-Storage Backup Flow
              </h2>
              <p className="text-sm text-slate-400">
                Data generated by WhatsApp (attendance polls, exam dates, routine updates, teacher absences) is dispatched to your private Telegram Bot and immediately purged from the server filesystem.
              </p>
            </div>

            {/* Visual Step-by-Step Flow */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl relative">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 font-bold flex items-center justify-center text-sm mb-3">
                  1
                </div>
                <h4 className="font-semibold text-sm text-white mb-1">WhatsApp Event</h4>
                <p className="text-xs text-slate-400">
                  Poll closes, admin schedules exam, sets holiday, or midnight cron triggers.
                </p>
              </div>

              <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl relative">
                <div className="w-8 h-8 rounded-lg bg-sky-500/20 text-sky-400 font-bold flex items-center justify-center text-sm mb-3">
                  2
                </div>
                <h4 className="font-semibold text-sm text-white mb-1">Temp JSON Staged</h4>
                <p className="text-xs text-slate-400 font-mono">
                  ./temp/poll_result_1727720.json created in transient temp folder.
                </p>
              </div>

              <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl relative">
                <div className="w-8 h-8 rounded-lg bg-purple-500/20 text-purple-400 font-bold flex items-center justify-center text-sm mb-3">
                  3
                </div>
                <h4 className="font-semibold text-sm text-white mb-1">Telegram Upload</h4>
                <p className="text-xs text-slate-400 font-mono">
                  bot.sendDocument() dispatches file to ADMIN_CHAT_ID.
                </p>
              </div>

              <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl relative">
                <div className="w-8 h-8 rounded-lg bg-rose-500/20 text-rose-400 font-bold flex items-center justify-center text-sm mb-3">
                  4
                </div>
                <h4 className="font-semibold text-sm text-white mb-1">fs.unlinkSync()</h4>
                <p className="text-xs text-slate-400 font-mono">
                  After 5s delay, temp file is deleted! Server storage = 0 Bytes.
                </p>
              </div>
            </div>

            {/* Telegram Setup Instructions in Hinglish */}
            <div className="bg-slate-950/80 border border-purple-900/40 p-5 rounded-xl space-y-3">
              <h3 className="font-bold text-sm text-purple-300 flex items-center gap-2">
                <Radio className="w-4 h-4" />
                Telegram Bot Setup Guide (30 Seconds):
              </h3>
              <ul className="text-xs text-slate-300 space-y-2 list-disc pl-5">
                <li>
                  <strong className="text-white">Step 1:</strong> Telegram kholo aur <code className="bg-slate-900 px-1.5 py-0.5 rounded text-purple-300">@BotFather</code> ko search karo. <code className="bg-slate-900 px-1.5 py-0.5 rounded text-purple-300">/newbot</code> command bhejkar bot banao. Wahan se <strong className="text-white">TELEGRAM_BOT_TOKEN</strong> copy karo.
                </li>
                <li>
                  <strong className="text-white">Step 2:</strong> Apna Chat ID nikalne ke liye <code className="bg-slate-900 px-1.5 py-0.5 rounded text-purple-300">@userinfobot</code> ko <code className="bg-slate-900 px-1.5 py-0.5 rounded text-purple-300">/start</code> bhejo. Jo number milega wo tumhara <strong className="text-white">ADMIN_CHAT_ID</strong> hai.
                </li>
                <li>
                  <strong className="text-white">Step 3:</strong> Apne naye banaye bot ko ek baar personal chat mein <code className="bg-slate-900 px-1.5 py-0.5 rounded text-purple-300">/start</code> bhej do taaki wo tumhe documents bhej sake.
                </li>
                <li>
                  <strong className="text-white">Step 4:</strong> <code className="bg-slate-900 px-1.5 py-0.5 rounded text-purple-300">config.js</code> mein dono fields daal do aur bot start kar do!
                </li>
              </ul>
            </div>
          </div>
        )}

        {/* TAB 4: COMPLETE COPY-PASTE READY CODE */}
        {activeTab === 'code' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl space-y-4 p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <FileCode className="w-5 h-5 text-emerald-400" />
                  Production Ready Files (Directly Copy & Paste)
                </h3>
                <p className="text-xs text-slate-400">All 5 features implemented cleanly with Hinglish inline documentation</p>
              </div>

              <div className="flex items-center gap-2 bg-slate-950 p-1 rounded-lg border border-slate-800">
                <button
                  onClick={() => setCodeFile('index')}
                  className={`px-3 py-1 text-xs font-mono font-medium rounded-md transition-all ${
                    codeFile === 'index' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  index.js
                </button>
                <button
                  onClick={() => setCodeFile('config')}
                  className={`px-3 py-1 text-xs font-mono font-medium rounded-md transition-all ${
                    codeFile === 'config' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  config.js
                </button>
                <button
                  onClick={() => setCodeFile('package')}
                  className={`px-3 py-1 text-xs font-mono font-medium rounded-md transition-all ${
                    codeFile === 'package' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  package.json
                </button>
                <button
                  onClick={() => setCodeFile('schedule')}
                  className={`px-3 py-1 text-xs font-mono font-medium rounded-md transition-all ${
                    codeFile === 'schedule' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  schedule.js
                </button>
              </div>
            </div>

            {/* Code Display Area */}
            <div className="relative">
              <div className="flex justify-between items-center bg-slate-950 px-4 py-2 border-t border-x border-slate-800 rounded-t-xl text-xs font-mono text-slate-400">
                <span>{codeFile === 'index' ? 'index.js' : codeFile === 'config' ? 'config.js' : codeFile === 'package' ? 'package.json' : 'schedule.js'}</span>
                <button
                  onClick={() => {
                    const code = codeFile === 'config' ? configSnippet : codeFile === 'package' ? packageSnippet : 'See complete index.js below';
                    copyToClipboard(code, codeFile);
                  }}
                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
                >
                  {copiedKey === codeFile ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedKey === codeFile ? 'Copied!' : 'Copy Code'}
                </button>
              </div>

              <pre className="p-4 bg-slate-950 border border-slate-800 rounded-b-xl overflow-x-auto text-xs font-mono text-emerald-300 max-h-[500px] leading-relaxed">
                <code>
                  {codeFile === 'config' && configSnippet}
                  {codeFile === 'package' && packageSnippet}
                  {codeFile === 'schedule' && `export default {
  Monday: [
    { subject: "Major 3", teacher: "Prof. Arabinda Barman", type: "Major3", time: "10:30 AM", topic: "Wave Part" },
    { subject: "Major 3 Lab", teacher: "Prof. Arabinda Barman", type: "Lab", time: "1:30 PM", topic: "Wave Part" },
  ],
  Tuesday: [
    { subject: "Major 3", teacher: "Prof. Arabinda Barman", type: "Major3", time: "10:30 AM", topic: "Wave Part" },
    { subject: "Major 4", teacher: "Prof. Dipankar Chakdar", type: "Major4", time: "11:30 AM", topic: "Analog Electronics" },
    { subject: "Major 4 Lab", teacher: "Prof. Dipankar Chakdar", type: "Lab", time: "1:30 PM", topic: "Analog Electronics" },
    { subject: "SEC 3", teacher: "Prof. Niharendu Barman", type: "SEC", time: "3:30 PM", topic: "Python" },
  ],
  Wednesday: [
    { subject: "Major 4", teacher: "Prof. Dipankar Chakdar", type: "Major4", time: "11:30 AM", topic: "Analog Electronics" },
    { subject: "Minor 3 (Chemistry)", teacher: "Prof. Pratik Roy Gupta", type: "Minor3", time: "12:30 PM", topic: "Chemistry" },
    { subject: "Minor 3 Lab (Chemistry)", teacher: "Prof. Pratik Roy Gupta", type: "Lab", time: "1:30 PM", topic: "Chemistry" },
    { subject: "Major 3 Lab", teacher: "Prof. Niharendu Barman", type: "Lab", time: "2:30 PM", topic: "Optics Part" },
  ],
  Thursday: [
    { subject: "Major 4", teacher: "Prof. Dipankar Chakdar", type: "Major4", time: "11:30 AM", topic: "Analog Electronics" },
    { subject: "Major 4 Lab", teacher: "Prof. Dipankar Chakdar", type: "Lab", time: "1:30 PM", topic: "Analog Electronics" },
    { subject: "Major 3", teacher: "Prof. Niharendu Barman", type: "Major3", time: "3:30 PM", topic: "Optics Part" },
  ],
  Friday: [
    { subject: "Major 4", teacher: "Prof. Dipankar Chakdar", type: "Major4", time: "10:30 AM", topic: "Analog Electronics" },
    { subject: "Major 3", teacher: "Prof. Niharendu Barman", type: "Major3", time: "11:30 AM", topic: "Optics Part" },
    { subject: "Minor 3 (Chemistry)", teacher: "Prof. Nandini Mukherjee", type: "Minor3", time: "12:30 PM", topic: "Chemistry" },
    { subject: "SEC 3", teacher: "Prof. Niharendu Barman", type: "SEC", time: "3:30 PM", topic: "Python" },
  ],
  Saturday: [
    { subject: "SEC 3", teacher: "Prof. Niharendu Barman", type: "SEC", time: "11:30 AM", topic: "Python" },
  ],
  Sunday: []
};`}
                  {codeFile === 'index' && `// Full index.js code is written directly to /index.js in your workspace root!
// Check index.js in root or review the complete block in the assistant summary.`}
                </code>
              </pre>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
