// Lokal ishga tushirish: npm run dev
try { process.loadEnvFile('.env'); } catch {}
const path = require('path');
const express = require('express');
const api = require('./lib/app');

const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html')));
app.get('/speaking', (req, res) => res.sendFile(path.join(__dirname, 'public', 'speaking', 'index.html')));
app.get('/speaking/exam', (req, res) => res.sendFile(path.join(__dirname, 'public', 'speaking', 'exam.html')));
app.use(api);
app.listen(PORT, () => console.log(`🚀 http://localhost:${PORT}  |  Admin: http://localhost:${PORT}/admin`));
