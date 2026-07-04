let store = null;

function getDefaultData() {
  return {
    users: [], kids: [], voiceEntries: [], dailyLogs: [], growthRecords: [],
    teethRecords: [], photos: [], artworks: [], readingLogs: [], vaccines: [],
    doctorVisits: [], milestones: [], familyMembers: [], achievements: []
  };
}

async function getStorage() {
  if (store) return store;

  if (process.env.VERCEL && process.env.BLOB_READ_WRITE_TOKEN) {
    const { put, head } = require('@vercel/blob');
    const KEY = 'data.json';
    store = {
      async load() {
        try {
          const info = await head(KEY);
          const res = await fetch(info.url);
          return res.ok ? JSON.parse(await res.text()) : getDefaultData();
        } catch { return getDefaultData(); }
      },
      async save(data) {
        await put(KEY, JSON.stringify(data), {
          contentType: 'application/json', access: 'public', allowOverwrite: true
        });
      }
    };
  } else {
    const fs = require('fs');
    const path = require('path');
    const DB_FILE = process.env.VERCEL ? '/tmp/data.json' : path.join(__dirname, 'data.json');
    store = {
      async load() {
        try {
          if (!fs.existsSync(DB_FILE)) return getDefaultData();
          return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        } catch { return getDefaultData(); }
      },
      async save(data) {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
      }
    };
  }
  return store;
}

module.exports = { getStorage, getDefaultData };
