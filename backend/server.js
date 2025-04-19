const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname, 'subscriptionpage')));

// Serve the dashboard.html file at the root URL

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'subscriptionpage', 'dashboard.html'));
});

// PostgreSQL connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
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

app.listen(process.env.PORT || 3000, () => {
    console.log(`Server running on port ${process.env.PORT || 3000}`);
});