'use client'
import { useEffect, useRef, useState } from 'react';

export default function Home() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const calculatorRef = useRef<any>(null);
  const [query, setQuery] = useState('');

  const handleSubmit = () => {
    if (!query.trim()) return;
    // TODO: handle query submission
    setQuery('');
  };

  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://www.desmos.com/api/v1.11/calculator.js?apiKey=52850a351a4541ac8df9b31fff086df9';
    script.async = true;

    script.onload = () => {
      const container = containerRef.current;
      const Desmos = (window as any).Desmos;
      if (container && Desmos && typeof Desmos.GraphingCalculator === 'function') {
        calculatorRef.current = Desmos.GraphingCalculator(container, {
          expressions: true,
          settingsMenu: false,
          zoomButtons: true,
          lockViewport: false,
          expressionsCollapsed: true
        });
      }
    };

    document.head.appendChild(script);
    return () => {
      if (calculatorRef.current) calculatorRef.current.destroy();
      if (script.parentNode) script.parentNode.removeChild(script);
    };
  }, []);
  
  return (
    <div className="h-screen bg-white flex">
      <div className="w-1/2 h-full">
        {/* calculator will mount here */}
        <div id="calculator" ref={containerRef} className="w-full h-full" />
      </div>

      <div className="w-1/2 h-full flex flex-col p-8">
        <h1 className="text-black font-sans text-5xl sm:text-6xl font-semibold">
          Hello, World
        </h1>
        <div className="mt-8 flex">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            placeholder="Ask something..."
            className="flex-1 border border-gray-300 rounded-l px-3 py-2 text-black text-sm outline-none focus:border-black"
          />
          <button
            onClick={handleSubmit}
            className="border border-l-0 border-gray-300 rounded-r px-4 py-2 text-black text-sm hover:bg-gray-100"
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}
