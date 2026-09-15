const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const { dbPool, Review, redisClient } = require('./db');

const app = express();
const JWT_SECRET = 'super_secret_library_key';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- AUTHENTICATION & RBAC ---
app.post('/api/auth/login', async (req, res) => {
  const { email, role } = req.body;
  try {
    const [users] = await dbPool.query('SELECT * FROM Users WHERE email = ?', [email]);
    if (users.length === 0) return res.status(401).json({ error: 'User not found' });
    
    const token = jwt.sign({ id: users[0].user_id, role: users[0].role || role }, JWT_SECRET);
    res.json({ token, role: users[0].role || role, name: users[0].name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- BOOK MANAGEMENT & REDIS CACHING ---
app.get('/api/books', async (req, res) => {
  try {
    if (redisClient.isOpen) {
      const cachedBooks = await redisClient.get('all_books');
      if (cachedBooks) return res.json(JSON.parse(cachedBooks));
    }

    const [rows] = await dbPool.query(`
      SELECT b.book_id, b.title, b.isbn, b.available_copies, b.total_copies, b.shelf_number,
             CONCAT(a.first_name, ' ', a.last_name) AS author, c.category_name
      FROM Books b
      LEFT JOIN Authors a ON b.author_id = a.author_id
      LEFT JOIN Categories c ON b.category_id = c.category_id
    `);

    if (redisClient.isOpen) await redisClient.setEx('all_books', 60, JSON.stringify(rows));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/books', async (req, res) => {
  const { title, isbn, author_id, category_id, total_copies, shelf_number } = req.body;
  try {
    await dbPool.query(
      `INSERT INTO Books (title, isbn, author_id, category_id, total_copies, available_copies, shelf_number) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [title, isbn, author_id, category_id, total_copies, total_copies, shelf_number]
    );
    if (redisClient.isOpen) await redisClient.del('all_books');
    res.json({ message: 'Book added successfully!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ISSUE & RETURN TRANSACTIONS ---
app.post('/api/transactions/issue', async (req, res) => {
  const { memberId, bookId, daysValid } = req.body;
  try {
    await dbPool.query('CALL IssueBook(?, ?, ?)', [memberId, bookId, daysValid || 14]);
    if (redisClient.isOpen) await redisClient.del('all_books');
    res.json({ message: 'Book issued successfully!' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/transactions/return', async (req, res) => {
  const { transactionId } = req.body;
  const conn = await dbPool.getConnection();
  try {
    await conn.beginTransaction();
    
    const [tx] = await conn.query('SELECT * FROM Borrow_Transactions WHERE transaction_id = ?', [transactionId]);
    if (!tx.length) throw new Error('Transaction record not found');
    
    const dueDate = new Date(tx[0].due_date);
    const today = new Date();
    let fineAmount = 0;

    if (today > dueDate) {
      const diffDays = Math.ceil((today - dueDate) / (1000 * 60 * 60 * 24));
      fineAmount = diffDays * 5;
    }

    await conn.query('UPDATE Borrow_Transactions SET status = "Returned", return_date = NOW() WHERE transaction_id = ?', [transactionId]);
    await conn.query('UPDATE Books SET available_copies = available_copies + 1 WHERE book_id = ?', [tx[0].book_id]);
    
    if (fineAmount > 0) {
      await conn.query('INSERT INTO Fines (member_id, transaction_id, fine_amount, status) VALUES (?, ?, ?, "Pending")', 
        [tx[0].member_id, transactionId, fineAmount]);
    }

    await conn.commit();
    if (redisClient.isOpen) await redisClient.del('all_books');
    res.json({ message: 'Book returned successfully!', fineAmount });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// --- DASHBOARD ANALYTICS & REPORTS ---
app.get('/api/reports/dashboard', async (req, res) => {
  try {
    const [[books]] = await dbPool.query('SELECT COUNT(*) as total_books, SUM(available_copies) as available FROM Books');
    const [[members]] = await dbPool.query('SELECT COUNT(*) as total_members FROM Members');
    const [[issued]] = await dbPool.query('SELECT COUNT(*) as total_issued FROM Borrow_Transactions WHERE status = "Issued"');
    const [[fines]] = await dbPool.query('SELECT IFNULL(SUM(fine_amount), 0) as total_fines FROM Fines WHERE status = "Pending"');

    res.json({
      totalBooks: books.total_books || 0,
      availableBooks: books.available || 0,
      totalMembers: members.total_members || 0,
      issuedBooks: issued.total_issued || 0,
      pendingFines: fines.total_fines || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- FALLBACK ROUTE ---
// --- FALLBACK ROUTE ---
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Smart Library Platform Live on http://localhost:${PORT}`));