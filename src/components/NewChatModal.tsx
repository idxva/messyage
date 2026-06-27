import React, { useState } from 'react';
import { db } from '../lib/firebase';
import { collection, query, where, getDocs, doc, setDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { UserProfile, ChatRoom } from '../types';
import { generateSaltHex } from '../lib/crypto';
import { X, Search, Users, ShieldAlert, Check, Plus, UserPlus } from 'lucide-react';

interface NewChatModalProps {
  currentUser: UserProfile;
  onClose: () => void;
  onSelectRoom: (roomId: string) => void;
}

export default function NewChatModal({ currentUser, onClose, onSelectRoom }: NewChatModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<UserProfile[]>([]);
  
  // Group chat config
  const [isGroup, setIsGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [roomKey, setRoomKey] = useState(() => {
    // Generate a secure, easily rememberable hex-like 12-char passphrase by default
    return Math.random().toString(36).substring(2, 8).toUpperCase() + '-' + Math.random().toString(36).substring(2, 8).toUpperCase();
  });

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setSearching(true);
    setError('');
    setSearchResults([]);

    try {
      const usersRef = collection(db, 'users');
      let q;

      const trimmedQuery = searchQuery.trim();

      // Check if user is searching for name#tag format, e.g. "Alice#1234"
      if (trimmedQuery.includes('#')) {
        const [namePart, tagPart] = trimmedQuery.split('#');
        q = query(
          usersRef,
          where('displayName', '==', namePart.trim()),
          where('tag', '==', tagPart.trim())
        );
      } else if (/^\d{4}$/.test(trimmedQuery)) {
        // Searching by exact tag
        q = query(usersRef, where('tag', '==', trimmedQuery));
      } else {
        // Search by exact displayName or prefix (limited prefix match using Firestore)
        q = query(
          usersRef,
          where('displayName', '>=', trimmedQuery),
          where('displayName', '<=', trimmedQuery + '\uf8ff')
        );
      }

      const querySnapshot = await getDocs(q);
      const results: UserProfile[] = [];
      querySnapshot.forEach((doc) => {
        const u = doc.data() as UserProfile;
        // Don't include current user in search results
        if (u.uid !== currentUser.uid) {
          results.push(u);
        }
      });

      setSearchResults(results);
      if (results.length === 0) {
        setError('No users found matching your search. Try searching by name, tag (e.g. "5412"), or "Name#Tag".');
      }
    } catch (err: any) {
      console.error('Error searching users:', err);
      setError('Search failed: ' + err.message);
    } finally {
      setSearching(false);
    }
  };

  const toggleSelectUser = (user: UserProfile) => {
    if (selectedUsers.some((u) => u.uid === user.uid)) {
      setSelectedUsers(selectedUsers.filter((u) => u.uid !== user.uid));
    } else {
      setSelectedUsers([...selectedUsers, user]);
    }
  };

  const handleCreateRoom = async () => {
    if (isGroup && !groupName.trim()) {
      setError('Please provide a group name.');
      return;
    }

    if (selectedUsers.length === 0) {
      setError('Please select at least one user to start a chat.');
      return;
    }

    if (!roomKey.trim()) {
      setError('An encryption passphrase is required to secure this room.');
      return;
    }

    setCreating(true);
    setError('');

    try {
      const roomsRef = collection(db, 'rooms');

      // If it's a DM (one-on-one), let's check if there's already an existing DM between these two users
      if (!isGroup && selectedUsers.length === 1) {
        const otherUser = selectedUsers[0];
        const dmQuery = query(
          roomsRef,
          where('isGroup', '==', false),
          where('members', 'array-contains', currentUser.uid)
        );
        const querySnapshot = await getDocs(dmQuery);
        let existingRoomId = '';

        querySnapshot.forEach((doc) => {
          const room = doc.data() as ChatRoom;
          if (room.members.includes(otherUser.uid)) {
            existingRoomId = doc.id;
          }
        });

        if (existingRoomId) {
          // A DM already exists! Just redirect to it
          // We also save their password key in local storage so client can derive it
          localStorage.setItem(`room_key_${existingRoomId}`, roomKey.trim());
          onSelectRoom(existingRoomId);
          onClose();
          return;
        }
      }

      // Prepare member lists and details
      const memberUids = [currentUser.uid, ...selectedUsers.map((u) => u.uid)];
      
      const memberDetails: { [uid: string]: any } = {
        [currentUser.uid]: {
          displayName: currentUser.displayName,
          tag: currentUser.tag,
          avatarUrl: currentUser.avatarUrl,
        },
      };

      selectedUsers.forEach((u) => {
        memberDetails[u.uid] = {
          displayName: u.displayName,
          tag: u.tag,
          avatarUrl: u.avatarUrl,
        };
      });

      // Generate a new salt for PBKDF2
      const salt = generateSaltHex();

      const newRoomData = {
        name: isGroup ? groupName.trim() : '',
        isGroup,
        members: memberUids,
        memberDetails,
        encryptionKeySalt: salt,
        createdAt: serverTimestamp(),
        lastMessageAt: serverTimestamp(),
      };

      const docRef = await addDoc(roomsRef, newRoomData);

      // Save the encryption key in local storage so this client has it unlocked immediately!
      localStorage.setItem(`room_key_${docRef.id}`, roomKey.trim());

      onSelectRoom(docRef.id);
      onClose();
    } catch (err: any) {
      console.error('Error creating chat room:', err);
      setError('Failed to create chat: ' + err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in font-sans">
      <div className="glass rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[85vh] border border-white/10">
        
        {/* Modal Header */}
        <div className="p-6 border-b border-white/10 flex justify-between items-center bg-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/5 border border-white/10 rounded-xl flex items-center justify-center text-indigo-300 shadow-sm">
              {isGroup ? <Users className="w-5 h-5" /> : <UserPlus className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight">
                {isGroup ? 'Create Secure Group Chat' : 'Start Secure Chat'}
              </h2>
              <p className="text-xs text-white/50">
                All messages in this room will be client-side E2E encrypted.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-white/5 flex items-center justify-center text-white/40 hover:text-white transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body (Scrollable) */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && (
            <div className="p-3 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/25 rounded-xl text-center">
              {error}
            </div>
          )}

          {/* Type Selector Toggle */}
          <div className="grid grid-cols-2 bg-black/30 p-1 rounded-xl border border-white/5">
            <button
              type="button"
              onClick={() => { setIsGroup(false); setSelectedUsers([]); setError(''); }}
              className={`py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                !isGroup
                  ? 'bg-white/10 text-white shadow-sm border border-white/5'
                  : 'text-white/50 hover:text-white/80'
              }`}
            >
              Direct Message (1-on-1)
            </button>
            <button
              type="button"
              onClick={() => { setIsGroup(true); setError(''); }}
              className={`py-2 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-1 cursor-pointer ${
                isGroup
                  ? 'bg-white/10 text-white shadow-sm border border-white/5'
                  : 'text-white/50 hover:text-white/80'
              }`}
            >
              <Users className="w-3.5 h-3.5" /> Group Chat
            </button>
          </div>

          {/* Search Bar */}
          <form onSubmit={handleSearch} className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wider text-white/50">
              Search Users
            </label>
            <div className="relative flex gap-2">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-white/30">
                <Search className="w-4 h-4" />
              </div>
              <input
                type="text"
                placeholder="Search by name, tag code (e.g. '8294'), or Name#Tag..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-black/20 border border-white/10 text-white pl-10 pr-4 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all placeholder:text-white/20"
              />
              <button
                type="submit"
                disabled={searching}
                className="bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-xs font-medium px-4 py-2.5 rounded-xl flex items-center gap-1 transition-all shrink-0 cursor-pointer disabled:opacity-50 border border-indigo-500/30 shadow-md shadow-indigo-600/20"
              >
                {searching ? '...' : 'Search'}
              </button>
            </div>
          </form>

          {/* Search Results */}
          {searchResults.length > 0 && (
            <div className="space-y-2">
              <span className="block text-xs font-semibold uppercase tracking-wider text-white/50">
                Search Results ({searchResults.length})
              </span>
              <div className="bg-black/25 rounded-2xl border border-white/10 divide-y divide-white/5 overflow-hidden">
                {searchResults.map((user) => {
                  const isSelected = selectedUsers.some((u) => u.uid === user.uid);
                  return (
                    <div
                      key={user.uid}
                      onClick={() => {
                        if (isGroup) {
                          toggleSelectUser(user);
                        } else {
                          // DM: replace selected list with just this user
                          setSelectedUsers([user]);
                        }
                      }}
                      className="p-3.5 flex items-center justify-between hover:bg-white/5 cursor-pointer transition-all"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center text-white border border-white/10"
                          style={{ background: user.avatarUrl }}
                        />
                        <div>
                          <span className="text-sm font-semibold text-white block">
                            {user.displayName}
                          </span>
                          <span className="text-[11px] font-mono text-indigo-300">
                            #{user.tag}
                          </span>
                        </div>
                      </div>

                      <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${
                        isSelected
                          ? 'bg-indigo-600 border-indigo-500 text-white shadow-sm shadow-indigo-600/30'
                          : 'border-white/20 text-transparent'
                      }`}>
                        <Check className="w-3.5 h-3.5" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Selected Members for Group Chat */}
          {isGroup && selectedUsers.length > 0 && (
            <div className="space-y-2">
              <span className="block text-xs font-semibold uppercase tracking-wider text-white/50">
                Selected Group Members ({selectedUsers.length})
              </span>
              <div className="flex flex-wrap gap-2 p-3 bg-black/25 rounded-2xl border border-white/10 max-h-24 overflow-y-auto">
                {selectedUsers.map((user) => (
                  <div
                    key={user.uid}
                    className="flex items-center gap-1.5 bg-white/5 border border-white/10 pl-2 pr-1.5 py-1 rounded-lg text-xs font-medium text-slate-200"
                  >
                    <div className="w-4 h-4 rounded-full" style={{ background: user.avatarUrl }} />
                    <span>{user.displayName}</span>
                    <button
                      onClick={() => toggleSelectUser(user)}
                      className="w-4 h-4 rounded-full hover:bg-white/10 flex items-center justify-center text-white/40 hover:text-rose-400 transition-all cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Group Configurations */}
          {isGroup && (
            <div>
              <label htmlFor="groupName" className="block text-xs font-semibold uppercase tracking-wider text-white/50 mb-2">
                Group Name
              </label>
              <input
                id="groupName"
                type="text"
                placeholder="e.g., Secure Coders, Secret HQ"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                maxLength={30}
                className="w-full bg-black/20 border border-white/10 text-white px-4 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all placeholder:text-white/20"
              />
            </div>
          )}

          {/* Encryption Passphrase Configurations */}
          <div className="bg-indigo-500/5 rounded-2xl border border-indigo-500/10 p-4 space-y-3.5">
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="w-5 h-5 text-indigo-300 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="text-xs font-bold text-indigo-200 block">End-to-End Encryption Passphrase</span>
                <p className="text-[11px] text-white/50 leading-relaxed">
                  All messages are encrypted with this key before storing on Firebase. Other members must enter this exact key in their chat setting to decrypt the chat messages. Save or copy it!
                </p>
              </div>
            </div>

            <div className="space-y-1">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Set room secret passphrase"
                  value={roomKey}
                  onChange={(e) => setRoomKey(e.target.value)}
                  maxLength={50}
                  className="w-full bg-black/25 border border-white/10 text-indigo-200 pl-4 pr-10 py-2 rounded-xl text-xs font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                />
                <button
                  type="button"
                  onClick={() => {
                    setRoomKey(Math.random().toString(36).substring(2, 8).toUpperCase() + '-' + Math.random().toString(36).substring(2, 8).toUpperCase());
                  }}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-indigo-300 hover:text-indigo-200 text-[10px] uppercase font-semibold transition-all cursor-pointer"
                >
                  Gen
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-black/25 border-t border-white/10 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2.5 text-xs font-semibold text-white/60 hover:text-white transition-all cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleCreateRoom}
            disabled={creating || selectedUsers.length === 0 || (isGroup && !groupName.trim())}
            className="bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-xs font-semibold px-5 py-2.5 rounded-xl shadow-lg shadow-indigo-600/30 flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed border border-indigo-500/30"
          >
            {creating ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <Plus className="w-4 h-4" />
                {isGroup ? 'Create Secure Group' : 'Start Secure Chat'}
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
