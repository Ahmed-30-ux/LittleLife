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
  const fs = require('fs');
  const DB_FILE = process.env.VERCEL ? '/tmp/data.json' : require('path').join(__dirname, 'data.json');
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
  return store;
}

module.exports = { getStorage, getDefaultData };
