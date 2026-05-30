// ===== AI 模型聚合平台 — Express 服务器 =====
require('dotenv').config({ path: '../.env' });
const express = require('express');
const cors = require('cors');
const { getModels, chat, compare } = require('./services/providers');
const { createApiKey, validateApiKey, getUserUsage, recordUsage } = require('./services/auth');

const app = express();
app.use(cors());
app.use(express.json());

// ===== 公开路由 =====

// 健康检查
app.get('/api/health', (_, res) => {
  res.json({ status: 'ok', models: getModels().length, uptime: process.uptime() });
});

// 获取模型列表（含定价）
app.get('/api/models', (_, res) => {
  res.json({ models: getModels() });
});

// ===== API Key 认证（平台自己的密钥，用于计费） =====
app.use('/api/chat', validateApiKey);
app.use('/api/compare', validateApiKey);

// 单模型聊天
app.post('/api/chat', async (req, res) => {
  try {
    const { model, messages, options } = req.body;
    if (!model || !messages) return res.status(400).json({ error: 'model and messages required' });

    const result = await chat(model, messages, options || {});
    recordUsage(req.apiKey, result.usage?.inputTokens || 0, result.usage?.outputTokens || 0, result.cost?.userCost || '0');
    res.json(result);
  } catch (e) {
    console.error('Chat error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// 多模型对比
app.post('/api/compare', async (req, res) => {
  try {
    const { models, messages } = req.body;
    if (!models?.length || !messages) return res.status(400).json({ error: 'models[] and messages required' });

    const results = await compare(models, messages);
    res.json({ results });
  } catch (e) {
    console.error('Compare error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ===== 平台管理 =====

// 生成 API Key（平台用户注册）
app.post('/api/register', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    const key = await createApiKey(email);
    res.json({ apiKey: key, message: 'Save this key — it won\'t be shown again' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 查询用量
app.get('/api/usage', validateApiKey, async (req, res) => {
  try {
    const usage = await getUserUsage(req.apiKey);
    res.json(usage);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 启动 =====
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🤖 AI Aggregator API running on http://localhost:${PORT}`);
  console.log(`   ${getModels().length} models across 5 providers\n`);
  getModels().forEach(m => console.log(`   ${m.name} (${m.provider})`));
  console.log('');
});
