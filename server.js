const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Ініціалізація бази даних SQLite
const db = new sqlite3.Database('./dealpay.sqlite', (err) => {
  if (err) console.error('Помилка БД:', err.message);
  else console.log('Успішне підключення до бази даних DealPay SQLite');
});

// Створення таблиць
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      price REAL NOT NULL,
      rating TEXT DEFAULT '5.0',
      desc TEXT,
      seller TEXT DEFAULT '@dealpay_seller'
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_code TEXT UNIQUE,
      product_title TEXT,
      price REAL,
      fee REAL,
      total REAL,
      buyer TEXT,
      seller TEXT,
      status TEXT DEFAULT 'pending'
    )
  `);
});

// REST API: Отримати всі товари
app.get('/api/products', (req, res) => {
  db.all('SELECT * FROM products ORDER BY id DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// REST API: Додати новий товар (Продавець)
app.post('/api/products', (req, res) => {
  const { title, category, price, desc, seller } = req.body;
  if (!title || !price) return res.status(400).json({ error: 'Заповніть назву та ціну' });

  const stmt = db.prepare('INSERT INTO products (title, category, price, desc, seller) VALUES (?, ?, ?, ?, ?)');
  stmt.run([title, category, price, desc || 'Без опису', seller || '@seller'], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, title, category, price, desc, seller });
  });
  stmt.finalize();
});

// REST API: Створити нове замовлення та платіжне посилання
app.post('/api/orders/create', async (req, res) => {
  const { product_title, price, buyer, seller, payment_method } = req.body;
  
  const fee = price * 0.03; // Комісія 3%
  const total = price + fee;
  const order_code = 'ORD-' + Math.floor(100000 + Math.random() * 900000);

  db.run(
    'INSERT INTO orders (order_code, product_title, price, fee, total, buyer, seller, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [order_code, product_title, price, fee, total, buyer || '@buyer', seller || '@seller', 'escrow_locked'],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      
      // Посилання на створення оплати Mono / LiqPay
      res.json({
        success: true,
        order_code,
        total,
        fee,
        message: 'Замовлення створено та кошти зарезервовано на Escrow'
      });
    }
  );
});

// REST API: Отримати всі замовлення Покупця
app.get('/api/orders', (req, res) => {
  db.all('SELECT * FROM orders ORDER BY id DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// REST API: Підтвердження угоди Покупцем
app.post('/api/orders/complete', (req, res) => {
  const { order_code } = req.body;
  db.run('UPDATE orders SET status = "completed" WHERE order_code = ?', [order_code], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, message: 'Угоду завершено, кошти виплачено продавцю' });
  });
});

// Головна сторінка
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Сервер DealPay запущено на порту ${PORT}`);
});
