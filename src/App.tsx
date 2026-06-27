import React, { useState, useEffect, useCallback } from 'react';
import { db } from './lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { UserProfile } from './types';
import { deriveKey } from './lib/crypto';
import Onboarding from './components/Onboarding';
import ChatSidebar from './components/ChatSidebar';
import ChatRoom from './components/ChatRoom';
import NewChatModal from './components/NewChatModal';
import { MessageSquare, Shield, Lock, Users, Sparkles, RefreshCw } from 'lucide-react';

export default function App() {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [roomCryptoKeys, setRoomCryptoKeys] = useState<{ [roomId: string]: CryptoKey }>({});
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Load user session from local storage on mount
  useEffect(() => {
    const savedUser = localStorage.getItem('chat_user');
    if (savedUser) {
      try {
        setCurrentUser(JSON.parse(savedUser));
      } catch (e) {
        console.error('Failed to parse cached user session:', e);
        localStorage.removeItem('chat_user');
      }
    }
    setCheckingAuth(false);
  }, []);

  // Derive cryptographic key from room salt and passphrase
  const handleLoadRoomKey = useCallback(async (roomId: string, passphrase: string): Promise<boolean> => {
    try {
      const roomRef = doc(db, 'rooms', roomId);
      const roomSnap = await getDoc(roomRef);
      if (!roomSnap.exists()) return false;

      const roomData = roomSnap.data();
      const salt = roomData.encryptionKeySalt;

      // Derive key
      const key = await deriveKey(passphrase, salt);
      
      // Cache key in app state
      setRoomCryptoKeys((prev) => ({
        ...prev,
        [roomId]: key,
      }));

      // Persist passphrase locally for browser-reload persistence
      localStorage.setItem(`room_key_${roomId}`, passphrase);
      return true;
    } catch (err) {
      console.error('Failed to derive room key:', err);
      return false;
    }
  }, []);

  const handleLogout = () => {
    if (window.confirm('Are you sure you want to log out of your current profile? Your E2EE keys will remain in your browser cache.')) {
      localStorage.removeItem('chat_user');
      setCurrentUser(null);
      setSelectedRoomId(null);
      setRoomCryptoKeys({});
    }
  };

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center text-slate-400">
        <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mb-3" />
        <span className="text-sm tracking-wide">Syncing secure identities...</span>
      </div>
    );
  }

  // Render onboarding screen if user is not authenticated
  if (!currentUser) {
    return <Onboarding onComplete={setCurrentUser} />;
  }

  return (
    <div className="min-h-screen mesh-gradient text-slate-200 flex h-screen overflow-hidden relative font-sans">
      {/* Decorative ambient background glows */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-[100px] pointer-events-none -mr-48 -mt-48"></div>
      <div className="absolute bottom-0 left-0 w-64 h-64 bg-rose-500/5 rounded-full blur-[80px] pointer-events-none -ml-32 -mb-32"></div>
      
      {/* 1. Sidebar Panel */}
      <div className={`h-full border-r border-white/10 glass-dark shrink-0 z-10 ${
        selectedRoomId ? 'hidden md:flex w-80' : 'flex w-full md:w-80'
      }`}>
        <ChatSidebar
          currentUser={currentUser}
          selectedRoomId={selectedRoomId}
          onSelectRoom={setSelectedRoomId}
          onOpenNewChat={() => setShowNewChatModal(true)}
          onLogout={handleLogout}
          roomCryptoKeys={roomCryptoKeys}
          onLoadRoomKey={handleLoadRoomKey}
        />
      </div>

      {/* 2. Main Chat panel */}
      <div className={`flex-1 h-full flex flex-col z-10 ${
        selectedRoomId ? 'flex' : 'hidden md:flex'
      }`}>
        {selectedRoomId ? (
          <ChatRoom
            currentUser={currentUser}
            roomId={selectedRoomId}
            roomCryptoKeys={roomCryptoKeys}
            onLoadRoomKey={handleLoadRoomKey}
            onBack={() => setSelectedRoomId(null)}
          />
        ) : (
          /* Splash Welcome Screen when no room is selected with Glass container */
          <div className="flex-1 flex flex-col justify-center items-center p-8 text-center relative overflow-hidden">
            <div className="max-w-md space-y-6 glass p-8 rounded-3xl border border-white/10 shadow-2xl relative z-10">
              <div className="w-16 h-16 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-center mx-auto text-indigo-300 shadow-xl">
                <Shield className="w-8 h-8" />
              </div>

              <div className="space-y-2">
                <h2 className="text-xl font-bold text-white tracking-tight font-display">
                  Zero-Knowledge Secure Messaging
                </h2>
                <p className="text-xs text-white/50 leading-relaxed">
                  Start an encrypted group chat or direct message with any user by searching their unique name or 4-digit code. All messages are fully encrypted in-transit and at-rest.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 p-4 bg-white/5 border border-white/10 rounded-2xl">
                <div className="flex flex-col items-center p-3 text-center bg-black/10 rounded-xl border border-white/5">
                  <Lock className="w-5 h-5 text-indigo-300 mb-1.5" />
                  <span className="text-[11px] font-bold text-white block">AES-GCM 256</span>
                  <span className="text-[10px] text-white/40 mt-0.5">End-to-End Encryption</span>
                </div>
                <div className="flex flex-col items-center p-3 text-center bg-black/10 rounded-xl border border-white/5">
                  <Sparkles className="w-5 h-5 text-cyan-300 mb-1.5" />
                  <span className="text-[11px] font-bold text-white block">Self-Destruct</span>
                  <span className="text-[10px] text-white/40 mt-0.5">Expiration Timers</span>
                </div>
              </div>

              <button
                onClick={() => setShowNewChatModal(true)}
                className="inline-flex bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-6 py-3 rounded-xl shadow-lg shadow-indigo-600/30 hover:shadow-indigo-600/50 cursor-pointer transition-all border border-indigo-500/30"
              >
                Create New Chat
              </button>
            </div>
          </div>
        )}
      </div>


      {/* 3. New Chat Modal Overlay */}
      {showNewChatModal && (
        <NewChatModal
          currentUser={currentUser}
          onClose={() => setShowNewChatModal(false)}
          onSelectRoom={(roomId) => {
            setSelectedRoomId(roomId);
            setShowNewChatModal(false);
          }}
        />
      )}

    </div>
  );
}
