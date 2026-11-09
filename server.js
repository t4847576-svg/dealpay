const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Подключение к базе данных SQLite
const db = new sqlite3.Database('./dealpay.db', (err) => {
    if (err) {
        console.error('Ошибка подключения к базе данных:', err.message);
    } else {
        console.log('Успешное подключение к базе данных SQLite.');
    }
});

// Создание таблиц с учетом поля для картинок (image)
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        category TEXT,
        price REAL,
        desc TEXT,
        image TEXT,
        seller TEXT,
        rating TEXT DEFAULT '5.0'
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_code TEXT,
        product_title TEXT,
        price REAL,
        fee REAL,
        total REAL,
        buyer TEXT,
        seller TEXT,
        status TEXT DEFAULT 'pending'
    )`);
});

// Получить все товары
app.get('/api/products', (req, res) => {
    db.all("SELECT * FROM products ORDER BY id DESC", [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

// Добавить новый товар (с ссылкой на картинку)
app.post('/api/products', (req, res) => {
    const { title, category, price, desc, image, seller } = req.body;
    const query = `INSERT INTO products (title, category, price, desc, image, seller) VALUES (?, ?, ?, ?, ?, ?)`;
    db.run(query, [title, category, price, desc, image, seller], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ id: this.lastID, success: true });
    });
});

// Получить список заказов
app.get('/api/orders', (req, res) => {
    db.all("SELECT * FROM orders ORDER BY id DESC", [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

// Создать заказ (Escrow с комиссией 3%)
app.post('/api/orders/create', (req, res) => {
    const { product_title, price, buyer, seller } = req.body;
    const fee = price * 0.03;
    const total = price + fee;
    const order_code = 'ORD-' + Math.floor(100000 + Math.random() * 900000);

    const query = `INSERT INTO orders (order_code, product_title, price, fee, total, buyer, seller, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`;
    db.run(query, [order_code, product_title, price, fee, total, buyer, seller], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ order_code, success: true });
    });
});

// Завершить сделку
app.post('/api/orders/complete', (req, res) => {
    const { order_code } = req.body;
    const query = `UPDATE orders SET status = 'completed' WHERE order_code = ?`;
    db.run(query, [order_code], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true });
    });
});

app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
