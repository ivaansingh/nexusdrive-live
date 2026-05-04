/**
 * DFS Master Server - Entry Point
 * Orchestrates metadata management, chunk allocation, and node coordination
 */
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Route imports
//const authRoutes = require('./routes/auth');
const fileRoutes = require('./routes/files');
//const nodeRoutes = require('./routes/nodes');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI =
  process.env.MONGO_URI ||
  'mongodb+srv://admin:Singh9507@cluster0.of3r0ah.mongodb.net/dfs'

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static client files
app.use(express.static(path.join(__dirname, '../client')));

// Ensure Storage Node Directories Exist 
const nodeCount = 3;
for (let i = 1; i <= nodeCount; i++) {
  const nodePath = path.join(__dirname, `nodes/node${i}`);
  if (!fs.existsSync(nodePath)) {
    fs.mkdirSync(nodePath, { recursive: true });
    console.log(`[INIT] Created storage node: node${i}`);
  }
}

// Logs directory
const logsPath = path.join(__dirname, 'logs');
if (!fs.existsSync(logsPath)) fs.mkdirSync(logsPath, { recursive: true });

// MongoDB Connection
mongoose.connect(MONGO_URI)
  .then(() => console.log(`[DB] MongoDB connected: ${MONGO_URI}`))
  .catch(err => {
    console.error('[DB] Connection failed:', err.message);
    console.log('[DB] Running without MongoDB (in-memory mode)');
  });

// Routes 
//app.use('/api/auth', authRoutes);
app.use('/api/files', fileRoutes);
//app.use('/api/nodes', nodeRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    nodes: nodeCount,
    uptime: process.uptime()
  });
});

// Start Server 
app.listen(PORT, () => {
  console.log(`\n🚀 DFS Master Server running on http://localhost:${PORT}`);
  console.log(`📦 Storage nodes: ${nodeCount} (node1, node2, node3)`);
  console.log(`🗄️  Metadata DB: ${MONGO_URI}\n`);
});

module.exports = app;
