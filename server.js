const express = require('express');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { getStorage } = require('./storage');

const JWT_SECRET = process.env.JWT_SECRET || 'littlelife-' + require('crypto').randomBytes(32).toString('hex');
const SALT_ROUNDS = 10;
const memoryUpload = multer({ storage: multer.memoryStorage() });

function extractWords(text) {
  if (!text) return [];
  return [...new Set(text.toLowerCase().replace(/[^a-z\s'\-]/g, ' ').split(/\s+/).filter(w => w && w.length > 1))];
}
function calcAge(birthDate, atDate) {
  if (!birthDate) return null;
  const bd = new Date(birthDate), ad = new Date(atDate);
  let years = ad.getFullYear() - bd.getFullYear(), months = ad.getMonth() - bd.getMonth();
  if (months < 0) { years--; months += 12; }
  return years === 0 ? `${months}mo` : `${years}y ${months}mo`;
}
function escHtml(s) { if (!s) return ''; return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function getPreviousDate(dateStr) { const d = new Date(dateStr); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); }
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function bufToDataUri(mime, buf) { if (!buf) return null; return `data:${mime};base64,${buf.toString('base64')}`; }
function inferMime(filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  if (['webm','mp3','wav','ogg','m4a'].includes(ext)) return 'audio/webm';
  if (['jpg','jpeg'].includes(ext)) return 'image/jpeg';
  if (['png'].includes(ext)) return 'image/png';
  if (['gif'].includes(ext)) return 'image/gif';
  if (['webp'].includes(ext)) return 'image/webp';
  if (['mp4','mov'].includes(ext)) return 'video/mp4';
  return 'application/octet-stream';
}

function createApp() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  // JWT middleware
  function authenticate(req, res, next) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.userId = payload.userId;
      next();
    } catch { return res.status(401).json({ error: 'Invalid token' }); }
  }

  async function getData() { const s = await getStorage(); return s.load(); }
  async function putData(d) { const s = await getStorage(); return s.save(d); }

  // ==================== AUTH ====================
  app.post('/api/auth/signup', async (req, res) => {
    try {
      const { email, password, name } = req.body;
      if (!email || !password || !name) return res.status(400).json({ error: 'Email, password, and name required' });
      const data = await getData();
      if (data.users.find(u => u.email === email)) return res.status(400).json({ error: 'Email already registered' });
      const hash = bcrypt.hashSync(password, SALT_ROUNDS);
      const user = { _id: genId(), email, name, password: hash, createdAt: new Date().toISOString() };
      data.users.push(user);
      if (data.users.length === 1 && data.kids.length > 0) data.kids.forEach(k => { if (!k.userId) k.userId = user._id; });
      await putData(data);
      const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });
      res.json({ token, _id: user._id, email: user.email, name: user.name });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
      const data = await getData();
      const user = data.users.find(u => u.email === email);
      if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid email or password' });
      const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });
      res.json({ token, _id: user._id, email: user.email, name: user.name });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/auth/me', async (req, res) => {
    try {
      const auth = req.headers.authorization || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
      if (!token) return res.json(null);
      const payload = jwt.verify(token, JWT_SECRET);
      const data = await getData();
      const user = data.users.find(u => u._id === payload.userId);
      res.json(user ? { _id: user._id, email: user.email, name: user.name } : null);
    } catch { res.json(null); }
  });

  // ==================== KIDS ====================
  app.get('/api/kids', authenticate, async (req, res) => {
    const data = await getData();
    res.json(data.kids.filter(k => k.userId === req.userId));
  });
  app.post('/api/kids', authenticate, async (req, res) => {
    const { name, birthDate } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const data = await getData();
    const kid = { _id: genId(), userId: req.userId, name, birthDate: birthDate || '', photo: '', createdAt: new Date().toISOString() };
    data.kids.push(kid); await putData(data); res.json(kid);
  });
  app.put('/api/kids/:id', authenticate, async (req, res) => {
    const data = await getData();
    const kid = data.kids.find(k => k._id === req.params.id && k.userId === req.userId);
    if (!kid) return res.status(404).json({ error: 'Not found' });
    if (req.body.name) kid.name = req.body.name;
    if (req.body.birthDate !== undefined) kid.birthDate = req.body.birthDate;
    await putData(data); res.json(kid);
  });
  app.delete('/api/kids/:id', authenticate, async (req, res) => {
    const data = await getData();
    const idx = data.kids.findIndex(k => k._id === req.params.id && k.userId === req.userId);
    if (idx === -1) return res.status(404);
    data.kids.splice(idx, 1);
    ['voiceEntries','dailyLogs','growthRecords','teethRecords','photos','artworks','readingLogs','vaccines','doctorVisits','milestones','familyMembers'].forEach(coll => {
      const list = data[coll] || [];
      for (let i = list.length - 1; i >= 0; i--) { if (list[i].kidId === req.params.id) list.splice(i, 1); }
    });
    await putData(data); res.json({ ok: true });
  });

  // ==================== ACHIEVEMENTS ====================
  const ACHIEVEMENT_DEFS = [
    { id: 'first-echo', icon: '🎙️', label: 'First Echo', desc: 'Record your first voice entry' },
    { id: 'echo-10', icon: '🎤', label: '10 Echoes', desc: 'Record 10 voice entries' },
    { id: 'echo-50', icon: '🌟', label: '50 Echoes', desc: 'Record 50 voice entries' },
    { id: 'echo-100', icon: '💫', label: '100 Echoes', desc: 'Record 100 voice entries' },
    { id: 'words-10', icon: '🔤', label: '10 Words', desc: 'Collect 10 unique words' },
    { id: 'words-50', icon: '📖', label: '50 Words', desc: 'Collect 50 unique words' },
    { id: 'words-100', icon: '📕', label: '100 Words', desc: 'Collect 100 unique words' },
    { id: 'words-500', icon: '📚', label: '500 Words', desc: 'Collect 500 unique words' },
    { id: 'streak-3', icon: '🔥', label: '3-Day Streak', desc: 'Log entries 3 days in a row' },
    { id: 'streak-7', icon: '💪', label: '7-Day Streak', desc: 'Log entries 7 days in a row' },
    { id: 'streak-30', icon: '⚡', label: '30-Day Streak', desc: 'Log entries 30 days in a row' },
    { id: 'photos-10', icon: '📸', label: '10 Photos', desc: 'Upload 10 photos' },
    { id: 'photos-50', icon: '🖼️', label: '50 Photos', desc: 'Upload 50 photos' },
    { id: 'art-5', icon: '🎨', label: '5 Artworks', desc: 'Save 5 artworks' },
    { id: 'art-20', icon: '🖌️', label: '20 Artworks', desc: 'Save 20 artworks' },
    { id: 'reading-5', icon: '📚', label: '5 Books', desc: 'Log 5 books' },
    { id: 'reading-20', icon: '📚', label: '20 Books', desc: 'Log 20 books' },
    { id: 'reading-50', icon: '📚', label: '50 Books', desc: 'Log 50 books' },
    { id: 'growth-5', icon: '📏', label: '5 Growth Records', desc: 'Track growth 5 times' },
    { id: 'tooth-1', icon: '🦷', label: 'First Tooth', desc: 'Log your first tooth' },
    { id: 'tooth-20', icon: '😁', label: 'All Teeth', desc: 'Log all 20 baby teeth' },
    { id: 'milestones-5', icon: '👶', label: '5 Milestones', desc: 'Record 5 milestones' },
    { id: 'milestones-15', icon: '🏆', label: '15 Milestones', desc: 'Record 15 milestones' },
    { id: 'daily-7', icon: '📝', label: '7 Daily Logs', desc: 'Complete 7 daily logs' },
    { id: 'daily-30', icon: '📋', label: '30 Daily Logs', desc: 'Complete 30 daily logs' },
    { id: 'vaccines-all', icon: '💉', label: 'All Vaccines', desc: 'Complete all EPI vaccinations' },
    { id: 'family-share', icon: '👨‍👩‍👧', label: 'Family Share', desc: 'Share a link with family' },
    { id: 'first-favorite', icon: '💖', label: 'Favorite Memory', desc: 'Mark your first favorite' },
  ];

  function computeAchievements(kidId, data) {
    const entries = (data.voiceEntries||[]).filter(e => e.kidId === kidId);
    const dailyLogs = (data.dailyLogs||[]).filter(e => e.kidId === kidId);
    const photos = (data.photos||[]).filter(e => e.kidId === kidId);
    const artworks = (data.artworks||[]).filter(e => e.kidId === kidId);
    const readingLogs = (data.readingLogs||[]).filter(e => e.kidId === kidId);
    const growthRecords = (data.growthRecords||[]).filter(e => e.kidId === kidId);
    const teethRecords = (data.teethRecords||[]).filter(e => e.kidId === kidId);
    const milestones = (data.milestones||[]).filter(e => e.kidId === kidId);
    const vaccines = (data.vaccines||[]).filter(e => e.kidId === kidId);
    const familyMembers = (data.familyMembers||[]).filter(e => e.kidId === kidId);
    const allWords = new Set(entries.flatMap(e => extractWords(e.transcription)));
    const dates = [...new Set(entries.map(e => e.createdAt.slice(0,10)))].sort().reverse();
    let bestStreak = 0, currentStreak = 0;
    for (let i = 0; i < dates.length; i++) {
      if (i === 0 || dates[i-1] === getPreviousDate(dates[i]) || dates[i-1] === dates[i]) { currentStreak++; bestStreak = Math.max(bestStreak, currentStreak); }
      else { currentStreak = 1; }
    }
    const epiVaccines = ['BCG','Hepatitis B','OPV','Pentavalent','PCV','IPV','Measles 1','Measles 2','Typhoid'];
    const completedVaccines = new Set(vaccines.map(v => v.vaccine));
    const allVaccinesDone = epiVaccines.every(v => completedVaccines.has(v));
    const earned = [];
    if (entries.length >= 1) earned.push('first-echo');
    if (entries.length >= 10) earned.push('echo-10');
    if (entries.length >= 50) earned.push('echo-50');
    if (entries.length >= 100) earned.push('echo-100');
    if (allWords.size >= 10) earned.push('words-10');
    if (allWords.size >= 50) earned.push('words-50');
    if (allWords.size >= 100) earned.push('words-100');
    if (allWords.size >= 500) earned.push('words-500');
    if (bestStreak >= 3) earned.push('streak-3');
    if (bestStreak >= 7) earned.push('streak-7');
    if (bestStreak >= 30) earned.push('streak-30');
    if (photos.length >= 10) earned.push('photos-10');
    if (photos.length >= 50) earned.push('photos-50');
    if (artworks.length >= 5) earned.push('art-5');
    if (artworks.length >= 20) earned.push('art-20');
    if (readingLogs.length >= 5) earned.push('reading-5');
    if (readingLogs.length >= 20) earned.push('reading-20');
    if (readingLogs.length >= 50) earned.push('reading-50');
    if (growthRecords.length >= 5) earned.push('growth-5');
    if (teethRecords.length >= 1) earned.push('tooth-1');
    if (teethRecords.length >= 20) earned.push('tooth-20');
    if (milestones.length >= 5) earned.push('milestones-5');
    if (milestones.length >= 15) earned.push('milestones-15');
    if (dailyLogs.length >= 7) earned.push('daily-7');
    if (dailyLogs.length >= 30) earned.push('daily-30');
    if (allVaccinesDone) earned.push('vaccines-all');
    if (familyMembers.length >= 1) earned.push('family-share');
    if (entries.some(e => e.isFavorite)) earned.push('first-favorite');
    return ACHIEVEMENT_DEFS.map(a => ({ ...a, earned: earned.includes(a.id) }));
  }

  app.get('/api/achievements/:kidId', authenticate, async (req, res) => {
    const data = await getData();
    const kid = data.kids.find(k => k._id === req.params.kidId && k.userId === req.userId);
    if (!kid) return res.status(404).json({ error: 'Not found' });
    const achievements = computeAchievements(req.params.kidId, data);
    res.json({ achievements, earnedCount: achievements.filter(a => a.earned).length, totalCount: achievements.length, kidName: kid.name });
  });

  // ==================== ECHO ====================
  function enrichVoice(e, data) {
    const kid = data.kids.find(k => k._id === e.kidId);
    return { ...e, audioUrl: e.audioData || null, photoUrl: e.photoData || null, wordCount: extractWords(e.transcription).length, age: kid?.birthDate ? calcAge(kid.birthDate, e.createdAt) : null };
  }

  app.get('/api/echo', authenticate, async (req, res) => {
    const data = await getData();
    const { kidId, status, tag, search, language } = req.query;
    let list = data.voiceEntries || [];
    if (kidId) list = list.filter(e => e.kidId === kidId);
    if (tag) list = list.filter(e => e.tags && e.tags.includes(tag));
    if (status === 'favorites') list = list.filter(e => e.isFavorite);
    if (language) list = list.filter(e => e.language === language);
    if (search) { const q = search.toLowerCase(); list = list.filter(e => (e.transcription || '').toLowerCase().includes(q)); }
    res.json(list.map(e => enrichVoice(e, data)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
  });

  app.post('/api/echo', authenticate, memoryUpload.fields([{name:'audio',maxCount:1},{name:'photo',maxCount:1}]), async (req, res) => {
    try {
      const { kidId, transcription, note, tags, duration, language } = req.body;
      if (!kidId) return res.status(400).json({ error: 'kidId required' });
      const data = await getData();
      if (!data.kids.some(k => k._id === kidId)) return res.status(404).json({ error: 'Kid not found' });
      const audioFile = req.files?.audio?.[0];
      const photoFile = req.files?.photo?.[0];
      const entry = {
        _id: genId(), kidId, transcription: transcription || '', note: note || '',
        duration: Number(duration) || 0, language: language || 'any',
        tags: tags ? (typeof tags === 'string' ? JSON.parse(tags) : tags) : [],
        reactions: [], isFavorite: false,
        audioData: audioFile ? bufToDataUri(inferMime(audioFile.originalname), audioFile.buffer) : null,
        photoData: photoFile ? bufToDataUri(inferMime(photoFile.originalname), photoFile.buffer) : null,
        createdAt: new Date().toISOString()
      };
      data.voiceEntries.push(entry); await putData(data); res.json(enrichVoice(entry, data));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/echo/:id', authenticate, async (req, res) => {
    const data = await getData();
    const entry = data.voiceEntries.find(e => e._id === req.params.id);
    if (!entry) return res.status(404);
    ['transcription','note','isFavorite','tags','reactions','duration','language'].forEach(f => { if (req.body[f] !== undefined) entry[f] = req.body[f]; });
    await putData(data); res.json(enrichVoice(entry, data));
  });

  app.delete('/api/echo/:id', authenticate, async (req, res) => {
    const data = await getData();
    const idx = data.voiceEntries.findIndex(e => e._id === req.params.id);
    if (idx === -1) return res.status(404);
    data.voiceEntries.splice(idx, 1); await putData(data); res.json({ ok: true });
  });

  app.get('/api/echo/random/:kidId', authenticate, async (req, res) => {
    const data = await getData();
    const list = data.voiceEntries.filter(e => e.kidId === req.params.kidId);
    if (!list.length) return res.json(null);
    res.json(enrichVoice(list[Math.floor(Math.random() * list.length)], data));
  });

  app.get('/api/echo/dashboard/:kidId', authenticate, async (req, res) => {
    const data = await getData();
    const kid = data.kids.find(k => k._id === req.params.kidId);
    const entries = (data.voiceEntries||[]).filter(e => e.kidId === req.params.kidId).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const totalEntries = entries.length, allWords = [...new Set(entries.flatMap(e => extractWords(e.transcription)))], favorites = entries.filter(e => e.isFavorite).length;
    let streak = 0;
    if (entries.length) {
      const dates = [...new Set(entries.map(e => e.createdAt.slice(0,10)))].sort().reverse();
      const today = new Date().toISOString().slice(0,10); let check = today;
      for (const d of dates) { if (d === check || d === getPreviousDate(check)) { streak++; check = d; } else break; }
    }
    const wordFreq = {}; entries.forEach(e => { if (e.transcription) extractWords(e.transcription).forEach(w => { wordFreq[w] = (wordFreq[w] || 0) + 1; }); });
    const reactions = {}; entries.forEach(e => { if (e.reactions) e.reactions.forEach(r => { reactions[r] = (reactions[r] || 0) + 1; }); });
    res.json({ totalEntries, uniqueWords: allWords.length, favoriteCount: favorites, streak, topWords: Object.entries(wordFreq).sort((a,b)=>b[1]-a[1]).slice(0,50).map(([w,c])=>({word:w,count:c})), reactions, kidAge: kid?.birthDate ? calcAge(kid.birthDate, new Date().toISOString()) : null });
  });

  app.get('/api/echo/dictionary/:kidId', authenticate, async (req, res) => {
    const data = await getData();
    const entries = (data.voiceEntries||[]).filter(e => e.kidId === req.params.kidId && e.transcription);
    const wordMap = {};
    entries.forEach(e => { extractWords(e.transcription).forEach(w => { if (!wordMap[w]) wordMap[w] = { word: w, count: 0, entries: [] }; wordMap[w].count++; wordMap[w].entries.push({ _id: e._id, transcription: e.transcription, date: e.createdAt, audioUrl: e.audioData }); }); });
    res.json(Object.values(wordMap).map(w => ({ ...w, entries: w.entries.sort((a,b)=>new Date(a.date)-new Date(b.date)) })).sort((a,b)=>b.count-a.count));
  });

  app.get('/api/echo/evolution/:kidId/:word', authenticate, async (req, res) => {
    const data = await getData(), word = req.params.word.toLowerCase();
    const matches = (data.voiceEntries||[]).filter(e => e.kidId === req.params.kidId && e.transcription && extractWords(e.transcription).includes(word)).map(e => enrichVoice(e, data)).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    res.json({ word, entries: matches, total: matches.length });
  });

  app.get('/api/echo/tags/:kidId', authenticate, async (req, res) => {
    const data = await getData();
    const entries = (data.voiceEntries||[]).filter(e => e.kidId === req.params.kidId);
    const tagMap = {}; entries.forEach(e => { (e.tags||[]).forEach(t => { if (!tagMap[t]) tagMap[t] = { tag: t, count: 0 }; tagMap[t].count++; }); });
    res.json(Object.values(tagMap).sort((a,b)=>b.count-a.count));
  });

  app.get('/api/echo/milestones/:kidId', authenticate, async (req, res) => {
    const data = await getData();
    const kid = data.kids.find(k => k._id === req.params.kidId);
    if (!kid) return res.status(404);
    const entries = (data.voiceEntries||[]).filter(e => e.kidId === req.params.kidId).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const milestones = [];
    if (entries.length) { const f = entries[0]; milestones.push({ type:'first_recording', label:'First recording', date:f.createdAt, transcription:f.transcription||'🎧', entryId:f._id, icon:'🎙️' }); }
    const withText = entries.filter(e => e.transcription);
    if (withText.length) { const f = withText[0]; milestones.push({ type:'first_word', label:'First spoken word', date:f.createdAt, transcription:f.transcription, entryId:f._id, icon:'🔤' }); }
    const wc = withText.map(e => ({ entry:e, count:extractWords(e.transcription).length }));
    const f2 = wc.find(w => w.count >= 2); if (f2) milestones.push({ type:'first_sentence_2', label:'First 2 words together', date:f2.entry.createdAt, transcription:f2.entry.transcription, entryId:f2.entry._id, icon:'📝' });
    const f3 = wc.find(w => w.count >= 3); if (f3) milestones.push({ type:'first_sentence_3', label:'First 3+ word sentence', date:f3.entry.createdAt, transcription:f3.entry.transcription, entryId:f3.entry._id, icon:'📖' });
    const allW = {}; withText.forEach(e => { extractWords(e.transcription).forEach(w => { if (!allW[w]) allW[w] = { word:w, firstDate:e.createdAt, entryId:e._id }; }); });
    Object.values(allW).sort((a,b)=>new Date(a.firstDate)-new Date(b.firstDate)).slice(0,10).forEach(w => milestones.push({ type:'new_word', label:`New word: "${w.word}"`, date:w.firstDate, transcription:w.word, entryId:w.entryId, icon:'✨' }));
    res.json({ kidAge: kid?.birthDate ? calcAge(kid.birthDate, new Date().toISOString()) : null, milestones: milestones.sort((a,b)=>new Date(b.date)-new Date(a.date)) });
  });

  app.get('/api/echo/growth/:kidId', authenticate, async (req, res) => {
    const data = await getData();
    const entries = (data.voiceEntries||[]).filter(e => e.kidId === req.params.kidId).sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt));
    if (!entries.length) return res.json([]);
    const firstDate = new Date(entries[0].createdAt), today = new Date();
    const weeks = []; let cursor = new Date(firstDate); cursor.setDate(cursor.getDate() - cursor.getDay());
    while (cursor <= today) {
      const weekEnd = new Date(cursor); weekEnd.setDate(weekEnd.getDate() + 6);
      const weekEntries = entries.filter(e => { const d = new Date(e.createdAt); return d >= cursor && d <= weekEnd; });
      const allWords = new Set();
      entries.filter(e => new Date(e.createdAt) <= weekEnd).forEach(e => { if (e.transcription) extractWords(e.transcription).forEach(w => allWords.add(w)); });
      weeks.push({ weekStart: cursor.toISOString().slice(0,10), weekLabel: cursor.toLocaleDateString('en',{month:'short',day:'numeric'}), entries: weekEntries.length, cumulativeWords: allWords.size });
      cursor.setDate(cursor.getDate() + 7);
    }
    res.json(weeks);
  });

  app.get('/api/echo/weekly/:kidId', authenticate, async (req, res) => {
    const data = await getData();
    const entries = (data.voiceEntries||[]).filter(e => e.kidId === req.params.kidId).sort((a,b) => new Date(a.createdAt)-new Date(b.createdAt));
    if (!entries.length) return res.json([]);
    const weeks = {};
    entries.forEach(e => {
      const d = new Date(e.createdAt), dayOfWeek = d.getDay(), mon = new Date(d);
      mon.setDate(mon.getDate() - ((dayOfWeek === 0 ? 6 : dayOfWeek - 1))); const key = mon.toISOString().slice(0,10);
      if (!weeks[key]) weeks[key] = { weekStart: key, entries: [], words: new Set(), reactions: {} };
      weeks[key].entries.push(enrichVoice(e, data));
      if (e.transcription) extractWords(e.transcription).forEach(w => weeks[key].words.add(w));
      (e.reactions||[]).forEach(r => { weeks[key].reactions[r] = (weeks[key].reactions[r]||0) + 1; });
    });
    res.json(Object.values(weeks).map(w => {
      const sorted = [...w.entries].sort((a,b) => (b.reactions?.length||0) - (a.reactions?.length||0));
      const newWordsThisWeek = [...w.words].filter(word => { const f = entries.find(e => e.transcription && extractWords(e.transcription).includes(word)); return f && new Date(f.createdAt) >= new Date(w.weekStart) && new Date(f.createdAt) < new Date(new Date(w.weekStart).getTime()+7*86400000); });
      return { weekStart: w.weekStart, weekLabel: new Date(w.weekStart).toLocaleDateString('en',{month:'short',day:'numeric'}), count: w.entries.length, uniqueWords: w.words.size, newWords: newWordsThisWeek.slice(0,10), topReactions: Object.entries(w.reactions).sort((a,b)=>b[1]-a[1]).slice(0,3), bestEntry: sorted[0]?{_id:sorted[0]._id,transcription:sorted[0].transcription,reactions:sorted[0].reactions?.length||0}:null, entries: w.entries.slice(0,3).map(e=>({_id:e._id,transcription:e.transcription,age:e.age,reactionCount:e.reactions?.length||0})) };
    }).reverse());
  });

  app.get('/api/echo/timeline/:kidId', authenticate, async (req, res) => {
    const data = await getData();
    const entries = (data.voiceEntries||[]).filter(e => e.kidId === req.params.kidId).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));
    const months = {}; entries.forEach(e => { const key = e.createdAt.slice(0,7); if (!months[key]) months[key] = { month: key, entries: [], count: 0, words: new Set() }; months[key].entries.push(e); months[key].count++; if (e.transcription) extractWords(e.transcription).forEach(w => months[key].words.add(w)); });
    res.json(Object.values(months).map(m => ({ month: m.month, count: m.count, uniqueWords: m.words.size, topTranscription: m.entries.sort((a,b)=>(b.reactions?.length||0)-(a.reactions?.length||0))[0]?.transcription||'' })).reverse());
  });

  // ==================== DAILY LOG ====================
  app.get('/api/daily/:kidId', authenticate, async (req, res) => {
    const data = await getData();
    res.json((data.dailyLogs||[]).filter(e => e.kidId === req.params.kidId).sort((a,b) => new Date(b.date) - new Date(a.date)));
  });
  app.post('/api/daily/:kidId', authenticate, async (req, res) => {
    const data = await getData(); const kidId = req.params.kidId;
    if (!data.kids.some(k => k._id === kidId)) return res.status(404);
    const { date, mood, food, sleep, notes, activities } = req.body;
    const log = { _id: genId(), kidId, date: date || new Date().toISOString().slice(0,10), mood: mood||'', food: food||'', sleep: sleep||'', notes: notes||'', activities: activities||[], createdAt: new Date().toISOString() };
    data.dailyLogs.push(log); await putData(data); res.json(log);
  });
  app.put('/api/daily/:kidId/:id', authenticate, async (req, res) => {
    const data = await getData();
    const entry = (data.dailyLogs||[]).find(e => e._id === req.params.id && e.kidId === req.params.kidId);
    if (!entry) return res.status(404);
    ['date','mood','food','sleep','notes','activities'].forEach(f => { if (req.body[f] !== undefined) entry[f] = req.body[f]; });
    await putData(data); res.json(entry);
  });
  app.delete('/api/daily/:kidId/:id', authenticate, async (req, res) => {
    const data = await getData();
    const idx = (data.dailyLogs||[]).findIndex(e => e._id === req.params.id && e.kidId === req.params.kidId);
    if (idx === -1) return res.status(404);
    data.dailyLogs.splice(idx, 1); await putData(data); res.json({ ok: true });
  });

  // ==================== GROWTH ====================
  app.get('/api/growth/:kidId', authenticate, async (req, res) => {
    const data = await getData();
    res.json((data.growthRecords||[]).filter(e => e.kidId === req.params.kidId).sort((a,b) => new Date(b.date) - new Date(a.date)));
  });
  app.post('/api/growth/:kidId', authenticate, async (req, res) => {
    const data = await getData(); const kidId = req.params.kidId;
    if (!data.kids.some(k => k._id === kidId)) return res.status(404);
    const { date, height, weight, headCircumference, notes } = req.body;
    const record = { _id: genId(), kidId, date: date || new Date().toISOString().slice(0,10), height: Number(height)||0, weight: Number(weight)||0, headCircumference: Number(headCircumference)||0, notes: notes||'', createdAt: new Date().toISOString() };
    data.growthRecords.push(record); await putData(data); res.json(record);
  });
  app.delete('/api/growth/:kidId/:id', authenticate, async (req, res) => {
    const data = await getData();
    const idx = (data.growthRecords||[]).findIndex(e => e._id === req.params.id && e.kidId === req.params.kidId);
    if (idx === -1) return res.status(404);
    data.growthRecords.splice(idx, 1); await putData(data); res.json({ ok: true });
  });

  // ==================== TEETH ====================
  app.get('/api/teeth/:kidId', authenticate, async (req, res) => {
    const data = await getData();
    res.json((data.teethRecords||[]).filter(e => e.kidId === req.params.kidId).sort((a,b) => new Date(b.date) - new Date(a.date)));
  });
  app.post('/api/teeth/:kidId', authenticate, async (req, res) => {
    const data = await getData(); const kidId = req.params.kidId;
    if (!data.kids.some(k => k._id === kidId)) return res.status(404);
    const { date, tooth, type, notes, side } = req.body;
    const record = { _id: genId(), kidId, date: date||new Date().toISOString().slice(0,10), tooth: tooth||'', type: type||'erupted', side: side||'bottom', notes: notes||'', createdAt: new Date().toISOString() };
    data.teethRecords.push(record); await putData(data); res.json(record);
  });
  app.delete('/api/teeth/:kidId/:id', authenticate, async (req, res) => {
    const data = await getData();
    const idx = (data.teethRecords||[]).findIndex(e => e._id === req.params.id && e.kidId === req.params.kidId);
    if (idx === -1) return res.status(404);
    data.teethRecords.splice(idx, 1); await putData(data); res.json({ ok: true });
  });

  // ==================== PHOTOS ====================
  app.get('/api/photos/:kidId', authenticate, async (req, res) => {
    const data = await getData();
    res.json((data.photos||[]).filter(e => e.kidId === req.params.kidId).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)));
  });
  app.post('/api/photos/:kidId', authenticate, memoryUpload.single('image'), async (req, res) => {
    const data = await getData(); const kidId = req.params.kidId;
    if (!data.kids.some(k => k._id === kidId) || !req.file) return res.status(400);
    const { caption } = req.body;
    const photo = { _id: genId(), kidId, imageData: bufToDataUri(inferMime(req.file.originalname), req.file.buffer), caption: caption||'', createdAt: new Date().toISOString() };
    data.photos.push(photo); await putData(data);
    res.json({ ...photo, imageUrl: photo.imageData, age: (data.kids.find(k=>k._id===kidId)?.birthDate) ? calcAge(data.kids.find(k=>k._id===kidId).birthDate, photo.createdAt) : null });
  });
  app.delete('/api/photos/:kidId/:id', authenticate, async (req, res) => {
    const data = await getData();
    const idx = (data.photos||[]).findIndex(e => e._id === req.params.id && e.kidId === req.params.kidId);
    if (idx === -1) return res.status(404);
    data.photos.splice(idx, 1); await putData(data); res.json({ ok: true });
  });

  // ==================== ART ====================
  app.get('/api/art/:kidId', authenticate, async (req, res) => {
    const data = await getData();
    res.json((data.artworks||[]).filter(e => e.kidId === req.params.kidId).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)));
  });
  app.post('/api/art/:kidId', authenticate, memoryUpload.single('image'), async (req, res) => {
    const data = await getData(); const kidId = req.params.kidId;
    if (!data.kids.some(k => k._id === kidId) || !req.file) return res.status(400);
    const { title, description } = req.body;
    const art = { _id: genId(), kidId, imageData: bufToDataUri(inferMime(req.file.originalname), req.file.buffer), title: title||'', description: description||'', createdAt: new Date().toISOString() };
    data.artworks.push(art); await putData(data);
    res.json({ ...art, imageUrl: art.imageData, age: (data.kids.find(k=>k._id===kidId)?.birthDate) ? calcAge(data.kids.find(k=>k._id===kidId).birthDate, art.createdAt) : null });
  });
  app.delete('/api/art/:kidId/:id', authenticate, async (req, res) => {
    const data = await getData();
    const idx = (data.artworks||[]).findIndex(e => e._id === req.params.id && e.kidId === req.params.kidId);
    if (idx === -1) return res.status(404);
    data.artworks.splice(idx, 1); await putData(data); res.json({ ok: true });
  });

  // ==================== READING ====================
  app.get('/api/reading/:kidId', authenticate, async (req, res) => {
    const data = await getData();
    res.json((data.readingLogs||[]).filter(e => e.kidId === req.params.kidId).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)));
  });
  app.post('/api/reading/:kidId', authenticate, memoryUpload.single('audio'), async (req, res) => {
    const data = await getData(); const kidId = req.params.kidId;
    if (!data.kids.some(k => k._id === kidId)) return res.status(404);
    const { bookTitle, author, date, reaction, notes } = req.body;
    const log = { _id: genId(), kidId, bookTitle: bookTitle||'', author: author||'', date: date||new Date().toISOString().slice(0,10), reaction: reaction||'', notes: notes||'', audioData: req.file ? bufToDataUri(inferMime(req.file.originalname), req.file.buffer) : null, createdAt: new Date().toISOString() };
    data.readingLogs.push(log); await putData(data);
    res.json({ ...log, audioUrl: log.audioData });
  });
  app.delete('/api/reading/:kidId/:id', authenticate, async (req, res) => {
    const data = await getData();
    const idx = (data.readingLogs||[]).findIndex(e => e._id === req.params.id && e.kidId === req.params.kidId);
    if (idx === -1) return res.status(404);
    data.readingLogs.splice(idx, 1); await putData(data); res.json({ ok: true });
  });

  // ==================== MEDICAL ====================
  const EPI_SCHEDULE = [
    { vaccine:'BCG', age:'At birth', doses:1 }, { vaccine:'Hepatitis B', age:'At birth, 6 weeks, 10 weeks, 14 weeks', doses:4 },
    { vaccine:'OPV', age:'At birth, 6 weeks, 10 weeks, 14 weeks', doses:4 }, { vaccine:'Pentavalent', age:'6 weeks, 10 weeks, 14 weeks', doses:3 },
    { vaccine:'PCV', age:'6 weeks, 10 weeks, 14 weeks', doses:3 }, { vaccine:'IPV', age:'14 weeks', doses:1 },
    { vaccine:'Measles 1', age:'9 months', doses:1 }, { vaccine:'Measles 2', age:'15 months', doses:1 },
    { vaccine:'Typhoid', age:'2 years (and every 3 years)', doses:1 }
  ];
  app.get('/api/vaccines/:kidId', authenticate, async (req, res) => {
    const data = await getData();
    res.json({ schedule: EPI_SCHEDULE, records: (data.vaccines||[]).filter(e => e.kidId === req.params.kidId).sort((a,b) => new Date(b.date) - new Date(a.date)) });
  });
  app.post('/api/vaccines/:kidId', authenticate, async (req, res) => {
    const data = await getData(); const kidId = req.params.kidId;
    if (!data.kids.some(k => k._id === kidId)) return res.status(404);
    const { vaccine, date, provider, notes, dose, doseLabel } = req.body;
    const v = { _id: genId(), kidId, vaccine: vaccine||'', date: date||new Date().toISOString().slice(0,10), provider: provider||'', notes: notes||'', dose: dose||'', doseLabel: doseLabel||'', createdAt: new Date().toISOString() };
    data.vaccines.push(v); await putData(data); res.json(v);
  });
  app.delete('/api/vaccines/:kidId/:id', authenticate, async (req, res) => {
    const data = await getData();
    const idx = (data.vaccines||[]).findIndex(e => e._id === req.params.id && e.kidId === req.params.kidId);
    if (idx === -1) return res.status(404); data.vaccines.splice(idx, 1); await putData(data); res.json({ ok: true });
  });
  app.get('/api/visits/:kidId', authenticate, async (req, res) => {
    const data = await getData();
    res.json((data.doctorVisits||[]).filter(e => e.kidId === req.params.kidId).sort((a,b) => new Date(b.date) - new Date(a.date)));
  });
  app.post('/api/visits/:kidId', authenticate, async (req, res) => {
    const data = await getData(); const kidId = req.params.kidId;
    if (!data.kids.some(k => k._id === kidId)) return res.status(404);
    const { date, reason, doctor, notes } = req.body;
    const v = { _id: genId(), kidId, date: date||new Date().toISOString().slice(0,10), reason: reason||'', doctor: doctor||'', notes: notes||'', createdAt: new Date().toISOString() };
    data.doctorVisits.push(v); await putData(data); res.json(v);
  });
  app.delete('/api/visits/:kidId/:id', authenticate, async (req, res) => {
    const data = await getData();
    const idx = (data.doctorVisits||[]).findIndex(e => e._id === req.params.id && e.kidId === req.params.kidId);
    if (idx === -1) return res.status(404); data.doctorVisits.splice(idx, 1); await putData(data); res.json({ ok: true });
  });

  // ==================== MILESTONES ====================
  const MILESTONE_TYPES = ['Rolling over','Sitting up','Crawling','Standing','Walking','First word','First steps','Waving','Clapping','Pointing','First tooth','Sleeping through','Self-feeding','Potty training','First sentence','Other'];
  app.get('/api/baby-milestones/:kidId', authenticate, async (req, res) => {
    const data = await getData();
    res.json({ types: MILESTONE_TYPES, milestones: (data.milestones||[]).filter(e => e.kidId === req.params.kidId).sort((a,b) => new Date(b.date) - new Date(a.date)).map(e => ({ ...e, photoUrl: e.photoData || null, age: (data.kids.find(k=>k._id===req.params.kidId)?.birthDate) ? calcAge(data.kids.find(k=>k._id===req.params.kidId).birthDate, e.date) : null })) });
  });
  app.post('/api/baby-milestones/:kidId', authenticate, memoryUpload.single('photo'), async (req, res) => {
    const data = await getData(); const kidId = req.params.kidId;
    if (!data.kids.some(k => k._id === kidId)) return res.status(404);
    const { type, date, notes } = req.body;
    const m = { _id: genId(), kidId, type: type||'', date: date||new Date().toISOString().slice(0,10), notes: notes||'', photoData: req.file ? bufToDataUri(inferMime(req.file.originalname), req.file.buffer) : null, createdAt: new Date().toISOString() };
    data.milestones.push(m); await putData(data);
    res.json({ ...m, photoUrl: m.photoData });
  });
  app.delete('/api/baby-milestones/:kidId/:id', authenticate, async (req, res) => {
    const data = await getData();
    const idx = (data.milestones||[]).findIndex(e => e._id === req.params.id && e.kidId === req.params.kidId);
    if (idx === -1) return res.status(404);
    data.milestones.splice(idx, 1); await putData(data); res.json({ ok: true });
  });

  // ==================== FAMILY ====================
  app.get('/api/family/:kidId', authenticate, async (req, res) => {
    const data = await getData();
    res.json((data.familyMembers||[]).filter(e => e.kidId === req.params.kidId));
  });
  app.post('/api/family/:kidId', authenticate, async (req, res) => {
    const data = await getData(); const kidId = req.params.kidId;
    if (!data.kids.some(k => k._id === kidId)) return res.status(404);
    const { name, relation } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const token = genId();
    const member = { _id: genId(), kidId, name, relation: relation||'', token, createdAt: new Date().toISOString() };
    data.familyMembers.push(member); await putData(data); res.json(member);
  });
  app.delete('/api/family/:kidId/:id', authenticate, async (req, res) => {
    const data = await getData();
    const idx = (data.familyMembers||[]).findIndex(e => e._id === req.params.id && e.kidId === req.params.kidId);
    if (idx === -1) return res.status(404); data.familyMembers.splice(idx, 1); await putData(data); res.json({ ok: true });
  });

  // Family view (no auth required)
  app.get('/api/family-view/:token', async (req, res) => {
    const data = await getData();
    const member = (data.familyMembers||[]).find(m => m.token === req.params.token);
    if (!member) return res.status(404).json({ error: 'Invalid link' });
    const kid = data.kids.find(k => k._id === member.kidId);
    if (!kid) return res.status(404);
    const recent = (data.voiceEntries||[]).filter(e => e.kidId === member.kidId).sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt)).slice(0,20).map(e => enrichVoice(e, data));
    const recentPhotos = (data.photos||[]).filter(e => e.kidId === member.kidId).sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt)).slice(0,20).map(p => ({ ...p, imageUrl: p.imageData, age: kid.birthDate ? calcAge(kid.birthDate, p.createdAt) : null }));
    res.json({ kid: { name: kid.name, birthDate: kid.birthDate, age: kid.birthDate ? calcAge(kid.birthDate, new Date().toISOString()) : null }, member: { name: member.name, relation: member.relation }, recent, recentPhotos });
  });

  // ==================== DASHBOARD ====================
  app.get('/api/dashboard/:kidId', authenticate, async (req, res) => {
    const data = await getData(); const kidId = req.params.kidId;
    const kid = data.kids.find(k => k._id === kidId);
    const voiceCount = (data.voiceEntries||[]).filter(e => e.kidId === kidId).length;
    const dailyCount = (data.dailyLogs||[]).filter(e => e.kidId === kidId).length;
    const photoCount = (data.photos||[]).filter(e => e.kidId === kidId).length;
    const readingCount = (data.readingLogs||[]).filter(e => e.kidId === kidId).length;
    const milestoneCount = (data.milestones||[]).filter(e => e.kidId === kidId).length;
    const teethCount = (data.teethRecords||[]).filter(e => e.kidId === kidId).length;
    const growthCount = (data.growthRecords||[]).filter(e => e.kidId === kidId).length;
    const artCount = (data.artworks||[]).filter(e => e.kidId === kidId).length;
    const lastVoice = (data.voiceEntries||[]).filter(e => e.kidId === kidId).sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt))[0];
    const achievements = computeAchievements(kidId, data);
    const earnedAchievements = achievements.filter(a => a.earned).length;
    res.json({ kidAge: kid?.birthDate ? calcAge(kid.birthDate, new Date().toISOString()) : null, voiceCount, dailyCount, photoCount, readingCount, milestoneCount, teethCount, growthCount, artCount, earnedAchievements, lastVoice: lastVoice ? enrichVoice(lastVoice, data) : null });
  });

  // ==================== SHARE ====================
  app.get('/share/:entryId', async (req, res) => {
    const data = await getData();
    const entry = (data.voiceEntries||[]).find(e => e._id === req.params.entryId);
    if (!entry) return res.status(404).send('<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fefcf5;color:#1c1917"><div style="text-align:center"><h2>Not found</h2></div></body></html>');
    const kid = data.kids.find(k => k._id === entry.kidId);
    const enriched = enrichVoice(entry, data);
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${escHtml(kid?.name||'A child')} said "${escHtml(entry.transcription||'a voice note').slice(0,60)}"</title><link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Inter,sans-serif;background:linear-gradient(135deg,#fefcf5 0%,#fff1f2 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.card{max-width:440px;width:100%;background:#fff;border-radius:24px;padding:32px;box-shadow:0 4px 24px rgba(0,0,0,.06),0 12px 48px rgba(225,29,72,.08);text-align:center}.brand{font-family:'DM Serif Display',serif;font-style:italic;font-size:20px;color:#e11d48;margin-bottom:20px;display:block}.age{display:inline-block;background:#fff1f2;color:#e11d48;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;margin-bottom:16px}.transcript{font-family:'DM Serif Display',serif;font-size:28px;line-height:1.3;color:#1c1917;margin-bottom:12px;font-style:italic}.kid{font-size:16px;font-weight:600;color:#a8a29e;margin-bottom:4px}.date{font-size:13px;color:#a8a29e;margin-bottom:20px}audio{width:100%;margin-bottom:16px;border-radius:10px}.footer{font-size:11px;color:#d6d3d1}</style></head><body><div class="card"><span class="brand">echo.</span><div class="age">🎂 ${enriched.age||'Baby'}</div><div class="transcript">"${escHtml(entry.transcription||'🎧')}"</div><div class="kid">— ${escHtml(kid?.name||'Unknown')}</div><div class="date">${new Date(entry.createdAt).toLocaleDateString('en',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</div>${entry.audioData?`<audio controls src="${escHtml(entry.audioData)}" preload="metadata"></audio>`:''}<div class="footer">Made with Little Life 🎙️</div></div></body></html>`);
  });

  // ==================== MIGRATION ====================
  app.get('/api/admin/migrate', async (req, res) => {
    const data = await getData();
    let changed = false;
    function migrateList(list) {
      if (!list) return;
      list.forEach(item => {
        if (item.id && !item._id) { item._id = item.id; delete item.id; changed = true; }
        if (!item._id) { item._id = genId(); changed = true; }
      });
    }
    migrateList(data.kids); migrateList(data.voiceEntries); migrateList(data.dailyLogs);
    migrateList(data.growthRecords); migrateList(data.teethRecords); migrateList(data.photos);
    migrateList(data.artworks); migrateList(data.readingLogs); migrateList(data.vaccines);
    migrateList(data.doctorVisits); migrateList(data.milestones); migrateList(data.familyMembers);
    let defaultUserId = null;
    if (data.users && data.users.length > 0) defaultUserId = data.users[0]._id;
    data.kids.forEach(k => { if (!k.userId && defaultUserId) { k.userId = defaultUserId; changed = true; } });
    // Convert file-based entries to data URIs
    const fs = require('fs');
    const path = require('path');
    const REC_DIR = path.join(__dirname, 'recordings');
    async function convertFiles() {
      for (const e of (data.voiceEntries||[])) {
        if (e.audioFile && !e.audioData) {
          const fp = path.join(REC_DIR, e.audioFile);
          if (fs.existsSync(fp)) { e.audioData = bufToDataUri(inferMime(e.audioFile), fs.readFileSync(fp)); changed = true; }
        }
        if (e.photoFile && !e.photoData) {
          const fp = path.join(REC_DIR, e.photoFile);
          if (fs.existsSync(fp)) { e.photoData = bufToDataUri(inferMime(e.photoFile), fs.readFileSync(fp)); changed = true; }
        }
      }
      for (const p of (data.photos||[])) {
        if (p.imageFile && !p.imageData) {
          const fp = path.join(REC_DIR, p.imageFile);
          if (fs.existsSync(fp)) { p.imageData = bufToDataUri(inferMime(p.imageFile), fs.readFileSync(fp)); changed = true; }
        }
      }
      for (const a of (data.artworks||[])) {
        if (a.imageFile && !a.imageData) {
          const fp = path.join(REC_DIR, a.imageFile);
          if (fs.existsSync(fp)) { a.imageData = bufToDataUri(inferMime(a.imageFile), fs.readFileSync(fp)); changed = true; }
        }
      }
      for (const r of (data.readingLogs||[])) {
        if (r.audioFile && !r.audioData) {
          const fp = path.join(REC_DIR, r.audioFile);
          if (fs.existsSync(fp)) { r.audioData = bufToDataUri(inferMime(r.audioFile), fs.readFileSync(fp)); changed = true; }
        }
      }
      for (const m of (data.milestones||[])) {
        if (m.photoFile && !m.photoData) {
          const fp = path.join(REC_DIR, m.photoFile);
          if (fs.existsSync(fp)) { m.photoData = bufToDataUri(inferMime(m.photoFile), fs.readFileSync(fp)); changed = true; }
        }
      }
    }
    await convertFiles();
    if (changed) await putData(data);
    res.json({ migrated: changed, kidCount: data.kids.length, userCount: (data.users||[]).length });
  });

  return app;
}

// Local standalone server
if (require.main === module) {
  const PORT = process.env.PORT || 3008;
  const app = createApp();
  app.listen(PORT, '0.0.0.0', () => console.log(`Little Life running on port ${PORT}`));
}

module.exports = { createApp };
