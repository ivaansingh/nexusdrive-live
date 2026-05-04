# 🗂️ Distributed File Storage System (Mini Google Drive)

A full-stack distributed file storage system with chunking, replication, encryption, and fault tolerance — simulating how systems like GFS/HDFS work.

## 🏗️ Architecture

```
Client (Browser)
     │
     ▼
Master Server (Express.js)
     │── Auth Service (JWT)
     │── Metadata Store (MongoDB)
     │── Storage Engine
          │── Load Balancer (round-robin + load-aware)
          │── Chunker (1MB chunks)
          │── Encryptor (AES-256-CBC)
          │── Replicator
          ▼
Storage Nodes
├── node1/  (chunk files)
├── node2/  (chunk files — replicas)
└── node3/  (chunk files — replicas)
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- MongoDB 6+ (local or Atlas)
- npm or yarn

### Option 1: Manual Setup

```bash
# 1. Install server dependencies
cd server
npm install

# 2. Set environment variables (or create .env)
export MONGO_URI=mongodb://localhost:27017/dfs
export JWT_SECRET=your-secret-key-here
export PORT=5000

# 3. Start the server
npm start

# 4. Open the client
open ../client/index.html
# OR serve it: npx serve ../client -p 3000
```

### Option 2: Docker Compose

```bash
# Start everything (MongoDB + Server)
docker-compose up -d

# View logs
docker-compose logs -f server

# Stop
docker-compose down
```

## 📡 API Reference

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/signup` | Register new user |
| POST | `/api/auth/login` | Login, get JWT |
| GET | `/api/auth/me` | Get profile |

### Files
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/files/upload` | Upload & distribute file |
| GET | `/api/files` | List user's files |
| GET | `/api/files/download/:id` | Download reconstructed file |
| DELETE | `/api/files/:id` | Delete file + all chunks |
| PATCH | `/api/files/:id/rename` | Rename file |
| GET | `/api/files/:id/versions` | Version history |
| GET | `/api/files/system/logs` | Activity logs |

### Nodes
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/nodes/status` | All node health + stats |
| POST | `/api/nodes/simulate-failure` | Mark node failed (testing) |
| POST | `/api/nodes/restore` | Restore failed node |

## ⚙️ Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGO_URI` | `mongodb://localhost:27017/dfs` | MongoDB connection |
| `JWT_SECRET` | `dfs-super-secret-key` | JWT signing key |
| `ENCRYPTION_KEY` | `dfs-encryption-passphrase` | AES encryption key |
| `PORT` | `5000` | Server port |

## 🧠 Key Concepts

### Chunking
Files are split into 1MB chunks. Each chunk gets a UUID and is stored as a `.chunk` file in the node directories.

### Replication
Each chunk is stored on N nodes (default 2). During download, if the primary node fails, the system tries replicas automatically.

### Load Balancing
Before storing a chunk, the engine sorts active nodes by their current chunk count and assigns to the least-loaded nodes first.

### Deduplication
SHA-256 hash of each file is stored. If you upload the same file twice, the system detects it and skips re-storing chunks.

### Encryption
AES-256-CBC encryption is applied per-chunk before storage. The IV is prepended to each encrypted chunk for decryption.

### File Versioning
When re-uploading a file with the same name, the old version is preserved in `file.versions[]`.

## 🧪 Testing

```bash
# Test node failure recovery:
# 1. Upload a file
# 2. POST /api/nodes/simulate-failure { "nodeName": "node1" }
# 3. Download the file — it should succeed using replicas

# Test deduplication:
# Upload the same file twice — second upload returns deduplicated: true

# Test large files:
# Upload a file >1MB — verify it's split into multiple chunks
# Check server/nodes/node1 for .chunk files
```

## 📂 Project Structure

```
dfs/
├── server/
│   ├── index.js              # Entry point
│   ├── models/               # MongoDB schemas
│   │   └── index.js          # User, File, Log models
│   ├── routes/
│   │   ├── auth.js           # /api/auth
│   │   ├── files.js          # /api/files
│   │   └── nodes.js          # /api/nodes
│   ├── middleware/
│   │   └── auth.js           # JWT middleware
│   ├── utils/
│   │   └── storage.js        # Core DFS engine
│   ├── nodes/
│   │   ├── node1/            # Storage node 1
│   │   ├── node2/            # Storage node 2
│   │   └── node3/            # Storage node 3
│   └── logs/
├── client/
│   └── index.html            # Frontend SPA
├── docker-compose.yml
└── README.md
```
