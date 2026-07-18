const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongod;

// Runs once before all test files: spins up a real, temporary, in-memory
// MongoDB so tests exercise real Mongoose behavior without touching the
// actual Atlas database.
beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-jest-only';
  await mongoose.connect(mongod.getUri());
}, 30000);

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});
