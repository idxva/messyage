import React, { useState } from 'react';
import { db } from '../lib/firebase';
import { collection, query, where, getDocs, doc, setDoc } from 'firebase/firestore';
import { UserProfile } from '../types';
import { RefreshCw, ArrowRight, ShieldCheck, Key, LogIn, Sparkles } from 'lucide-react';

const GRADIENT_AVATARS = [
  'linear-gradient(135deg, #FF6B6B 0%, #FF8E53 100%)',
  'linear-gradient(135deg, #4E65FF 0%, #92EFFD 100%)',
  'linear-gradient(135deg, #7F00FF 0%, #E100FF 100%)',
  'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
  'linear-gradient(135deg, #F9D423 0%, #FF4E50 100%)',
  'linear-gradient(135deg, #00C6FF 0%, #0072FF 100%)',
];

interface OnboardingProps {
  onComplete: (user: UserProfile) => void;
}

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [displayName, setDisplayName] = useState('');
  const [tag, setTag] = useState(() => Math.floor(1000 + Math.random() * 9000).toString());
  const [selectedAvatar, setSelectedAvatar] = useState(0);
  const [isSignIn, setIsSignIn] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const generateNewTag = () => {
    setTag(Math.floor(1000 + Math.random() * 9000).toString());
  };

  const handleAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      setError('Display name is required');
      return;
    }
    if (!/^\d{4}$/.test(tag)) {
      setError('Tag must be exactly 4 digits');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const usersRef = collection(db, 'users');
      
      if (isSignIn) {
        // Sign in with existing username and tag (case-insensitive)
        let q = query(
          usersRef,
          where('displayNameLowercase', '==', displayName.trim().toLowerCase()),
          where('tag', '==', tag)
        );
        let querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
          // Fallback for older profiles without displayNameLowercase
          q = query(
            usersRef,
            where('displayName', '==', displayName.trim()),
            where('tag', '==', tag)
          );
          querySnapshot = await getDocs(q);
        }

        if (querySnapshot.empty) {
          setError('User profile not found. Check your name and 4-digit tag, or create a new profile.');
          setLoading(false);
          return;
        }

        const userDoc = querySnapshot.docs[0];
        const loggedInUser: UserProfile = userDoc.data() as UserProfile;
        
        // Save to local storage
        localStorage.setItem('chat_user', JSON.stringify(loggedInUser));
        onComplete(loggedInUser);
      } else {
        // Create new account
        // First check if this exact name + tag combo is already taken (case-insensitive check)
        let q = query(
          usersRef,
          where('displayNameLowercase', '==', displayName.trim().toLowerCase()),
          where('tag', '==', tag)
        );
        let querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
          // Fallback collision check for older profiles
          q = query(
            usersRef,
            where('displayName', '==', displayName.trim()),
            where('tag', '==', tag)
          );
          querySnapshot = await getDocs(q);
        }

        if (!querySnapshot.empty) {
          setError('This tag combo is already in use by another user. Try regenerating your 4-digit code.');
          setLoading(false);
          return;
        }

        // Generate a random UID
        const newUid = 'u_' + Math.random().toString(36).substring(2, 11);
        const newUser: UserProfile = {
          uid: newUid,
          displayName: displayName.trim(),
          displayNameLowercase: displayName.trim().toLowerCase(),
          tag,
          avatarUrl: GRADIENT_AVATARS[selectedAvatar],
          createdAt: new Date().toISOString(),
        };

        // Save to Firestore
        await setDoc(doc(db, 'users', newUid), newUser);
        
        // Save to local storage
        localStorage.setItem('chat_user', JSON.stringify(newUser));
        onComplete(newUser);
      }
    } catch (err: any) {
      console.error('Error during onboarding:', err);
      setError('Failed to connect to server: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen mesh-gradient flex flex-col justify-center items-center px-4 relative overflow-hidden font-sans">
      {/* Decorative ambient background glows */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-[120px] pointer-events-none -mr-48 -mt-48"></div>
      <div className="absolute bottom-0 left-0 w-80 h-80 bg-rose-500/5 rounded-full blur-[100px] pointer-events-none -ml-40 -mb-40"></div>

      <div className="w-full max-w-md glass rounded-3xl p-8 shadow-2xl relative border border-white/10">
        
        {/* Header Branding */}
        <div className="flex flex-col items-center mb-8 text-center">
          <div className="w-14 h-14 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-center shadow-lg mb-3 text-indigo-300">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight font-display flex items-center gap-2">
            SecureSphere <span className="text-xs bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full border border-indigo-500/30">E2EE</span>
          </h1>
          <p className="text-sm text-white/60 mt-1">
            Zero-knowledge, group chats, & temporary expiring messages
          </p>
        </div>

        {/* Tab Toggle */}
        <div className="grid grid-cols-2 bg-black/25 p-1 rounded-xl border border-white/5 mb-6">
          <button
            type="button"
            onClick={() => { setIsSignIn(false); setError(''); }}
            className={`py-2 text-sm font-medium rounded-lg transition-all ${
              !isSignIn
                ? 'bg-white/10 text-white shadow-sm border border-white/5'
                : 'text-white/50 hover:text-white/80'
            }`}
          >
            Create Profile
          </button>
          <button
            type="button"
            onClick={() => { setIsSignIn(true); setError(''); }}
            className={`py-2 text-sm font-medium rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              isSignIn
                ? 'bg-white/10 text-white shadow-sm border border-white/5'
                : 'text-white/50 hover:text-white/80'
            }`}
          >
            <LogIn className="w-4 h-4" /> Sign In
          </button>
        </div>

        <form onSubmit={handleAction} className="space-y-6">
          {error && (
            <div className="p-3 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/25 rounded-xl text-center">
              {error}
            </div>
          )}

          {/* Avatar selection for new accounts only */}
          {!isSignIn && (
            <div className="space-y-3">
              <label className="text-xs font-semibold uppercase tracking-wider text-white/50">
                Choose Avatar
              </label>
              <div className="flex justify-between items-center bg-black/15 p-4 rounded-2xl border border-white/5">
                <div
                  className="w-14 h-14 rounded-full shadow-lg border-2 border-white/15"
                  style={{ background: GRADIENT_AVATARS[selectedAvatar] }}
                />
                <div className="grid grid-cols-6 gap-2">
                  {GRADIENT_AVATARS.map((grad, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setSelectedAvatar(idx)}
                      className={`w-8 h-8 rounded-full cursor-pointer border-2 transition-all hover:scale-110 ${
                        selectedAvatar === idx ? 'border-white scale-110' : 'border-transparent'
                      }`}
                      style={{ background: grad }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Form Fields */}
          <div className="space-y-4">
            <div>
              <label htmlFor="displayName" className="block text-xs font-semibold uppercase tracking-wider text-white/50 mb-2">
                Display Name
              </label>
              <input
                id="displayName"
                type="text"
                placeholder="e.g., Alice, Bob"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={20}
                required
                className="w-full bg-black/20 border border-white/10 text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all placeholder:text-white/20 text-sm"
              />
            </div>

            <div>
              <label htmlFor="tag" className="block text-xs font-semibold uppercase tracking-wider text-white/50 mb-2 flex justify-between items-center">
                <span>Unique Tag Code</span>
                {!isSignIn && (
                  <button
                    type="button"
                    onClick={generateNewTag}
                    className="text-[10px] text-indigo-300 hover:text-indigo-200 flex items-center gap-1 py-0.5 px-1.5 rounded-md hover:bg-white/5 transition-all"
                  >
                    <RefreshCw className="w-3 h-3" /> Regenerate
                  </button>
                )}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-white/30 font-mono font-bold">
                  #
                </div>
                <input
                  id="tag"
                  type="text"
                  placeholder="1234"
                  value={tag}
                  onChange={(e) => setTag(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  maxLength={4}
                  required
                  readOnly={!isSignIn} // Only writeable in Sign In, read-only/regeneratable in Signup
                  className={`w-full bg-black/20 border border-white/10 text-white pl-8 pr-4 py-3 rounded-xl font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all text-sm tracking-widest ${
                    !isSignIn ? 'opacity-80 text-indigo-300 font-bold' : ''
                  }`}
                />
              </div>
              <p className="text-[11px] text-white/40 mt-1.5">
                {isSignIn
                  ? 'Enter your name and existing 4-digit code to resume your session.'
                  : 'This code + name combination serves as your searchable handle.'}
              </p>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white py-3.5 px-4 rounded-xl font-medium shadow-lg shadow-indigo-600/30 hover:shadow-indigo-600/50 flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm border border-indigo-500/30"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : isSignIn ? (
              <>
                Sign In to Chat <ArrowRight className="w-4 h-4" />
              </>
            ) : (
              <>
                Create Secured Identity <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Feature List */}
        <div className="mt-8 pt-6 border-t border-white/10 grid grid-cols-2 gap-4">
          <div className="flex items-start gap-2">
            <Key className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div className="text-[11px] text-white/55">
              <span className="font-semibold text-white/80 block">AES-GCM Encryption</span>
              Client-side derived keys.
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Sparkles className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
            <div className="text-[11px] text-white/55">
              <span className="font-semibold text-white/80 block">Self-Destruct</span>
              Timed message expirations.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
