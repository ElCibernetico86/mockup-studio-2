import React from 'react';
import { ShirtIcon } from './icons';

export const Header: React.FC = () => {
  return (
    <header className="bg-slate-900/70 backdrop-blur-lg border-b border-slate-800 sticky top-0 z-10">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-24">
          <div className="flex items-center space-x-4">
            <div className="bg-blue-600 p-3 rounded-xl">
                <ShirtIcon />
            </div>
            <h1 className="text-4xl font-black text-white tracking-tight">
              Mockup Studio
            </h1>
          </div>
        </div>
      </div>
    </header>
  );
};