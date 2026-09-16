const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: 'smart_lms_capstone_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// SAFE MONGODB CONNECTION (Lab 8 - Optional Cloud Handler)
if (process.env.MONGODB_URI) {
  try {
    const mongoose = require('mongoose');
    mongoose.connect(process.env.MONGODB_URI)
      .then(() => console.log('Connected to MongoDB Cloud'))
      .catch(err => console.log('MongoDB connection skipped:', err.message));
  } catch (err) {
    console.log('Mongoose package not active, using fallback JSON mode.');
  }
} else {
  console.log('No MONGODB_URI set. Running MongoDB endpoints in mock/demo mode.');
}

// Middleware: Authentication & RBAC (Lab 12)
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'Admin') {
    return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
  }
  next();
}

// --- AUTHENTICATION ENDPOINTS (Lab 12) ---
app.post('/api/auth/register', (req, res) => {
  const { name, email, password, phone, department, year, role } = req.body;
  const userRole = role || 'Student';
  const hashedPassword = bcrypt.hashSync(password, 10);

  db.run(
    `INSERT INTO users (name, email, password, role, phone, department, year) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [name, email, hashedPassword, userRole, phone || '', department || '', year || ''],
    function (err) {
      if (err) return res.status(400).json({ error: 'Email already registered.' });
      res.json({ message: 'Registration successful! Please login.' });
    }
  );
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, user) => {
    if (err || !user) return res.status(400).json({ error: 'Invalid email or password.' });

    const isValid = bcrypt.compareSync(password, user.password);
    if (!isValid) return res.status(400).json({ error: 'Invalid email or password.' });

    req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    res.json({ message: 'Login successful', user: req.session.user });
  });
});

app.get('/api/auth/me', (req, res) => {
  if (req.session.user) res.json({ loggedIn: true, user: req.session.user });
  else res.json({ loggedIn: false });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ message: 'Logged out successfully' });
});

// --- DASHBOARD & ANALYTICS (Lab 4, 6) ---
app.get('/api/dashboard/stats', (req, res) => {
  db.serialize(() => {
    let stats = {};
    db.get(`SELECT COUNT(*) as totalBooks, SUM(available_copies) as availableCopies FROM books`, [], (err, row) => {
      stats.totalBooks = row ? row.totalBooks : 0;
      stats.availableCopies = row ? row.availableCopies : 0;
      db.get(`SELECT COUNT(*) as totalMembers FROM users WHERE role = 'Student'`, [], (err, row2) => {
        stats.totalMembers = row2 ? row2.totalMembers : 0;
        db.get(`SELECT COUNT(*) as activeLoans FROM transactions WHERE status = 'Issued'`, [], (err, row3) => {
          stats.activeLoans = row3 ? row3.activeLoans : 0;
          db.get(`SELECT SUM(fine_amount) as pendingFines FROM transactions WHERE fine_status = 'Pending'`, [], (err, row4) => {
            stats.pendingFines = row4 && row4.pendingFines ? row4.pendingFines : 0;
            res.json(stats);
          });
        });
      });
    });
  });
});

// --- BOOK MANAGEMENT ENDPOINTS (Lab 3) ---
app.get('/api/books', (req, res) => {
  const { search, category } = req.query;
  let query = `SELECT * FROM books WHERE 1=1`;
  let params = [];

  if (search) {
    query += ` AND (title LIKE ? OR author LIKE ? OR isbn LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (category) {
    query += ` AND category = ?`;
    params.push(category);
  }

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/books', requireAdmin, (req, res) => {
  const { isbn, title, author, category, publisher, pub_year, language, total_copies, shelf_location } = req.body;
  db.run(
    `INSERT INTO books (isbn, title, author, category, publisher, pub_year, language, total_copies, available_copies, shelf_location) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [isbn, title, author, category, publisher, pub_year, language || 'English', total_copies, total_copies, shelf_location],
    function (err) {
      if (err) return res.status(400).json({ error: err.message });
      res.json({ message: 'Book added successfully', id: this.lastID });
    }
  );
});

// --- ISSUE & RETURN TRANSACTIONS WITH CONCURRENCY & FINES (Lab 7) ---
app.post('/api/transactions/issue', requireAdmin, (req, res) => {
  const { user_id, book_id, due_days } = req.body;
  const issueDate = new Date().toISOString().split('T')[0];
  const due = new Date();
  due.setDate(due.getDate() + (parseInt(due_days) || 14));
  const dueDate = due.toISOString().split('T')[0];

  db.get(`SELECT available_copies FROM books WHERE id = ?`, [book_id], (err, book) => {
    if (err || !book || book.available_copies <= 0) {
      return res.status(400).json({ error: 'Book is currently unavailable.' });
    }

    db.serialize(() => {
      db.run(`BEGIN TRANSACTION`);
      db.run(`UPDATE books SET available_copies = available_copies - 1 WHERE id = ?`, [book_id]);
      db.run(
        `INSERT INTO transactions (user_id, book_id, issue_date, due_date, status) VALUES (?, ?, ?, ?, 'Issued')`,
        [user_id, book_id, issueDate, dueDate]
      );
      db.run(`COMMIT`, (err) => {
        if (err) return res.status(500).json({ error: 'Transaction failed.' });
        res.json({ message: 'Book issued successfully!', issueDate, dueDate });
      });
    });
  });
});

app.post('/api/transactions/return', requireAdmin, (req, res) => {
  const { transaction_id } = req.body;
  const returnDate = new Date().toISOString().split('T')[0];

  db.get(`SELECT * FROM transactions WHERE id = ? AND status = 'Issued'`, [transaction_id], (err, tx) => {
    if (err || !tx) return res.status(400).json({ error: 'Active transaction not found.' });

    const dueDate = new Date(tx.due_date);
    const retDate = new Date(returnDate);
    let fine = 0;
    if (retDate > dueDate) {
      const diffDays = Math.ceil((retDate - dueDate) / (1000 * 60 * 60 * 24));
      fine = diffDays * 2;
    }
    const fineStatus = fine > 0 ? 'Pending' : 'None';

    db.serialize(() => {
      db.run(`BEGIN TRANSACTION`);
      db.run(`UPDATE books SET available_copies = available_copies + 1 WHERE id = ?`, [tx.book_id]);
      db.run(
        `UPDATE transactions SET return_date = ?, fine_amount = ?, fine_status = ?, status = 'Returned' WHERE id = ?`,
        [returnDate, fine, fineStatus, transaction_id]
      );
      db.run(`COMMIT`, (err) => {
        if (err) return res.status(500).json({ error: 'Return processing failed.' });
        res.json({ message: 'Book returned successfully!', fineAmount: fine, fineStatus });
      });
    });
  });
});

// --- ADVANCED DATABASE MOCK ENDPOINTS (Labs 8, 9, 11) ---
app.get('/api/recommendations', requireAuth, (req, res) => {
  db.all(`SELECT * FROM books ORDER BY RANDOM() LIMIT 3`, [], (err, rows) => {
    res.json({ source: 'Neo4j Graph Recommendation Engine (Lab 11)', recommendations: rows });
  });
});

app.get('/api/cache/stats', (req, res) => {
  res.json({ source: 'Redis Caching Service (Lab 9)', cachedKeys: ['popular_books', 'dashboard_stats'], hitRatio: '94.2%' });
});

app.get('/api/nosql/reviews', (req, res) => {
  res.json({ source: 'MongoDB Unstructured Reviews Engine (Lab 8)', reviews: [
    { bookTitle: 'Clean Code', user: 'Ram Charan', rating: 5, comment: 'Essential read for software engineering principles!' },
    { bookTitle: 'Head First Design Patterns', user: 'Sarah Jenkins', rating: 4, comment: 'Great visualization of complex patterns.' }
  ]});
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
