const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Администратор маркетплейса
const ADMIN_USERNAME = 'revezzzzzz'; 

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

if (!fs.existsSync('./uploads')) {
    fs.mkdirSync('./uploads');
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const upload = multer({ storage: storage, limits: { fileSize: 5 * 1024 * 1024 } });

const db = new sqlite3.Database('./dealpay.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT, category TEXT, price REAL, desc TEXT, images TEXT, seller TEXT, rating TEXT DEFAULT '0.0'
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_code TEXT, product_title TEXT, price REAL, fee REAL, total REAL, buyer TEXT, seller TEXT, status TEXT DEFAULT 'pending', reviewed INTEGER DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS profiles (
        seller TEXT PRIMARY KEY,
        balance REAL DEFAULT 0.0,
        earned REAL DEFAULT 0.0,
        rating REAL DEFAULT 0.0,
        reviews_count INTEGER DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user TEXT, message TEXT, reply TEXT DEFAULT NULL, status TEXT DEFAULT 'open', created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reporter TEXT, target_type TEXT, target_id TEXT, reason TEXT, status TEXT DEFAULT 'pending', created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

const checkAdmin = (req, res, next) => {
    const user = req.headers['x-user-name'];
    if (!user || user.replace('@', '').toLowerCase() !== ADMIN_USERNAME.toLowerCase()) {
        return res.status(403).json({ error: 'Доступ заборонено.' });
    }
    next();
};

app.get('/api/products', (req, res) => {
    db.all("SELECT * FROM products ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        rows.forEach(r => { try { r.images = JSON.parse(r.images || '[]'); } catch(e) { r.images = []; } });
        res.json(rows);
    });
});

app.post('/api/products', upload.array('photos', 10), (req, res) => {
    const { title, category, price, desc, seller } = req.body;
    const images = req.files ? req.files.map(file => `/uploads/${file.filename}`) : [];
    db.run(`INSERT INTO products (title, category, price, desc, images, seller) VALUES (?, ?, ?, ?, ?, ?)`,
        [title, category, price, desc, JSON.stringify(images), seller], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, success: true });
        });
});

app.delete('/api/admin/products/:id', checkAdmin, (req, res) => {
    db.run(`DELETE FROM products WHERE id = ?`, [req.params.id], (err) => res.json({ success: true }));
});

app.get('/api/orders', (req, res) => {
    db.all("SELECT * FROM orders ORDER BY id DESC", [], (err, rows) => res.json(rows || []));
});

app.post('/api/balance/topup', (req, res) => {
    const { seller, amount } = req.body;
    db.run(`INSERT INTO profiles (seller, balance) VALUES (?, ?) ON CONFLICT(seller) DO UPDATE SET balance = balance + ?`,
        [seller, amount, amount], (err) => res.json({ success: true }));
});

app.post('/api/orders/create', (req, res) => {
    const { product_title, price, buyer, seller } = req.body;
    const fee = price * 0.03, total = price + fee;

    db.get("SELECT balance FROM profiles WHERE seller = ?", [buyer], (err, profile) => {
        if (!profile || profile.balance < total) {
            return res.status(400).json({ error: "Недостатньо коштів на балансі! Поповніть гаманець." });
        }

        db.run("UPDATE profiles SET balance = balance - ? WHERE seller = ?", [total, buyer], (err) => {
            const order_code = 'DEAL-' + Math.floor(100000 + Math.random() * 900000);
            db.run(`INSERT INTO orders (order_code, product_title, price, fee, total, buyer, seller) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [order_code, product_title, price, fee, total, buyer, seller], () => res.json({ order_code, success: true }));
        });
    });
});

app.post('/api/orders/complete', (req, res) => {
    const { order_code, rating } = req.body;
    db.get("SELECT * FROM orders WHERE order_code = ? AND status = 'pending'", [order_code], (err, order) => {
        if (!order) return res.status(400).json({ error: "Заказ не знайдено" });

        db.run(`UPDATE orders SET status = 'completed', reviewed = 1 WHERE order_code = ?`, [order_code], () => {
            db.run(`INSERT INTO profiles (seller, balance, earned) VALUES (?, ?, ?) 
                    ON CONFLICT(seller) DO UPDATE SET balance = balance + ?, earned = earned + ?`,
                [order.seller, order.price, order.price, order.price, order.price], () => {
                
                db.get("SELECT rating, reviews_count FROM profiles WHERE seller = ?", [order.seller], (err, prof) => {
                    const currentRating = prof ? prof.rating : 0.0;
                    const count = prof ? prof.reviews_count : 0;
                    const newCount = count + 1;
                    const newRating = Number(((currentRating * count + Number(rating)) / newCount).toFixed(1));

                    db.run(`UPDATE profiles SET rating = ?, reviews_count = ? WHERE seller = ?`, [newRating, newCount, order.seller], () => {
                        res.json({ success: true });
                    });
                });
            });
        });
    });
});

app.get('/api/profile/:seller', (req, res) => {
    db.get("SELECT * FROM profiles WHERE seller = ?", [req.params.seller], (err, row) => {
        res.json(row || { balance: 0, earned: 0, rating: 0.0, reviews_count: 0 });
    });
});

app.post('/api/support/ticket', (req, res) => {
    db.run(`INSERT INTO tickets (user, message) VALUES (?, ?)`, [req.body.user, req.body.message], () => res.json({ success: true }));
});
app.get('/api/admin/tickets', checkAdmin, (req, res) => {
    db.all("SELECT * FROM tickets ORDER BY id DESC", [], (err, rows) => res.json(rows || []));
});
app.post('/api/admin/tickets/reply', checkAdmin, (req, res) => {
    db.run(`UPDATE tickets SET reply = ?, status = 'closed' WHERE id = ?`, [req.body.reply, req.body.id], () => res.json({ success: true }));
});
app.get('/api/support/my-tickets/:user', (req, res) => {
    db.all("SELECT * FROM tickets WHERE user = ? ORDER BY id DESC", [req.params.user], (err, rows) => res.json(rows || []));
});

app.post('/api/reports', (req, res) => {
    db.run(`INSERT INTO reports (reporter, target_type, target_id, reason) VALUES (?, ?, ?, ?)`,
        [req.body.reporter, req.body.target_type, req.body.target_id, req.body.reason], () => res.json({ success: true }));
});
app.get('/api/admin/reports', checkAdmin, (req, res) => {
    db.all("SELECT * FROM reports ORDER BY id DESC", [], (err, rows) => res.json(rows || []));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
