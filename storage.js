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
  const isVercel = !!process.env.VERCEL;
  if (isVercel) {
    const { put, get } = await import('@vercel/blob');
    const BLOB_KEY = 'data.json';
    store = {
      async load() {
        try {
          const blob = await get(BLOB_KEY);
          if (!blob) return getDefaultData();
          return JSON.parse(await blob.text());
        } catch { return getDefaultData(); }
      },
      async save(data) {
        await put(BLOB_KEY, JSON.stringify(data), { contentType: 'application/json', access: 'private' });
      }
    };
  } else {
    const fs = require('fs');
    const path = require('path');
    const DB_FILE = path.join(__dirname, 'data.json');
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
