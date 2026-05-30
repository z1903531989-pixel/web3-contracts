import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import AggregatorArtifact from './TokenAggregator.json';
import './App.css';

// ===== 配置 =====
const AGGREGATOR_ADDRESS = '0x3517228be4fbFC6f2753faA67De404514C1fB853';
const TEST_TOKEN = '0xa50CDefb741C4590b36af57ab295Fc942F4247E8';
const TOKEN_SYMBOL = 'TEST';
const TOKEN_DECIMALS = 18;
const SEPOLIA_CHAIN_ID = '0xaa36a7';

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address, uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
];

const ADAPTER_ABI = ['function name() view returns (string)'];

const DEX_COLORS = ['#6c5ce7', '#00b894', '#fdcb6e', '#e17055', '#0984e3', '#fd79a8', '#00cec9', '#a29bfe', '#fab1a0', '#81ecec'];

export default function App() {
  const [account, setAccount] = useState('');
  const [provider, setProvider] = useState(null);
  const [aggregator, setAggregator] = useState(null);
  const [tokenContract, setTokenContract] = useState(null);

  // Balances
  const [ethBalance, setEthBalance] = useState('0');
  const [tokenBalance, setTokenBalance] = useState('0');

  // Swap state
  const [isEthToToken, setIsEthToToken] = useState(true);
  const [amountIn, setAmountIn] = useState('');
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [txHash, setTxHash] = useState('');
  const [splitMode, setSplitMode] = useState(false);
  const [dexCount, setDexCount] = useState(2);

  // ===== Wallet Connection =====
  const connect = async () => {
    if (!window.ethereum) return alert('Please install MetaMask');
    try {
      const accs = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const p = new ethers.BrowserProvider(window.ethereum);
      const signer = await p.getSigner();
      const chainId = await window.ethereum.request({ method: 'eth_chainId' });

      if (chainId !== SEPOLIA_CHAIN_ID) {
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: SEPOLIA_CHAIN_ID }],
          });
        } catch {
          alert('Please switch to Sepolia network in MetaMask');
          return;
        }
      }

      const agg = new ethers.Contract(AGGREGATOR_ADDRESS, AggregatorArtifact.abi, signer);
      const tok = new ethers.Contract(TEST_TOKEN, ERC20_ABI, signer);

      setAccount(accs[0]);
      setProvider(p);
      setAggregator(agg);
      setTokenContract(tok);

      await refreshBalances(p, tok, accs[0]);
    } catch (e) {
      console.error(e);
      setMsg('Connection failed: ' + (e.reason || e.message));
    }
  };

  const refreshBalances = async (p, tok, acc) => {
    try {
      const ethBal = await p.getBalance(acc);
      setEthBalance(ethers.formatEther(ethBal));
      const tokBal = await tok.balanceOf(acc);
      setTokenBalance(ethers.formatEther(tokBal));
    } catch (e) { console.error(e); }
  };

  // ===== Auto-refresh on account/chain change =====
  useEffect(() => {
    if (!window.ethereum) return;
    const handleAccounts = (accs) => {
      if (accs.length === 0) {
        setAccount('');
        setMsg('');
      } else {
        setAccount(accs[0]);
        if (provider && tokenContract) refreshBalances(provider, tokenContract, accs[0]);
      }
    };
    window.ethereum.on('accountsChanged', handleAccounts);
    window.ethereum.on('chainChanged', () => window.location.reload());
    return () => {
      window.ethereum.removeListener('accountsChanged', handleAccounts);
      window.ethereum.removeListener('chainChanged', () => {});
    };
  }, [provider, tokenContract]);

  // ===== Get Quotes =====
  const fetchQuotes = useCallback(async () => {
    if (!aggregator || !amountIn || Number(amountIn) <= 0) { setQuotes([]); return; }
    try {
      const amountInWei = ethers.parseEther(amountIn);
      const tokenIn = isEthToToken ? ethers.ZeroAddress : TEST_TOKEN;
      const tokenOut = isEthToToken ? TEST_TOKEN : ethers.ZeroAddress;

      const rawQuotes = await aggregator.getAllQuotes(tokenIn, tokenOut, amountInWei);

      // Fetch names
      const resolved = await Promise.all(rawQuotes.map(async (q) => {
        try {
          const adapter = new ethers.Contract(q.adapter, ADAPTER_ABI, await (new ethers.BrowserProvider(window.ethereum)).getSigner());
          // Use a simple provider call instead
          const iface = new ethers.Interface(ADAPTER_ABI);
          const data = await (new ethers.BrowserProvider(window.ethereum)).call({
            to: q.adapter,
            data: iface.encodeFunctionData('name'),
          });
          const name = iface.decodeFunctionResult('name', data)[0];
          return { ...q, name, amountOutFmt: ethers.formatEther(q.amountOut) };
        } catch {
          return { ...q, name: 'Unknown', amountOutFmt: ethers.formatEther(q.amountOut) };
        }
      }));

      setQuotes(resolved);
    } catch (e) {
      console.error(e);
    }
  }, [aggregator, amountIn, isEthToToken]);

  useEffect(() => {
    fetchQuotes();
  }, [fetchQuotes]);

  // ===== Execute Swap =====
  const executeSwap = async () => {
    if (!amountIn || Number(amountIn) <= 0) return;
    setLoading(true);
    setMsg('');
    setTxHash('');
    try {
      const amountInWei = ethers.parseEther(amountIn);
      const tokenIn = isEthToToken ? ethers.ZeroAddress : TEST_TOKEN;
      const tokenOut = isEthToToken ? TEST_TOKEN : ethers.ZeroAddress;

      // Calculate minOut (95% of best quote for safety)
      const bestQuote = quotes.length > 0 ? quotes[0].amountOut : 0n;
      const minOut = bestQuote > 0n ? bestQuote * 95n / 100n : 0n;

      let tx;
      if (!isEthToToken) {
        // Token → ETH: need approval first
        const allowance = await tokenContract.allowance(account, AGGREGATOR_ADDRESS);
        if (allowance < amountInWei) {
          setMsg('Approving token...');
          const appTx = await tokenContract.approve(AGGREGATOR_ADDRESS, ethers.MaxUint256);
          await appTx.wait();
        }
      }

      if (splitMode && quotes.length >= 2) {
        setMsg('Executing split swap...');
        tx = await aggregator.splitSwap(
          tokenIn, tokenOut, amountInWei, minOut, Math.min(dexCount, quotes.length),
          { value: isEthToToken ? amountInWei : 0n }
        );
      } else {
        setMsg('Executing swap...');
        tx = await aggregator.swap(
          tokenIn, tokenOut, amountInWei, minOut,
          { value: isEthToToken ? amountInWei : 0n }
        );
      }

      setMsg('Transaction submitted! Waiting for confirmation...');
      const receipt = await tx.wait();
      setTxHash(receipt.hash);
      setMsg('Swap successful!');
      setAmountIn('');
      await refreshBalances(provider, tokenContract, account);
      await fetchQuotes();
    } catch (e) {
      console.error(e);
      setMsg('Swap failed: ' + (e.reason || e.message || 'Unknown error'));
    }
    setLoading(false);
  };

  // ===== Helpers =====
  const short = (addr) => addr.slice(0, 6) + '...' + addr.slice(-4);
  const formatNum = (n) => Number(n).toFixed(6);
  const switchDirection = () => {
    setIsEthToToken(!isEthToToken);
    setQuotes([]);
    setAmountIn('');
  };

  // ===== Render =====
  return (
    <div className="app">
      <header>
        <h1>🚀 Token Aggregator</h1>
        <p className="network">Sepolia Testnet · {quotes.length} DEX sources</p>
      </header>

      {!account ? (
        <div className="card center">
          <div className="hero-icon">🔄</div>
          <h2>Best Price, Every Swap</h2>
          <p>Aggregates multiple DEXes to find the optimal route for your trade</p>
          <button className="btn primary large" onClick={connect}>Connect MetaMask</button>
        </div>
      ) : (
        <>
          {/* Wallet Bar */}
          <div className="card wallet-bar">
            <span className="dot" />
            <strong>{short(account)}</strong>
            <span className="sep">|</span>
            <span>{formatNum(ethBalance)} ETH</span>
            <span className="sep">|</span>
            <span>{formatNum(tokenBalance)} {TOKEN_SYMBOL}</span>
          </div>

          {/* Swap Card */}
          <div className="card swap-card">
            {/* Direction Toggle */}
            <div className="swap-header">
              <span className="swap-label">You Pay</span>
              <button className="btn small outline" onClick={switchDirection}>
                ⇄ Switch
              </button>
            </div>

            {/* Input */}
            <div className="input-group">
              <input
                type="number"
                placeholder="0.0"
                value={amountIn}
                onChange={(e) => setAmountIn(e.target.value)}
                disabled={loading}
              />
              <span className="token-tag">{isEthToToken ? 'ETH' : TOKEN_SYMBOL}</span>
            </div>

            <div className="swap-arrow">↓</div>

            <div className="swap-header">
              <span className="swap-label">You Receive</span>
            </div>
            <div className="input-group">
              <input
                type="text"
                placeholder="0.0"
                value={quotes.length > 0 ? formatNum(quotes[0].amountOutFmt) : '—'}
                readOnly
              />
              <span className="token-tag">{isEthToToken ? TOKEN_SYMBOL : 'ETH'}</span>
            </div>

            {/* Quotes Display */}
            {amountIn && Number(amountIn) > 0 && (
              <div className="quotes-panel">
                <div className="quotes-title">
                  Price Comparison
                  {quotes.length === 0 && <span className="loading-dots"> loading...</span>}
                </div>
                {quotes.length === 0 ? (
                  <div className="quote-row no-route">No available routes for this pair</div>
                ) : (
                  quotes.map((q, i) => (
                    <div key={q.adapter} className={`quote-row ${i === 0 ? 'best' : ''}`}>
                      <div className="quote-rank">
                        <span className={`rank-badge ${i === 0 ? 'gold' : i === 1 ? 'silver' : ''}`}>
                          {i + 1}
                        </span>
                      </div>
                      <div className="quote-dex" style={{ color: DEX_COLORS[i] || '#888' }}>
                        {q.name || short(q.adapter)}
                        {i === 0 && <span className="best-tag">BEST</span>}
                      </div>
                      <div className="quote-amount">
                        {q.amountOut > 0n ? formatNum(q.amountOutFmt) : '—'} {isEthToToken ? TOKEN_SYMBOL : 'ETH'}
                      </div>
                      <div className="quote-addr">{short(q.adapter)}</div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Split Mode Toggle */}
            {quotes.length >= 2 && (
              <div className="split-options">
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={splitMode}
                    onChange={(e) => setSplitMode(e.target.checked)}
                  />
                  <span>Split across top DEXes (lower slippage)</span>
                </label>
                {splitMode && (
                  <select
                    value={dexCount}
                    onChange={(e) => setDexCount(Number(e.target.value))}
                    className="dex-select"
                  >
                    {Array.from({ length: quotes.length }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>{n} DEX{n > 1 ? 'es' : ''}</option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* Action Button */}
            <button
              className="btn primary large swap-btn"
              onClick={executeSwap}
              disabled={loading || !amountIn || Number(amountIn) <= 0 || quotes.length === 0}
            >
              {loading ? 'Processing...' : quotes.length === 0 ? 'Enter amount to see routes' : splitMode ? `Split Swap (${Math.min(dexCount, quotes.length)} DEXes)` : 'Swap (Best Route)'}
            </button>

            {/* Status */}
            {msg && <p className={`msg ${txHash ? 'success' : ''}`}>{msg}</p>}
            {txHash && (
              <p className="tx-link">
                <a href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank" rel="noreferrer">
                  View on Etherscan ↗
                </a>
              </p>
            )}
          </div>

          {/* Info Cards */}
          <div className="card info-card">
            <h3>How it works</h3>
            <div className="steps">
              <div className="step">
                <span className="step-num">1</span>
                <span>Enter amount to swap</span>
              </div>
              <div className="step">
                <span className="step-num">2</span>
                <span>Aggregator queries all DEXes</span>
              </div>
              <div className="step">
                <span className="step-num">3</span>
                <span>Best route auto-selected</span>
              </div>
              <div className="step">
                <span className="step-num">4</span>
                <span>Execute in one transaction</span>
              </div>
            </div>
          </div>
        </>
      )}

      <footer>
        <a href="https://github.com/z1903531989-pixel/web3-contracts" target="_blank" rel="noreferrer">
          View on GitHub
        </a>
        {' · '}
        <a href={`https://sepolia.etherscan.io/address/${AGGREGATOR_ADDRESS}`} target="_blank" rel="noreferrer">
          Aggregator Contract ↗
        </a>
      </footer>
    </div>
  );
}
