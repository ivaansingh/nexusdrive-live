/**
 * DFS Storage Engine
 * Handles: chunking, node assignment (load balancing), replication,
 *          encryption, SHA-256 hashing, parallel I/O, fault tolerance
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

// ─── Configuration ────────────────────────────────────────────────────────────
const CHUNK_SIZE = 1024 * 1024;           // 1MB per chunk
const ENCRYPTION_KEY = crypto.scryptSync(
  process.env.ENCRYPTION_KEY || 'dfs-encryption-passphrase',
  'salt', 32
);
const NODES_BASE = path.join(__dirname, '../nodes');
const ALL_NODES = ['node1', 'node2', 'node3'];

// Track simulated failures (in-memory for demo; persist to DB in production)
const failedNodes = new Set();

// ─── Node Health ──────────────────────────────────────────────────────────────
const getActiveNodes = () => ALL_NODES.filter(n => !failedNodes.has(n));

const simulateNodeFailure = (nodeName) => {
  failedNodes.add(nodeName);
  console.warn(`[NODE] ⚠ ${nodeName} marked as FAILED`);
};

const restoreNode = (nodeName) => {
  failedNodes.delete(nodeName);
  console.log(`[NODE] ✓ ${nodeName} restored`);
};

const getNodeStatus = () => {
  return ALL_NODES.map(name => {
    const nodePath = path.join(NODES_BASE, name);
    let chunkCount = 0, totalSize = 0;
    try {
      const files = fs.readdirSync(nodePath);
      chunkCount = files.length;
      totalSize = files.reduce((sum, f) => {
        try { return sum + fs.statSync(path.join(nodePath, f)).size; } catch { return sum; }
      }, 0);
    } catch {}
    return {
      name,
      status: failedNodes.has(name) ? 'failed' : 'online',
      chunkCount,
      totalSize,
      path: nodePath
    };
  });
};

// ─── Load Balancer ────────────────────────────────────────────────────────────
/**
 * Round-robin with load awareness.
 * Picks the N least-loaded active nodes to distribute a chunk across.
 */
const selectNodesForChunk = (replicationFactor = 2) => {
  const active = getActiveNodes();
  if (active.length === 0) throw new Error('No active storage nodes available');

  // Sort by number of chunks stored (lightest load first)
  const sorted = active.sort((a, b) => {
    const aCount = fs.readdirSync(path.join(NODES_BASE, a)).length;
    const bCount = fs.readdirSync(path.join(NODES_BASE, b)).length;
    return aCount - bCount;
  });

  // Take min(replicationFactor, availableNodes) nodes
  return sorted.slice(0, Math.min(replicationFactor, active.length));
};

// ─── Encryption ───────────────────────────────────────────────────────────────
const encryptChunk = (buffer) => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  // Prepend IV to encrypted data so we can decrypt later
  return Buffer.concat([iv, encrypted]);
};

const decryptChunk = (buffer) => {
  const iv = buffer.slice(0, 16);
  const encrypted = buffer.slice(16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
};

// ─── Hashing ──────────────────────────────────────────────────────────────────
const hashBuffer = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

// ─── Core: Split File Into Chunks ─────────────────────────────────────────────
const splitIntoChunks = (fileBuffer) => {
  const chunks = [];
  let offset = 0;
  let index = 0;

  while (offset < fileBuffer.length) {
    const end = Math.min(offset + CHUNK_SIZE, fileBuffer.length);
    chunks.push({
      index,
      data: fileBuffer.slice(offset, end)
    });
    offset = end;
    index++;
  }
  return chunks;
};

// ─── Core: Store Chunk on Node ────────────────────────────────────────────────
const storeChunk = (nodeName, chunkId, data) => {
  const filePath = path.join(NODES_BASE, nodeName, `${chunkId}.chunk`);
  fs.writeFileSync(filePath, data);
};

// ─── Core: Read Chunk from Node ───────────────────────────────────────────────
const readChunk = (nodeName, chunkId) => {
  // Try primary node first
  if (!failedNodes.has(nodeName)) {
    const filePath = path.join(NODES_BASE, nodeName, `${chunkId}.chunk`);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath);
    }
  }
  return null;
};

