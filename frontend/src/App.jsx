import { useState, useRef, useEffect } from 'react';
import './App.css';

// ===== 配置 =====
// 本地开发用 localhost:3001，部署到公网后改为你的后端地址
const API_BASE = window.location.hostname === 'localhost'
  ? 'http://localhost:3001'
  : 'https://your-backend.onrender.com';  // ← 部署后端后改成实际地址
const DEMO_KEY = 'demo-agg-key';

// 模型按提供商分组
const PROVIDER_GROUPS = {
  'OpenAI':       ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
  'Anthropic':    ['claude-opus-4', 'claude-sonnet-4', 'claude-haiku-4'],
  'Google':       ['gemini-2.5-pro', 'gemini-2.5-flash'],
  'DeepSeek':     ['deepseek-v3', 'deepseek-r1'],
  'Groq':         ['llama-4-maverick', 'llama-4-scout'],
};

const PROVIDER_COLORS = {
  OpenAI: '#10a37f', Anthropic: '#d97706', Google: '#4285f4',
  DeepSeek: '#4f46e5', Groq: '#f97316',
};

const short = (s) => s ? s.slice(0, 8) + '...' : '';

export default function App() {
  // --- 全局状态 ---
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('claude-sonnet-4');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [compareModels, setCompareModels] = useState(['claude-sonnet-4', 'gpt-4o']);
  const [compareResults, setCompareResults] = useState([]);
  const [error, setError] = useState('');

  const chatEnd = useRef(null);

  // --- 加载模型列表 ---
  useEffect(() => {
    fetch(`${API_BASE}/api/models`)
      .then(r => r.json())
      .then(d => setModels(d.models || []))
      .catch(() => setError('Backend not running. Start with: cd backend && npm run dev'));
  }, []);

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, compareResults]);

  // --- 发送消息 ---
  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const userMsg = { role: 'user', content: input.trim() };
    const allMsgs = [...messages, userMsg];
    setMessages(allMsgs);
    setInput('');
    setLoading(true);
    setError('');

    try {
      const resp = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': DEMO_KEY },
        body: JSON.stringify({ model: selectedModel, messages: allMsgs }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      setMessages([...allMsgs, { role: 'assistant', content: data.content, meta: data }]);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  // --- 对比模式 ---
  const compareModelsFn = async () => {
    if (!input.trim() || loading) return;
    const userMsg = { role: 'user', content: input.trim() };
    setMessages([userMsg]);
    setInput('');
    setLoading(true);
    setError('');
    setCompareResults([]);

    try {
      const resp = await fetch(`${API_BASE}/api/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': DEMO_KEY },
        body: JSON.stringify({ models: compareModels, messages: [userMsg] }),
      });
      const data = await resp.json();
      setCompareResults(data.results || []);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  const handleSend = () => compareMode ? compareModelsFn() : sendMessage();

  // --- 查找模型信息 ---
  const getModelInfo = (id) => models.find(m => m.id === id) || {};
  const getProvider = (id) => {
    for (const [p, ids] of Object.entries(PROVIDER_GROUPS))
      if (ids.includes(id)) return p;
    return 'Unknown';
  };

  // ====== Render ======
  return (
    <div className="app">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="logo">🤖 AI Aggregator</div>
        <div className="model-count">{models.length} models · 5 providers</div>

        {/* Model Selector */}
        <div className="section-title">Select Model</div>
        {Object.entries(PROVIDER_GROUPS).map(([provider, ids]) => (
          <div key={provider} className="provider-group">
            <div className="provider-label" style={{ color: PROVIDER_COLORS[provider] }}>
              {provider}
            </div>
            {ids.map(id => {
              const info = getModelInfo(id);
              return (
                <button
                  key={id}
                  className={`model-btn ${selectedModel === id ? 'active' : ''}`}
                  onClick={() => { setSelectedModel(id); setCompareMode(false); }}
                >
                  <span>{info.name || id}</span>
                  <span className="price-tag">
                    ${info.pricing?.input || '?'}/M in
                  </span>
                </button>
              );
            })}
          </div>
        ))}

        {/* Compare Toggle */}
        <div className="section-title" style={{ marginTop: 20 }}>Compare Mode</div>
        <label className="toggle-row">
          <input type="checkbox" checked={compareMode} onChange={e => setCompareMode(e.target.checked)} />
          <span>Compare multiple models</span>
        </label>
        {compareMode && (
          <div className="compare-selects">
            {Object.entries(PROVIDER_GROUPS).map(([provider, ids]) =>
              ids.map(id => (
                <label key={id} className="compare-check">
                  <input
                    type="checkbox"
                    checked={compareModels.includes(id)}
                    onChange={e => {
                      if (e.target.checked) setCompareModels([...compareModels, id]);
                      else setCompareModels(compareModels.filter(x => x !== id));
                    }}
                    disabled={compareModels.length <= 1 && compareModels.includes(id)}
                  />
                  <span className="provider-dot" style={{ background: PROVIDER_COLORS[provider] }} />
                  {getModelInfo(id).name || id}
                </label>
              ))
            )}
          </div>
        )}
      </aside>

      {/* Main Chat */}
      <main className="main">
        <header className="chat-header">
          {compareMode ? (
            <span>🔬 Comparing {compareModels.length} models</span>
          ) : (
            <span>
              <span className="provider-dot" style={{ background: PROVIDER_COLORS[getProvider(selectedModel)] }} />
              {getModelInfo(selectedModel).name || selectedModel}
            </span>
          )}
          <button className="clear-btn" onClick={() => { setMessages([]); setCompareResults([]); }}>
            Clear
          </button>
        </header>

        <div className="chat-area">
          {error && <div className="error-bar">{error}</div>}

          {!compareMode ? (
            // === 单模型聊天 ===
            messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                <div className="msg-role">{m.role === 'user' ? 'You' : getModelInfo(selectedModel).name || selectedModel}</div>
                <div className="msg-content">{m.content}</div>
                {m.meta && (
                  <div className="msg-meta">
                    {m.meta.usage?.inputTokens + m.meta.usage?.outputTokens || 0} tokens
                    {' · '}${m.meta.cost?.userCost || '0'}
                    {' · '}{m.meta.latency}
                    <span className="markup-badge">+30% markup</span>
                  </div>
                )}
              </div>
            ))
          ) : (
            // === 多模型对比 ===
            compareResults.length > 0 && (
              <div className="compare-grid" style={{ gridTemplateColumns: `repeat(${compareResults.length}, 1fr)` }}>
                {compareResults.map((r, i) => (
                  <div key={i} className="compare-col">
                    <div className="compare-header" style={{ borderColor: PROVIDER_COLORS[getProvider(r.model)] }}>
                      {getModelInfo(r.model).name || r.model}
                    </div>
                    <div className="msg-content">
                      {r.error ? <span className="error-text">{r.error}</span> : r.content}
                    </div>
                    {r.usage && (
                      <div className="msg-meta">
                        {(r.usage.inputTokens || 0) + (r.usage.outputTokens || 0)} tokens
                        {' · '}${r.cost?.userCost || '0'}
                        {' · '}{r.latency}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          )}

          {loading && (
            <div className="msg assistant">
              <div className="msg-role">{compareMode ? 'Models' : getModelInfo(selectedModel).name || selectedModel}</div>
              <div className="loading-dots"><span /><span /><span /></div>
            </div>
          )}

          <div ref={chatEnd} />
        </div>

        {/* Input */}
        <div className="input-bar">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            placeholder={compareMode ? 'Ask all selected models...' : `Ask ${getModelInfo(selectedModel).name || 'AI'}...`}
            disabled={loading}
          />
          <button onClick={handleSend} disabled={loading || !input.trim()} className="send-btn">
            {loading ? '⏳' : '➤'}
          </button>
        </div>
        <div className="input-hint">
          {compareMode
            ? `Sends to ${compareModels.length} models simultaneously — you'll see all responses side by side`
            : `Enter to send · ${models.length} models available`}
        </div>
      </main>
    </div>
  );
}
