// ===== AI 模型聚合器 — 统一接口，多模型路由 =====
// 接入: OpenAI / Anthropic Claude / Google Gemini / DeepSeek / Groq

const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');

// ===== 模型注册表 =====
// 每个模型定义: { id, name, provider, apiModel, pricing }
const MODELS = [
  // --- OpenAI ---
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', apiModel: 'gpt-4o',
    desc: 'OpenAI 最新旗舰，多模态', pricing: { input: 2.50, output: 10.00 } },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', apiModel: 'gpt-4o-mini',
    desc: '轻量快速，性价比高', pricing: { input: 0.15, output: 0.60 } },
  { id: 'o3-mini', name: 'o3-mini', provider: 'openai', apiModel: 'o3-mini',
    desc: '推理模型，复杂逻辑', pricing: { input: 1.10, output: 4.40 } },

  // --- Anthropic Claude ---
  { id: 'claude-opus-4', name: 'Claude Opus 4', provider: 'anthropic', apiModel: 'claude-opus-4-20250514',
    desc: '最强推理，代码能力顶级', pricing: { input: 15.00, output: 75.00 } },
  { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', provider: 'anthropic', apiModel: 'claude-sonnet-4-20250514',
    desc: '平衡性能与速度', pricing: { input: 3.00, output: 15.00 } },
  { id: 'claude-haiku-4', name: 'Claude Haiku 4', provider: 'anthropic', apiModel: 'claude-haiku-4-20250514',
    desc: '极速响应，日常任务', pricing: { input: 0.80, output: 4.00 } },

  // --- Google Gemini ---
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'google', apiModel: 'gemini-2.5-pro-preview-05-06',
    desc: 'Google 最新旗舰，超长上下文', pricing: { input: 1.25, output: 10.00 } },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'google', apiModel: 'gemini-2.5-flash-preview-05-20',
    desc: '极速 + 高性价比', pricing: { input: 0.15, output: 0.60 } },

  // --- DeepSeek ---
  { id: 'deepseek-v3', name: 'DeepSeek V3', provider: 'deepseek', apiModel: 'deepseek-chat',
    desc: '国产最强，代码/数学突出', pricing: { input: 0.27, output: 1.10 } },
  { id: 'deepseek-r1', name: 'DeepSeek R1', provider: 'deepseek', apiModel: 'deepseek-reasoner',
    desc: '深度推理，思维链', pricing: { input: 0.55, output: 2.19 } },

  // --- Groq (Llama) ---
  { id: 'llama-4-maverick', name: 'Llama 4 Maverick', provider: 'groq', apiModel: 'meta-llama/llama-4-maverick-17b-128e-instruct',
    desc: 'Meta 开源旗舰，Groq 极速推理', pricing: { input: 0.20, output: 0.90 } },
  { id: 'llama-4-scout', name: 'Llama 4 Scout', provider: 'groq', apiModel: 'meta-llama/llama-4-scout-17b-16e-instruct',
    desc: '轻量开源，极速', pricing: { input: 0.10, output: 0.40 } },
];

// ===== 定价加价（平台利润） =====
const MARKUP_PERCENT = 30; // 在 API 原价基础上加价 30%

// ===== 获取模型列表 =====
function getModels() {
  return MODELS.map(m => ({
    id: m.id,
    name: m.name,
    provider: m.provider,
    desc: m.desc,
    // 展示给用户的价格（含加价）
    pricing: {
      input: (m.pricing.input * (1 + MARKUP_PERCENT / 100)).toFixed(2),
      output: (m.pricing.output * (1 + MARKUP_PERCENT / 100)).toFixed(2),
    },
  }));
}

// ===== 查找模型 =====
function findModel(modelId) {
  const m = MODELS.find(x => x.id === modelId);
  if (!m) throw new Error(`Unknown model: ${modelId}. Available: ${MODELS.map(x => x.id).join(', ')}`);
  return m;
}

