'use client'
import { useEffect, useRef, useState } from 'react';

export default function Home() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const calculatorRef = useRef<any>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<'graph' | 'animation'>('graph');
  const [dimension, setDimension] = useState<'2d' | '3d'>('3d');
  const expressionIdRef = useRef(0);

  const getCurrentExpressions = () => {
    const calculator = calculatorRef.current;
    if (!calculator) return [];
    const exprs = calculator.getExpressions();
    return exprs
      .filter((e: any) => e.latex)
      .map((e: any) => ({ id: e.id, latex: e.latex }));
  };

  const handleSubmit = async () => {
    if (!query.trim() || loading) return;
    const userMessage = query.trim();
    setChatHistory((prev) => [...prev, { role: 'user', text: userMessage }]);
    setLoading(true);

    try {
      const currentExpressions = getCurrentExpressions();
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, currentExpressions, dimension }),
      });
      const data = await res.json();

      const calculator = calculatorRef.current;
      if (calculator && Array.isArray(data.actions)) {
        const tempIdMap = new Map<string, string>();

        for (const action of data.actions) {
          switch (action.type) {
            case 'add': {
              expressionIdRef.current += 1;
              const realId = `expr-${expressionIdRef.current}`;
              calculator.setExpression({ id: realId, latex: action.latex });
              if (action.id) tempIdMap.set(action.id, realId);
              break;
            }
            case 'remove': {
              const resolvedId = tempIdMap.get(action.id) || action.id;
              calculator.removeExpression({ id: resolvedId });
              break;
            }
            case 'set': {
              const resolvedId = tempIdMap.get(action.id) || action.id;
              calculator.setExpression({ id: resolvedId, latex: action.latex });
              break;
            }
          }
        }
      }
      const reply = data.message || 'Done.';
      setChatHistory((prev) => [...prev, { role: 'assistant', text: reply }]);
    } catch (err) {
      console.error('Failed to process query:', err);
      setChatHistory((prev) => [...prev, { role: 'assistant', text: 'Something went wrong.' }]);
    } finally {
      setLoading(false);
      setQuery('');
    }
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  const desmosLoadedRef = useRef(false);

  // Load the Desmos script once
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://www.desmos.com/api/v1.11/calculator.js?apiKey=52850a351a4541ac8df9b31fff086df9';
    script.async = true;
    script.onload = () => { desmosLoadedRef.current = true; };
    document.head.appendChild(script);
    return () => {
      if (script.parentNode) script.parentNode.removeChild(script);
    };
  }, []);

  // Create/recreate calculator when dimension or mode changes
  useEffect(() => {
    if (calculatorRef.current) {
      calculatorRef.current.destroy();
      calculatorRef.current = null;
    }

    if (mode !== 'graph') return;

    const Desmos = (window as any).Desmos;
    const container = containerRef.current;
    if (!container || !Desmos) return;

    expressionIdRef.current = 0;

    const options = {
      expressions: true,
      settingsMenu: false,
      zoomButtons: true,
      lockViewport: false,
      expressionsCollapsed: true,
    };

    calculatorRef.current = dimension === '3d'
      ? Desmos.Calculator3D(container, options)
      : Desmos.GraphingCalculator(container, options);
  }, [dimension, mode]);

  // Also init calculator once Desmos script loads
  useEffect(() => {
    const check = setInterval(() => {
      if (desmosLoadedRef.current) {
        clearInterval(check);
        const Desmos = (window as any).Desmos;
        const container = containerRef.current;
        if (!container || !Desmos || calculatorRef.current) return;

        const options = {
          expressions: true,
          settingsMenu: false,
          zoomButtons: true,
          lockViewport: false,
          expressionsCollapsed: true,
        };

        calculatorRef.current = dimension === '3d'
          ? Desmos.Calculator3D(container, options)
          : Desmos.GraphingCalculator(container, options);
      }
    }, 50);
    return () => clearInterval(check);
  }, []);

  return (
    <div className="h-screen bg-white flex flex-col">
      <div className="flex items-center gap-4 px-4 py-2 border-b border-gray-200">
        <div className="flex rounded border border-gray-300 overflow-hidden">
          <button
            onClick={() => setMode('graph')}
            className={`px-3 py-1 text-sm ${mode === 'graph' ? 'bg-black text-white' : 'text-black hover:bg-gray-100'}`}
          >
            Graph
          </button>
          <button
            onClick={() => setMode('animation')}
            className={`px-3 py-1 text-sm ${mode === 'animation' ? 'bg-black text-white' : 'text-black hover:bg-gray-100'}`}
          >
            Animation
          </button>
        </div>

        {mode === 'graph' && (
          <div className="flex rounded border border-gray-300 overflow-hidden">
            <button
              onClick={() => setDimension('2d')}
              className={`px-3 py-1 text-sm ${dimension === '2d' ? 'bg-black text-white' : 'text-black hover:bg-gray-100'}`}
            >
              2D
            </button>
            <button
              onClick={() => setDimension('3d')}
              className={`px-3 py-1 text-sm ${dimension === '3d' ? 'bg-black text-white' : 'text-black hover:bg-gray-100'}`}
            >
              3D
            </button>
          </div>
        )}

        {mode === 'animation' && (
          <>
            {/* <button className="border border-gray-300 rounded px-3 py-1 text-black text-sm hover:bg-gray-100">
              Placeholder 1
            </button>
            <button className="border border-gray-300 rounded px-3 py-1 text-black text-sm hover:bg-gray-100">
              Placeholder 2
            </button> */}
          </>
        )}
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="w-1/2 h-full">
          {mode === 'graph' ? (
            <div id="calculator" ref={containerRef} className="w-full h-full" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gray-50">
              <span className="text-gray-400 text-sm">Animation canvas</span>
            </div>
          )}
        </div>

        <div className="w-1/2 h-full flex flex-col p-8">
          <h1 className="text-black font-sans text-5xl sm:text-2xl font-semibold">
            Hello, Om
          </h1>
          <div className="flex-1 min-h-0 mt-4 overflow-y-auto">
            {chatHistory.map((msg, i) => (
              <div key={i} className={`mb-3 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                <span
                  className={`inline-block px-3 py-1.5 rounded text-sm ${
                    msg.role === 'user'
                      ? 'bg-black text-white'
                      : 'bg-gray-100 text-black'
                  }`}
                >
                  {msg.text}
                </span>
              </div>
            ))}
            {loading && (
              <div className="mb-3 text-left">
                <span className="inline-block px-3 py-1.5 rounded text-sm bg-gray-100 text-gray-400">
                  ...
                </span>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          <div className="flex mt-4">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder="Type something..."
              className="flex-1 border border-gray-300 rounded-l px-3 py-2 text-black text-sm outline-none focus:border-black"
            />
            <button
              onClick={handleSubmit}
              className="border border-l-0 border-gray-300 rounded-r px-4 py-2 text-black text-sm hover:bg-gray-100"
              disabled={loading}
            >
              {loading ? '...' : 'Submit'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
