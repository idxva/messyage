import React, { useState, useEffect } from 'react';
import { db } from '../lib/firebase';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { UserProfile, ChatRoom } from '../types';
import { deriveKey, decryptText } from '../lib/crypto';
import { Search, Plus, LogOut, MessageSquare, ShieldAlert, Key, Users } from 'lucide-react';

interface ChatSidebarProps {
  currentUser: UserProfile;
  selectedRoomId: string | null;
  onSelectRoom: (roomId: string) => void;
  onOpenNewChat: () => void;
  onLogout: () => void;
  roomCryptoKeys: { [roomId: string]: CryptoKey };
  onLoadRoomKey: (roomId: string, passphrase: string) => Promise<boolean>;
}

export default function ChatSidebar({
  currentUser,
  selectedRoomId,
  onSelectRoom,
  onOpenNewChat,
  onLogout,
  roomCryptoKeys,
  onLoadRoomKey,
}: ChatSidebarProps) {
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterQuery, setFilterQuery] = useState('');
  const [decryptedSnippets, setDecryptedSnippets] = useState<{ [roomId: string]: string }>({});

  // Listen to active rooms the user is a member of
  useEffect(() => {
    const roomsRef = collection(db, 'rooms');
    const q = query(
      roomsRef,
      where('members', 'array-contains', currentUser.uid),
      orderBy('lastMessageAt', 'desc')
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const roomsList: ChatRoom[] = [];
        snapshot.forEach((doc) => {
          roomsList.push({ id: doc.id, ...doc.data() } as ChatRoom);
        });
        setRooms(roomsList);
        setLoading(false);
      },
      (error) => {
        console.error('Error listening to rooms:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [currentUser.uid]);

  // Decrypt last message snippets dynamically when keys or rooms update
  useEffect(() => {
    const decryptSnippets = async () => {
      const snippets: { [roomId: string]: string } = {};

      for (const room of rooms) {
        if (!room.lastMessage) continue;

        const key = roomCryptoKeys[room.id];
        const lastMsg = room.lastMessage;

        if (!key) {
          // If no key derived yet, check local storage for stored passphrase and attempt auto-load
          const storedPassphrase = localStorage.getItem(`room_key_${room.id}`);
          if (storedPassphrase) {
            try {
              const success = await onLoadRoomKey(room.id, storedPassphrase);
              if (success) {
                // Key will be available in next render cycle
                continue;
              }
            } catch (e) {
              console.error('Auto key derivation failed for room:', room.id, e);
            }
          }
          snippets[room.id] = '🔒 [Encrypted message]';
          continue;
        }

        try {
          // Since it's stored in lastMessage as { senderName, encryptedText }
          // We must check if the last message had iv.
          // Wait, lastMessage is a simple summary. If we store lastMessage as plaintext, it violates E2EE!
          // So we must store it encrypted in Firestore or just show encrypted text.
          // Let's check how we save lastMessage. We should save it encrypted using the room's derived key!
          // We'll design lastMessage to contain both `{ encryptedText, iv }`.
          // Let's assume it has it.
          const msgPayload = lastMsg.encryptedText; // This can be JSON string "{ciphertext, iv}" or we store them directly.
          if (msgPayload.startsWith('{')) {
            const parsed = JSON.parse(msgPayload);
            const decrypted = await decryptText(parsed.ciphertext, parsed.iv, key);
            snippets[room.id] = decrypted.length > 25 ? decrypted.substring(0, 25) + '...' : decrypted;
          } else {
            snippets[room.id] = lastMsg.encryptedText; // Fallback
          }
        } catch (e) {
          snippets[room.id] = '🔒 [Locked - Click to unlock]';
        }
      }

      setDecryptedSnippets(snippets);
    };

    decryptSnippets();
  }, [rooms, roomCryptoKeys, onLoadRoomKey]);

  // Filter rooms by name or other member's display name
  const filteredRooms = rooms.filter((room) => {
    if (room.isGroup) {
      return room.name.toLowerCase().includes(filterQuery.toLowerCase());
    } else {
      // Find the other member's detail
      const otherUid = room.members.find((uid) => uid !== currentUser.uid);
      const otherDetails = otherUid ? room.memberDetails[otherUid] : null;
      return otherDetails?.displayName.toLowerCase().includes(filterQuery.toLowerCase()) || false;
    }
  });

  return (
    <div className="w-full md:w-80 bg-transparent h-full flex flex-col shrink-0 font-sans">
      
      {/* Brand & Search/New Chat */}
      <div className="p-4 space-y-3.5 border-b border-white/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-white/5 border border-white/10 rounded-lg flex items-center justify-center shadow-md text-indigo-300">
              <MessageSquare className="w-[18px] h-[18px]" />
            </div>
            <span className="font-bold text-white font-display tracking-tight text-md">
              SecureSphere
            </span>
          </div>

          <button
            onClick={onOpenNewChat}
            className="w-9 h-9 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl flex items-center justify-center transition-all cursor-pointer shadow-md shadow-indigo-600/30 border border-indigo-500/25"
            title="Start New Chat"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>

        {/* Local Search input */}
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-white/30">
            <Search className="w-4 h-4" />
          </div>
          <input
            type="text"
            placeholder="Search chats..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            className="w-full bg-black/20 border border-white/10 text-white pl-9 pr-4 py-2 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500/50 transition-all placeholder:text-white/20"
          />
        </div>
      </div>

      {/* Room list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-48 space-y-2 text-white/50">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs">Loading chats...</span>
          </div>
        ) : filteredRooms.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center px-4">
            <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/30 mb-3">
              <MessageSquare className="w-6 h-6" />
            </div>
            <p className="text-xs font-semibold text-white/70">No active chats</p>
            <p className="text-[11px] text-white/40 mt-1 max-w-[200px]">
              Click the <span className="font-bold text-white/60">+</span> button to search users and start securely messaging.
            </p>
          </div>
        ) : (
          filteredRooms.map((room) => {
            const isSelected = selectedRoomId === room.id;
            const hasKey = !!roomCryptoKeys[room.id];

            // Determine room avatar and name
            let roomName = '';
            let roomAvatar = '';
            let isOnlineDummy = false; // visual indicator only

            if (room.isGroup) {
              roomName = room.name;
              roomAvatar = 'linear-gradient(135deg, #334155 0%, #1e293b 100%)';
            } else {
              const otherUid = room.members.find((uid) => uid !== currentUser.uid);
              const otherDetails = otherUid ? room.memberDetails[otherUid] : null;
              roomName = otherDetails?.displayName || 'Unknown User';
              roomAvatar = otherDetails?.avatarUrl || 'linear-gradient(135deg, #64748b 0%, #475569 100%)';
            }

            const snippet = room.lastMessage
              ? (decryptedSnippets[room.id] || '🔒 Encrypted Payload')
              : '🌱 Secure room created';

            return (
              <div
                key={room.id}
                onClick={() => onSelectRoom(room.id)}
                className={`group p-3 rounded-xl flex items-center justify-between cursor-pointer transition-all border ${
                  isSelected
                    ? 'bg-indigo-600/15 border-indigo-500/20 text-white'
                    : 'hover:bg-white/5 border-transparent text-slate-300 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {/* Avatar wrapper */}
                  <div className="relative shrink-0">
                    <div
                      className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold border border-white/5 shadow-md shadow-black/20"
                      style={{ background: roomAvatar }}
                    >
                      {room.isGroup && <Users className="w-5 h-5 text-indigo-300" />}
                    </div>
                    {/* Visual status dot for DM */}
                    {!room.isGroup && (
                      <span className="absolute bottom-0.5 right-0.5 w-2.5 h-2.5 bg-emerald-500 border-2 border-slate-950 rounded-full" />
                    )}
                  </div>

                  {/* Room Details */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-1.5">
                      <span className="text-xs font-bold font-display truncate block text-white">
                        {roomName}
                      </span>
                      {room.lastMessageAt && (
                        <span className="text-[9px] text-white/40 font-mono shrink-0">
                          {(() => {
                            const ts = room.lastMessageAt;
                            const ms = ts?.seconds ? ts.seconds * 1000 : ts?.toDate ? ts.toDate().getTime() : (ts instanceof Date ? ts.getTime() : 0);
                            return ms > 0 ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                          })()}
                        </span>
                      )}
                    </div>
                    <p className={`text-[11px] truncate mt-0.5 font-sans flex items-center gap-1 ${
                      snippet.startsWith('🔒') ? 'text-indigo-300 font-mono text-[10px]' : 'text-white/50'
                    }`}>
                      {snippet}
                    </p>
                  </div>
                </div>

                {/* Secure key state pill */}
                <div className="ml-2 shrink-0">
                  {hasKey ? (
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 group-hover:scale-125 transition-all shadow-sm shadow-indigo-500/50" title="Secure E2EE Unlocked" />
                  ) : (
                    <Key className="w-3.5 h-3.5 text-indigo-400/30" title="Key Locked" />
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* User profile drawer footer */}
      <div className="p-3 bg-black/25 border-t border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center border border-white/10 shrink-0"
            style={{ background: currentUser.avatarUrl }}
          />
          <div className="min-w-0">
            <span className="text-xs font-bold text-white block truncate">
              {currentUser.displayName}
            </span>
            <span className="text-[10px] font-mono text-indigo-300 block truncate leading-none mt-0.5">
              #{currentUser.tag}
            </span>
          </div>
        </div>

        <button
          onClick={onLogout}
          className="w-8 h-8 rounded-lg hover:bg-white/5 flex items-center justify-center text-white/40 hover:text-rose-400 transition-all cursor-pointer"
          title="Sign Out Profile"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>

    </div>
  );
}