// ===== 统一聊天接口 =====
async function chat(modelId, messages, options = {}) {
  const model = findModel(modelId);
  const startTime = Date.now();

  let result;
  switch (model.provider) {
    case 'openai':    result = await chatOpenAI(model, messages, options); break;
    case 'anthropic': result = await chatAnthropic(model, messages, options); break;
    case 'google':    result = await chatGoogle(model, messages, options); break;
    case 'deepseek':  result = await chatDeepSeek(model, messages, options); break;
    case 'groq':      result = await chatGroq(model, messages, options); break;
    default: throw new Error(`Unknown provider: ${model.provider}`);
  }

  // 计算成本
  const inputTokens = result.usage?.inputTokens || result.usage?.prompt_tokens || 0;
  const outputTokens = result.usage?.outputTokens || result.usage?.completion_tokens || 0;
  const apiCost = (inputTokens / 1_000_000) * model.pricing.input +
                  (outputTokens / 1_000_000) * model.pricing.output;
  const userCost = apiCost * (1 + MARKUP_PERCENT / 100);
  const elapsed = Date.now() - startTime;

  return {
    model: model.id,
    provider: model.provider,
    content: result.content,
    usage: { inputTokens, outputTokens },
    cost: { apiCost: apiCost.toFixed(6), userCost: userCost.toFixed(6), markup: `${MARKUP_PERCENT}%` },
    latency: `${elapsed}ms`,
  };
}

// ===== 多模型对比 =====
async function compare(modelIds, messages) {
  const results = await Promise.allSettled(
    modelIds.map(id => chat(id, messages))
  );
  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return { model: modelIds[i], error: r.reason?.message || 'Unknown error' };
  });
}

// ===== OpenAI =====
async function chatOpenAI(model, messages, options) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const resp = await openai.chat.completions.create({
    model: model.apiModel,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 4096,
  });
  return {
    content: resp.choices[0].message.content,
    usage: resp.usage,
  };
}

// ===== Anthropic Claude =====
async function chatAnthropic(model, messages, options) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  // Convert messages to Anthropic format
  const systemMsg = messages.find(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');
  const resp = await anthropic.messages.create({
    model: model.apiModel,
    max_tokens: options.maxTokens || 4096,
    system: systemMsg?.content,
    messages: chatMessages.map(m => ({ role: m.role, content: m.content })),
  });
  const textBlock = resp.content.find(b => b.type === 'text');
  return {
    content: textBlock?.text || '',
    usage: {
      inputTokens: resp.usage?.input_tokens || 0,
      outputTokens: resp.usage?.output_tokens || 0,
    },
  };
}

// ===== Google Gemini =====
async function chatGoogle(model, messages, options) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
  const geminiModel = genAI.getGenerativeModel({ model: model.apiModel });

  // Gemini uses a different message format
  const history = [];
  let systemInstruction = '';
  for (const m of messages.slice(0, -1)) {
    if (m.role === 'system') { systemInstruction = m.content; continue; }
    history.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
  }
  const lastMsg = messages[messages.length - 1];

  const chat = geminiModel.startChat({
    history,
    systemInstruction: systemInstruction ? { text: systemInstruction } : undefined,
  });

  const countResult = await geminiModel.countTokens({
    contents: [...history, { role: 'user', parts: [{ text: lastMsg.content }] }],
  });
  const inputTokens = countResult.totalTokens || 0;

  const resp = await chat.sendMessage(lastMsg.content);
  const text = resp.response.text();

  const outputCount = await geminiModel.countTokens({
    contents: [{ role: 'model', parts: [{ text }] }],
  });

  return {
    content: text,
    usage: {
      inputTokens,
      outputTokens: outputCount.totalTokens || 0,
    },
  };
}

// ===== DeepSeek =====
async function chatDeepSeek(model, messages, options) {
  const openai = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: 'https://api.deepseek.com/v1',
  });
  const resp = await openai.chat.completions.create({
    model: model.apiModel,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 4096,
  });
  return {
    content: resp.choices[0].message.content,
    usage: resp.usage,
  };
}

// ===== Groq (Llama) =====
async function chatGroq(model, messages, options) {
  const Groq = require('groq-sdk');
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const resp = await groq.chat.completions.create({
    model: model.apiModel,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 4096,
  });
  return {
    content: resp.choices[0].message.content,
    usage: resp.usage,
  };
}

module.exports = { getModels, findModel, chat, compare, MODELS };
