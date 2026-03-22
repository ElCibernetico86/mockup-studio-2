import React, { useEffect, useState } from 'react';
import { ShirtIcon } from './icons';
import { auth, signInWithGoogle, logout } from '../firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { LogIn, LogOut } from 'lucide-react';

export const Header: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

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
          
          <div className="flex items-center space-x-4">
            {user ? (
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  {user.photoURL ? (
                    <img src={user.photoURL} alt="Profile" className="w-8 h-8 rounded-full" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-sm font-bold text-white">
                      {user.displayName?.charAt(0) || user.email?.charAt(0) || 'U'}
                    </div>
                  )}
                  <span className="text-sm font-medium text-slate-300 hidden sm:block">
                    {user.displayName || user.email}
                  </span>
                </div>
                <button
                  onClick={logout}
                  className="flex items-center gap-2 text-sm bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 px-4 rounded-lg transition-colors border border-slate-700"
                >
                  <LogOut size={16} />
                  <span className="hidden sm:inline">Logout</span>
                </button>
              </div>
            ) : (
              <button
                onClick={signInWithGoogle}
                className="flex items-center gap-2 text-sm bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2 px-4 rounded-lg transition-colors shadow-lg shadow-blue-500/20"
              >
                <LogIn size={16} />
                <span>Sign in with Google</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};