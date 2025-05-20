const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const cors = require('cors');
// Update to use bcryptjs instead of bcrypt
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Serve the dashboard.html file at the root URL
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'dashboard.html'));
});

// PostgreSQL connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Check DB connection and ensure tables exist
async function initDatabase() {
    try {
        // Test connection
        await pool.query('SELECT NOW()');
        console.log('PostgreSQL connected!');

        // Create users table if not exists
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(100) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Create appointments table if not exists
        await pool.query(`
            CREATE TABLE IF NOT EXISTS appointments (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                client_name VARCHAR(100) NOT NULL,
                appointment_date DATE NOT NULL,
                appointment_time TIME NOT NULL,
                status VARCHAR(50) DEFAULT 'Pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Create orders table if not exists
        await pool.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                order_date DATE NOT NULL,
                customer_name VARCHAR(100) NOT NULL,
                amount NUMERIC(10,2) NOT NULL,
                status VARCHAR(50) DEFAULT 'Processing',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Create analytics table if not exists
        await pool.query(`
            CREATE TABLE IF NOT EXISTS analytics (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                metric VARCHAR(100) NOT NULL,
                value NUMERIC(12,2) NOT NULL,
                recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Create product_tracking table if not exists
        await pool.query(`
            CREATE TABLE IF NOT EXISTS product_tracking (
                id SERIAL PRIMARY KEY,
                product_name VARCHAR(100) NOT NULL,
                user_id INTEGER REFERENCES users(id),
                status VARCHAR(50) NOT NULL,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Create tickets table if not exists
        await pool.query(`
            CREATE TABLE IF NOT EXISTS tickets (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                subject VARCHAR(255) NOT NULL,
                description TEXT NOT NULL,
                status VARCHAR(50) DEFAULT 'Open',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Create subscriptions table if not exists
        await pool.query(`
            CREATE TABLE IF NOT EXISTS subscriptions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                active BOOLEAN DEFAULT TRUE,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log('Checked/created all necessary tables.');
    } catch (err) {
        console.error('Database initialization error:', err);
        process.exit(1); // Exit if DB is not reachable
    }
}

// Call the DB init function before starting the server
initDatabase().then(() => {
    app.listen(process.env.PORT || 3000, () => {
        console.log(`Server running on port ${process.env.PORT || 3000}`);
    });
});

// Example route to get user data
app.get('/api/user/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error fetching user data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Voiceflow Webhook Endpoint
app.post('/voiceflow-hook', async (req, res) => {
    const data = req.body;
    console.log("Received from Voiceflow:", data);

    try {
        const { type, user_id } = data;

        if (type === 'appointment') {
            const { client_name, appointment_date, appointment_time } = data;
            await pool.query(
                'INSERT INTO appointments (user_id, client_name, appointment_date, appointment_time) VALUES ($1, $2, $3, $4)',
                [user_id, client_name, appointment_date, appointment_time]
            );
        } else if (type === 'order') {
            const { customer_name, order_date, amount } = data;
            await pool.query(
                'INSERT INTO orders (user_id, customer_name, order_date, amount) VALUES ($1, $2, $3, $4)',
                [user_id, customer_name, order_date, amount]
            );
        }

        res.json({ status: "success" });

    } catch (error) {
        console.error("Webhook error:", error);
        res.status(500).json({ error: "Database insert failed" });
    }
});

// REMOVE or COMMENT OUT this duplicate app.listen block:
// app.listen(process.env.PORT || 3000, () => {
//     console.log(`Server running on port ${process.env.PORT || 3000}`);
// });


// User Registration
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query(
            'INSERT INTO users (username, email, password) VALUES ($1, $2, $3)',
            [username, email, hashedPassword]
        );
        res.json({ message: 'Registration successful' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// User Login
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'All fields required' });
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ error: 'Invalid credentials' });
        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '1h' });
        res.json({ token });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Middleware to protect dashboard
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
}

// Protect dashboard route
app.get('/dashboard.html', authenticateToken, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'dashboard.html'));
});

// Fetch appointments for logged-in user
app.get('/api/appointments', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM appointments WHERE user_id = $1 ORDER BY appointment_date DESC',
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching appointments:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Fetch orders for logged-in user
app.get('/api/orders', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM orders WHERE user_id = $1 ORDER BY order_date DESC',
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching orders:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Fetch tickets for logged-in user
app.get('/api/tickets', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM tickets WHERE user_id = $1 ORDER BY created_at DESC',
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching tickets:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Raise a new ticket
app.post('/api/tickets', authenticateToken, async (req, res) => {
    const { subject, description } = req.body;
    if (!subject || !description) return res.status(400).json({ error: 'All fields required' });
    try {
        await pool.query(
            'INSERT INTO tickets (user_id, subject, description) VALUES ($1, $2, $3)',
            [req.user.id, subject, description]
        );
        res.json({ message: 'Ticket submitted successfully' });
    } catch (err) {
        console.error('Error creating ticket:', err);
        res.status(500).json({ error: 'Failed to submit ticket' });
    }
});

// Middleware to check subscription
async function checkSubscription(req, res, next) {
    try {
        const result = await pool.query(
            'SELECT * FROM subscriptions WHERE user_id = $1 AND active = TRUE AND expires_at > NOW()',
            [req.user.id]
        );
        if (result.rowCount === 0) return res.status(403).json({ error: 'Subscription expired' });
        next();
    } catch (err) {
        console.error('Error checking subscription:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
}