'use client'
import { useEffect, useRef } from 'react';

export default function Home() {
  const calculatorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://www.desmos.com/api/v1.11/calculator.js?apiKey=52850a351a4541ac8df9b31fff086df9';
    script.async = true;

    script.onload = () => {
      const container = calculatorRef.current;
      const Desmos = (window as any).Desmos;
      if (container && Desmos && typeof Desmos.GraphingCalculator === 'function') {
        new Desmos.GraphingCalculator(container);
      }
    };

    document.head.appendChild(script);
    return () => {
      if (script.parentNode) script.parentNode.removeChild(script);
    };
  }, []);

  return (
    <div className="h-screen bg-white flex">
      <div className="w-1/2 h-full">
        {/* calculator will mount here */}
        <div id="calculator" ref={calculatorRef} className="w-full h-full" />
      </div>

      <div className="w-1/2 h-full flex items-center justify-center p-8">
        <h1 className="text-black font-sans text-5xl sm:text-6xl font-semibold">
          Hello, World
        </h1>
      </div>
    </div>
  );
}
