const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Создаем папку для загрузок, если её нет
if (!fs.existsSync('./uploads')) {
    fs.mkdirSync('./uploads');
}

// Настройка хранилища для multer (сохранение файлов)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage, limits: { fileSize: 5 * 1024 * 1024 } }); // лимит 5MB

const db = new sqlite3.Database('./dealpay.db', (err) => {
    if (err) console.error('Ошибка БД:', err.message);
    else console.log('Успешное подключение к SQLite.');
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        category TEXT,
        price REAL,
        desc TEXT,
        images TEXT,
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

    db.run(`CREATE TABLE IF NOT EXISTS balances (
        seller TEXT PRIMARY KEY,
        available REAL DEFAULT 0.0,
        earned REAL DEFAULT 0.0
    )`);
});

// Получить все товары
app.get('/api/products', (req, res) => {
    db.all("SELECT * FROM products ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        rows.forEach(r => {
            try { r.images = JSON.parse(r.images || '[]'); } catch(e) { r.images = []; }
        });
        res.json(rows);
    });
});

// Создать товар с загрузкой файлов (до 10 штук)
app.post('/api/products', upload.array('photos', 10), (req, res) => {
    const { title, category, price, desc, seller } = req.body;
    
    // Получаем пути к загруженным файлам
    const images = req.files ? req.files.map(file => `/uploads/${file.filename}`) : [];
    const imagesJson = JSON.stringify(images);

    const query = `INSERT INTO products (title, category, price, desc, images, seller) VALUES (?, ?, ?, ?, ?, ?)`;
    db.run(query, [title, category, price, desc, imagesJson, seller], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, success: true });
    });
});

app.get('/api/orders', (req, res) => {
    db.all("SELECT * FROM orders ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/orders/create', (req, res) => {
    const { product_title, price, buyer, seller } = req.body;
    const fee = price * 0.03;
    const total = price + fee;
    const order_code = 'DEAL-' + Math.floor(100000 + Math.random() * 900000);

    const query = `INSERT INTO orders (order_code, product_title, price, fee, total, buyer, seller, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`;
    db.run(query, [order_code, product_title, price, fee, total, buyer, seller], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ order_code, success: true });
    });
});

app.post('/api/orders/complete', (req, res) => {
    const { order_code } = req.body;
    db.get("SELECT * FROM orders WHERE order_code = ? AND status = 'pending'", [order_code], (err, order) => {
        if (err || !order) return res.status(400).json({ error: "Заказ не найден" });

        db.run(`UPDATE orders SET status = 'completed' WHERE order_code = ?`, [order_code], (err) => {
            if (err) return res.status(500).json({ error: err.message });

            db.run(`INSERT INTO balances (seller, available, earned) VALUES (?, ?, ?) 
                    ON CONFLICT(seller) DO UPDATE SET available = available + ?, earned = earned + ?`,
                    [order.seller, order.price, order.price, order.price, order.price], (err) => {
                res.json({ success: true });
            });
        });
    });
});

app.get('/api/balance/:seller', (req, res) => {
    const seller = req.params.seller;
    db.get("SELECT * FROM balances WHERE seller = ?", [seller], (err, row) => {
        res.json(row || { available: 0, earned: 0 });
    });
});

app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
