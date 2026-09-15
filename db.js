const mysql = require('mysql2/promise');
const mongoose = require('mongoose');

// 1. MySQL Connection Pool
const dbPool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || 'YOUR_MYSQL_PASSWORD', // Insert your real password here
  database: process.env.MYSQL_DB || 'library_db',
  waitForConnections: true,
  connectionLimit: 10
});

// 2. MongoDB Connection
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/library_nosql')
  .then(() => console.log('✅ MongoDB Connected Successfully'))
  .catch(err => console.error('❌ MongoDB Error:', err.message));

const ReviewSchema = new mongoose.Schema({
  book_id: Number,
  user_email: String,
  rating: Number,
  comment: String,
  created_at: { type: Date, default: Date.now }
});

const Review = mongoose.model('Book_Review', ReviewSchema);

// Safe Mock Redis client so server.js runs smoothly without WSL/Redis installed
const redisClient = {
  isOpen: false,
  get: async () => null,
  setEx: async () => {},
  del: async () => {}
};

module.exports = { dbPool, Review, redisClient };