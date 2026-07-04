// Storage abstraction — works locally with data.json, on Netlify with Blobs
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
  const isNetlify = !!process.env.NETLIFY;
  if (isNetlify) {
    const { getStore } = await import('@netlify/blobs');
    const blobStore = getStore('little-life-data');
    store = {
      async load() {
        try {
          const data = await blobStore.get('main', { type: 'json' });
          return data || getDefaultData();
        } catch { return getDefaultData(); }
      },
      async save(data) {
        await blobStore.setJSON('main', data);
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
