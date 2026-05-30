// ===== API Key 管理 + 用量追踪 =====
const crypto = require('crypto');

// 内存存储（生产环境换数据库）
const users = new Map();       // apiKey → { email, createdAt, usage }
const DEMO_KEY = 'demo-agg-key';

// 初始化 demo 用户
users.set(DEMO_KEY, {
  email: 'demo@aggregator.local',
  createdAt: new Date().toISOString(),
  usage: { requests: 0, totalTokens: 0, totalCost: 0 },
});

// ===== 生成 API Key =====
async function createApiKey(email) {
  const key = 'sk-agg-' + crypto.randomBytes(16).toString('hex');
  users.set(key, {
    email,
    createdAt: new Date().toISOString(),
    usage: { requests: 0, totalTokens: 0, totalCost: 0 },
  });
  return key;
}

// ===== 验证 API Key（Express 中间件） =====
function validateApiKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.api_key || DEMO_KEY;

  if (!users.has(key)) {
    return res.status(401).json({ error: 'Invalid API key. Get one at /api/register' });
  }

  req.apiKey = key;
  req.user = users.get(key);
  next();
}

// ===== 查询用量 =====
async function getUserUsage(apiKey) {
  const user = users.get(apiKey);
  if (!user) throw new Error('User not found');
  return {
    email: user.email,
    createdAt: user.createdAt,
    usage: user.usage,
  };
}

// ===== 记录用量（每次调用后更新） =====
function recordUsage(apiKey, inputTokens, outputTokens, cost) {
  const user = users.get(apiKey);
  if (!user) return;
  user.usage.requests++;
  user.usage.totalTokens += (inputTokens || 0) + (outputTokens || 0);
  user.usage.totalCost = (parseFloat(user.usage.totalCost) + parseFloat(cost)).toFixed(6);
}

module.exports = { createApiKey, validateApiKey, getUserUsage, recordUsage };