// ─── Core: Delete Chunk from Node ────────────────────────────────────────────
const deleteChunk = (nodeName, chunkId) => {
  const filePath = path.join(NODES_BASE, nodeName, `${chunkId}.chunk`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
};

// ─── Main: Upload File ────────────────────────────────────────────────────────
/**
 * Full upload pipeline:
 * 1. Hash entire file for deduplication
 * 2. Split into 1MB chunks
 * 3. Encrypt each chunk
 * 4. Assign to least-loaded nodes (with replication)
 * 5. Store in parallel
 * 6. Return metadata for DB storage
 */
const uploadFile = async (fileBuffer, options = {}) => {
  const { replicationFactor = 2, encrypt = true } = options;
  const fileHash = hashBuffer(fileBuffer);
  const rawChunks = splitIntoChunks(fileBuffer);

  const chunkMetadata = [];

  // Process chunks in parallel batches
  await Promise.all(rawChunks.map(async ({ index, data }) => {
    const chunkId = uuidv4();
    const chunkHash = hashBuffer(data);
    const processedData = encrypt ? encryptChunk(data) : data;

    // Select nodes using load balancer
    const assignedNodes = selectNodesForChunk(replicationFactor);

    // Store on all assigned nodes (primary + replicas)
    assignedNodes.forEach(nodeName => {
      storeChunk(nodeName, chunkId, processedData);
    });

    chunkMetadata[index] = {
      chunkId,
      chunkIndex: index,
      size: data.length,
      hash: chunkHash,
      nodes: assignedNodes,
      encrypted: encrypt
    };
  }));

  return { fileHash, chunks: chunkMetadata, chunkSize: CHUNK_SIZE };
};

// ─── Main: Download File ──────────────────────────────────────────────────────
/**
 * Full download pipeline:
 * 1. Iterate chunks in order
 * 2. Try primary node, fallback to replicas
 * 3. Decrypt if encrypted
 * 4. Verify hash integrity
 * 5. Reconstruct and return file buffer
 */
const downloadFile = async (chunkMeta) => {
  const buffers = new Array(chunkMeta.length);

  await Promise.all(chunkMeta.map(async (chunk) => {
    let data = null;

    // Try each node in order (fault tolerance)
    for (const nodeName of chunk.nodes) {
      data = readChunk(nodeName, chunk.chunkId);
      if (data) {
        console.log(`[DL] Chunk ${chunk.chunkIndex} from ${nodeName}`);
        break;
      }
      console.warn(`[DL] Node ${nodeName} unavailable for chunk ${chunk.chunkIndex}, trying replica...`);
    }

    if (!data) {
      throw new Error(`Chunk ${chunk.chunkIndex} (${chunk.chunkId}) unavailable on all nodes`);
    }

    // Decrypt if needed
    const decrypted = chunk.encrypted ? decryptChunk(data) : data;

    // Verify integrity
    const verifiedHash = hashBuffer(decrypted);
    if (verifiedHash !== chunk.hash) {
      throw new Error(`Integrity check failed for chunk ${chunk.chunkIndex}`);
    }

    buffers[chunk.chunkIndex] = decrypted;
  }));

  return Buffer.concat(buffers);
};

// ─── Main: Delete File Chunks ─────────────────────────────────────────────────
const deleteFileChunks = (chunkMeta) => {
  chunkMeta.forEach(chunk => {
    chunk.nodes.forEach(nodeName => {
      try { deleteChunk(nodeName, chunk.chunkId); } catch {}
    });
  });
};

module.exports = {
  uploadFile,
  downloadFile,
  deleteFileChunks,
  getNodeStatus,
  simulateNodeFailure,
  restoreNode,
  hashBuffer,
  CHUNK_SIZE
};
