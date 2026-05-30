import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import './App.css';

// ===== 配置 =====
const AGGREGATOR_ADDRESS = '0x1CF77670ef930a170a1F2cF88dcDae4f433CBD38';
const TEST_TOKEN = '0xa50CDefb741C4590b36af57ab295Fc942F4247E8';
const TOKEN_SYMBOL = 'TEST';
const SEPOLIA_CHAIN_ID = '0xaa36a7';
// 用公共 RPC 做读操作，不依赖 MetaMask 的 eth_call
const RPC_URL = 'https://ethereum-sepolia-rpc.publicnode.com';

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address, uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
];
const ADAPTER_NAME_ABI = ['function name() view returns (string)'];

const DEX_COLORS = ['#6c5ce7', '#00b894', '#fdcb6e', '#e17055', '#0984e3'];

const short = (addr) => addr ? addr.slice(0, 6) + '...' + addr.slice(-4) : '';
const fmt = (n) => Number(n).toFixed(6);

export default function App() {
  // --- state ---
  const [account, setAccount] = useState('');
  const [signer, setSigner] = useState(null);           // 只发交易用
  const [readProvider] = useState(() => new ethers.JsonRpcProvider(RPC_URL)); // 只读
  const [ethBalance, setEthBalance] = useState('0');
  const [tokenBalance, setTokenBalance] = useState('0');
  const [amountIn, setAmountIn] = useState('');
  const [isEthToToken, setIsEthToToken] = useState(true);
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [txHash, setTxHash] = useState('');
  const [splitMode, setSplitMode] = useState(false);
  const [dexCount, setDexCount] = useState(2);

  // ---------- connect ----------
  const connect = async () => {
    if (!window.ethereum) return alert('Please install MetaMask');
    try {
      const accs = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const bp = new ethers.BrowserProvider(window.ethereum);
      const s = await bp.getSigner();
      const chainId = await window.ethereum.request({ method: 'eth_chainId' });
      if (chainId !== SEPOLIA_CHAIN_ID) {
        try {
          await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: SEPOLIA_CHAIN_ID }] });
        } catch {
          alert('Please switch to Sepolia testnet in MetaMask');
          return;
        }
      }
      setAccount(accs[0]);
      setSigner(s);
      await refreshBalances(accs[0], s);
    } catch (e) {
      console.error(e);
      setMsg('Connection failed');
    }
  };

  // ---------- balances ----------
  const refreshBalances = async (acc, s) => {
    try {
      const eth = await readProvider.getBalance(acc);
      setEthBalance(ethers.formatEther(eth));
      const tok = new ethers.Contract(TEST_TOKEN, ERC20_ABI, readProvider);
      const bal = await tok.balanceOf(acc);
      setTokenBalance(ethers.formatEther(bal));
    } catch (e) { console.error('balance error', e); }
  };

  // ---------- account/chain events ----------
  useEffect(() => {
    if (!window.ethereum) return;
    const onAccs = (a) => { if (!a.length) { setAccount(''); setMsg(''); } else { setAccount(a[0]); refreshBalances(a[0], signer); } };
    const onChain = () => window.location.reload();
    window.ethereum.on('accountsChanged', onAccs);
    window.ethereum.on('chainChanged', onChain);
    return () => {
      window.ethereum.removeListener('accountsChanged', onAccs);
      window.ethereum.removeListener('chainChanged', onChain);
    };
  }, [signer]);

  // ---------- quotes ----------
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!account || !amountIn || Number(amountIn) <= 0) { setQuotes([]); return; }
      try {
        const amt = ethers.parseEther(amountIn);
        const tIn = isEthToToken ? ethers.ZeroAddress : TEST_TOKEN;
        const tOut = isEthToToken ? TEST_TOKEN : ethers.ZeroAddress;

        // 用只读 provider 调聚合器
        const agg = new ethers.Contract(AGGREGATOR_ADDRESS, [
          'function getAllQuotes(address,address,uint256) view returns (tuple(address adapter, uint256 amountOut, uint256 index)[])'
        ], readProvider);
        const raw = await agg.getAllQuotes(tIn, tOut, amt);

        // ethers v6 Result → 纯对象
        const list = raw.map((r) => ({
          adapter: r.adapter,
          amountOut: r.amountOut,
          amountOutFmt: ethers.formatEther(r.amountOut),
          index: Number(r.index),
          name: '',
        }));

        // 拿 DEX 名称
        for (const item of list) {
          try {
            const data = await readProvider.call({
              to: item.adapter,
              data: new ethers.Interface(ADAPTER_NAME_ABI).encodeFunctionData('name'),
            });
            item.name = new ethers.Interface(ADAPTER_NAME_ABI).decodeFunctionResult('name', data)[0];
          } catch { item.name = 'Unknown'; }
        }

        // 过滤掉报价为 0 的 DEX（没有该交易对流动性）
        if (!cancelled) setQuotes(list.filter(q => q.amountOut > 0n));
      } catch (e) {
        console.error('quote error', e);
        if (!cancelled) setQuotes([]);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [account, amountIn, isEthToToken, readProvider]);

  // ---------- swap ----------
  const executeSwap = async () => {
    if (!amountIn || !signer) return;
    setLoading(true); setMsg(''); setTxHash('');
    try {
      const amt = ethers.parseEther(amountIn);
      const tIn = isEthToToken ? ethers.ZeroAddress : TEST_TOKEN;
      const tOut = isEthToToken ? TEST_TOKEN : ethers.ZeroAddress;
      const best = quotes[0]?.amountOut ?? 0n;
      const minOut = best > 0n ? best * 95n / 100n : 0n;

      const agg = new ethers.Contract(AGGREGATOR_ADDRESS, [
        'function swap(address,address,uint256,uint256) payable returns (uint256)',
        'function splitSwap(address,address,uint256,uint256,uint256) payable returns (uint256)',
      ], signer);

      // token 授权
      if (!isEthToToken) {
        const tok = new ethers.Contract(TEST_TOKEN, ERC20_ABI, signer);
        const allow = await tok.allowance(account, AGGREGATOR_ADDRESS);
        if (allow < amt) {
          setMsg('Approving token...');
          await (await tok.approve(AGGREGATOR_ADDRESS, ethers.MaxUint256)).wait();
        }
      }

      let tx;
      if (splitMode && quotes.length >= 2) {
        setMsg('Executing split swap...');
        tx = await agg.splitSwap(tIn, tOut, amt, minOut, Math.min(dexCount, quotes.length), { value: isEthToToken ? amt : 0n });
      } else {
        setMsg('Executing swap...');
        tx = await agg.swap(tIn, tOut, amt, minOut, { value: isEthToToken ? amt : 0n });
      }
      setMsg('Waiting for confirmation...');
      const rec = await tx.wait();
      setTxHash(rec.hash);
      setMsg('Swap successful!');
      setAmountIn('');
      await refreshBalances(account, signer);
    } catch (e) {
      console.error(e);
      setMsg('Failed: ' + (e.reason || e.message || 'Unknown'));
    }
    setLoading(false);
  };

  // ====== render ======
  return (
    <div className="app">
      <header>
        <h1>🚀 Token Aggregator</h1>
        <p className="network">Sepolia · {quotes.length} DEX source{quotes.length !== 1 ? 's' : ''}</p>
      </header>

      {!account ? (
        <div className="card center">
          <div className="hero-icon">🔄</div>
          <h2>Best Price, Every Swap</h2>
          <p>Aggregates multiple DEXes to find the optimal route</p>
          <button className="btn primary large" onClick={connect}>Connect MetaMask</button>
        </div>
      ) : (
        <>
          <div className="card wallet-bar">
            <span className="dot" />
            <strong>{short(account)}</strong>
            <span className="sep">|</span>
            <span>{fmt(ethBalance)} ETH</span>
            <span className="sep">|</span>
            <span>{fmt(tokenBalance)} {TOKEN_SYMBOL}</span>
          </div>

          <div className="card swap-card">
            <div className="swap-header">
              <span className="swap-label">You Pay</span>
              <button className="btn small outline" onClick={() => { setIsEthToToken(!isEthToToken); setAmountIn(''); setQuotes([]); }}>
                ⇄ Switch
              </button>
            </div>
            <div className="input-group">
              <input type="number" placeholder="0.0" value={amountIn}
                onChange={e => setAmountIn(e.target.value)} disabled={loading} />
              <span className="token-tag">{isEthToToken ? 'ETH' : TOKEN_SYMBOL}</span>
            </div>
            <div className="swap-arrow">↓</div>
            <div className="swap-header"><span className="swap-label">You Receive</span></div>
            <div className="input-group">
              <input type="text" placeholder="0.0"
                value={quotes.length > 0 ? fmt(quotes[0].amountOutFmt) : '—'} readOnly />
              <span className="token-tag">{isEthToToken ? TOKEN_SYMBOL : 'ETH'}</span>
            </div>

            {amountIn && Number(amountIn) > 0 && (
              <div className="quotes-panel">
                <div className="quotes-title">Price Comparison</div>
                {quotes.length === 0 ? (
                  <div className="quote-row no-route">No available routes for this pair</div>
                ) : (
                  quotes.map((q, i) => (
                    <div key={q.adapter} className={`quote-row ${i === 0 ? 'best' : ''}`}>
                      <div className="quote-rank">
                        <span className={`rank-badge ${i === 0 ? 'gold' : i === 1 ? 'silver' : ''}`}>{i + 1}</span>
                      </div>
                      <div className="quote-dex" style={{ color: DEX_COLORS[i] || '#888' }}>
                        {q.name || short(q.adapter)}
                        {i === 0 && <span className="best-tag">BEST</span>}
                      </div>
                      <div className="quote-amount">
                        {q.amountOut > 0n ? fmt(q.amountOutFmt) : '—'} {isEthToToken ? TOKEN_SYMBOL : 'ETH'}
                      </div>
                      <div className="quote-addr">{short(q.adapter)}</div>
                    </div>
                  ))
                )}
              </div>
            )}

            {quotes.length >= 2 && (
              <div className="split-options">
                <label className="toggle-row">
                  <input type="checkbox" checked={splitMode} onChange={e => setSplitMode(e.target.checked)} />
                  <span>Split across top DEXes</span>
                </label>
                {splitMode && (
                  <select value={dexCount} onChange={e => setDexCount(Number(e.target.value))} className="dex-select">
                    {Array.from({ length: quotes.length }, (_, i) => i + 1).map(n => (
                      <option key={n} value={n}>{n} DEX{n > 1 ? 'es' : ''}</option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <button className="btn primary large swap-btn" onClick={executeSwap}
              disabled={loading || !amountIn || Number(amountIn) <= 0 || quotes.length === 0}>
              {loading ? 'Processing...'
                : quotes.length === 0 ? 'Enter amount to see routes'
                : splitMode ? `Split Swap (${Math.min(dexCount, quotes.length)} DEXes)`
                : 'Swap (Best Route)'}
            </button>

            {msg && <p className={`msg ${txHash ? 'success' : ''}`}>{msg}</p>}
            {txHash && (
              <p className="tx-link">
                <a href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank" rel="noreferrer">View on Etherscan ↗</a>
              </p>
            )}
          </div>

          <div className="card info-card">
            <h3>How it works</h3>
            <div className="steps">
              <div className="step"><span className="step-num">1</span><span>Enter amount to swap</span></div>
              <div className="step"><span className="step-num">2</span><span>Query all DEXes for prices</span></div>
              <div className="step"><span className="step-num">3</span><span>Auto-select best route</span></div>
              <div className="step"><span className="step-num">4</span><span>Execute in 1 transaction</span></div>
            </div>
          </div>
        </>
      )}

      <footer>
        <a href="https://github.com/z1903531989-pixel/web3-contracts" target="_blank" rel="noreferrer">GitHub</a>
        {' · '}
        <a href={`https://sepolia.etherscan.io/address/${AGGREGATOR_ADDRESS}`} target="_blank" rel="noreferrer">Contract ↗</a>
      </footer>
    </div>
  );
}
