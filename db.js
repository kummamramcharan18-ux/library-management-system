const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.resolve(__dirname, 'library.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // Users Table with RBAC (Lab 12)
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT CHECK(role IN ('Admin', 'Student')) DEFAULT 'Student',
    phone TEXT,
    department TEXT,
    year TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Books Table (Requirement Section 5)
  db.run(`CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    isbn TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    author TEXT NOT NULL,
    category TEXT NOT NULL,
    publisher TEXT,
    pub_year INTEGER,
    language TEXT DEFAULT 'English',
    total_copies INTEGER DEFAULT 1,
    available_copies INTEGER DEFAULT 1,
    shelf_location TEXT,
    status TEXT DEFAULT 'Available'
  )`);

  // Transactions Table (Requirement Section 4 & Lab 7)
  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    book_id INTEGER,
    issue_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    return_date TEXT,
    fine_amount REAL DEFAULT 0.0,
    fine_status TEXT CHECK(fine_status IN ('None', 'Pending', 'Paid')) DEFAULT 'None',
    status TEXT CHECK(status IN ('Issued', 'Returned')) DEFAULT 'Issued',
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(book_id) REFERENCES books(id)
  )`);

  // Seed Admin Account & Default Catalog
  const adminPassword = bcrypt.hashSync('admin123', 10);
  db.run(`INSERT OR IGNORE INTO users (id, name, email, password, role, department) 
          VALUES (1, 'System Administrator', 'admin@library.com', ?, 'Admin', 'Library Operations')`, [adminPassword]);

  db.run(`INSERT OR IGNORE INTO books (id, isbn, title, author, category, publisher, pub_year, total_copies, available_copies, shelf_location)
          VALUES 
          (1, '978-0132350884', 'Clean Code', 'Robert C. Martin', 'Computer Science', 'Prentice Hall', 2008, 5, 4, 'Rack A-3'),
          (2, '978-0201633610', 'Design Patterns', 'Erich Gamma', 'Software Engineering', 'Addison-Wesley', 1994, 3, 2, 'Rack A-4'),
          (3, '978-0596007126', 'Head First Design Patterns', 'Eric Freeman', 'Computer Science', 'O Reilly', 2004, 4, 3, 'Rack B-1')`);
});

module.exports = db;
