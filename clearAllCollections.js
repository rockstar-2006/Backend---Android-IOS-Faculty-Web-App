/**
 * clearAllCollections.js
 * Deletes ALL documents from every collection in the faculty_quest database.
 * Run with: node clearAllCollections.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

const models = [
  { name: 'User',        path: './models/User' },
  { name: 'Quiz',        path: './models/Quiz' },
  { name: 'QuizAttempt', path: './models/QuizAttempt' },
  { name: 'Student',     path: './models/Student' },
  { name: 'StudentAuth', path: './models/StudentAuth' },
  { name: 'Bookmark',    path: './models/Bookmark' },
  { name: 'Folder',      path: './models/Folder' },
];

async function clearAll() {
  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to:', MONGODB_URI.split('@')[1]);

  for (const { name, path } of models) {
    try {
      const Model = require(path);
      const result = await Model.deleteMany({});
      console.log(`🗑️  ${name}: deleted ${result.deletedCount} document(s)`);
    } catch (err) {
      console.error(`❌ Failed to clear ${name}:`, err.message);
    }
  }

  await mongoose.disconnect();
  console.log('\n✅ All collections cleared. Disconnected from MongoDB.');
}

clearAll().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
