import React, { useState, useEffect, useRef, useCallback } from 'react';
import { db } from '../lib/firebase';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { UserProfile, ChatRoom as RoomType, Message } from '../types';
import { encryptText, decryptText } from '../lib/crypto';
import { motion, AnimatePresence } from 'motion/react';
import {
  Send,
  Lock,
  Unlock,
  Key,
  Shield,
  Clock,
  Paperclip,
  X,
  FileText,
  Download,
  AlertCircle,
  Users,
  ChevronDown,
  Info,
  ArrowLeft,
  Copy,
  CheckCheck,
} from 'lucide-react';

interface ChatRoomProps {
  currentUser: UserProfile;
  roomId: string;
  roomCryptoKeys: { [roomId: string]: CryptoKey };
  onLoadRoomKey: (roomId: string, passphrase: string) => Promise<boolean>;
  onBack?: () => void;
}

export default function ChatRoom({
  currentUser,
  roomId,
  roomCryptoKeys,
  onLoadRoomKey,
  onBack,
}: ChatRoomProps) {
  const [room, setRoom] = useState<RoomType | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [decryptedMessages, setDecryptedMessages] = useState<{ [msgId: string]: string }>({});
  const [decryptedFiles, setDecryptedFiles] = useState<{ [msgId: string]: string }>({});
  const [decryptingFileIds, setDecryptingFileIds] = useState<{ [msgId: string]: boolean }>({});

  const [input, setInput] = useState('');
  const [passphraseInput, setPassphraseInput] = useState('');
  const [passphraseError, setPassphraseError] = useState('');
  const [loadingRoom, setLoadingRoom] = useState(true);
  const [roomError, setRoomError] = useState<string | null>(null);
  
  // Timer settings
  const [expirationDuration, setExpirationDuration] = useState<number>(0); // 0 = No expiration

  // File attached
  const [attachedFile, setAttachedFile] = useState<{
    name: string;
    type: string;
    size: number;
    dataUrl: string;
  } | null>(null);

  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [showHeaderSettings, setShowHeaderSettings] = useState(false);
  const [showMemberDetails, setShowMemberDetails] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const deletingMessageIdsRef = useRef<Set<string>>(new Set());

  // Expiry ticker trigger (updated every second)
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [copiedPassphrase, setCopiedPassphrase] = useState(false);

  // Robust timestamp parser - handles Firestore Timestamps, JS Date objects, ISO strings, and numbers
  const getTimestampMs = useCallback((ts: any): number => {
    if (!ts) return 0;
    if (typeof ts === 'number') return ts;
    if (ts.seconds !== undefined) return ts.seconds * 1000 + Math.floor((ts.nanoseconds || 0) / 1e6);
    if (ts instanceof Date) return ts.getTime();
    if (typeof ts === 'string') return new Date(ts).getTime();
    if (ts.toDate && typeof ts.toDate === 'function') return ts.toDate().getTime();
    return 0;
  }, []);

  // 1. Fetch Room Details
  useEffect(() => {
    setLoadingRoom(true);
    setRoomError(null);
    setRoom(null);
    setMessages([]);
    setDecryptedMessages({});
    setDecryptedFiles({});
    setAttachedFile(null);
    setInput('');
    setPassphraseError('');

    const roomRef = doc(db, 'rooms', roomId);
    const unsubscribe = onSnapshot(roomRef, (docSnap) => {
      if (docSnap.exists()) {
        setRoom({ id: docSnap.id, ...docSnap.data() } as RoomType);
      }
      setLoadingRoom(false);
    }, (err) => {
      console.error('Error fetching room:', err);
      setRoomError(err.message || String(err));
      setLoadingRoom(false);
    });

    return () => unsubscribe();
  }, [roomId]);

  // Auto-unlock room if passphrase is saved in localStorage
  useEffect(() => {
    const storedPassphrase = localStorage.getItem(`room_key_${roomId}`);
    if (storedPassphrase && !roomCryptoKeys[roomId]) {
      onLoadRoomKey(roomId, storedPassphrase).catch((err) => {
        console.error('Failed to auto-unlock room:', err);
      });
    }
  }, [roomId, roomCryptoKeys, onLoadRoomKey]);

  // 2. Fetch Messages in Real-time
  useEffect(() => {
    const messagesRef = collection(db, 'rooms', roomId, 'messages');
    const q = query(messagesRef, orderBy('createdAt', 'asc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs: Message[] = [];
      snapshot.forEach((docSnap) => {
        msgs.push({ id: docSnap.id, ...docSnap.data() } as Message);
      });
      setMessages(msgs);
    }, (err) => {
      console.error('Error fetching messages:', err);
      setRoomError(err.message || String(err));
    });

    return () => unsubscribe();
  }, [roomId]);

  // 3. Keep current time fresh for countdown ticker
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // 4. Client-side self-destruct trigger
  // If we identify expired messages, clean them up locally & trigger server deletion
  useEffect(() => {
    const cleanExpiredMessages = async () => {
      const now = Date.now();
      const expiredList = messages.filter((msg) => {
        if (!msg.expiresAt) return false;
        if (deletingMessageIdsRef.current.has(msg.id)) return false;
        return getTimestampMs(msg.expiresAt) < now;
      });

      for (const msg of expiredList) {
        deletingMessageIdsRef.current.add(msg.id);
        try {
          // Delete message from Firestore
          await deleteDoc(doc(db, 'rooms', roomId, 'messages', msg.id));
        } catch (err) {
          console.error('Failed to clean up expired message:', msg.id, err);
          deletingMessageIdsRef.current.delete(msg.id);
        }
      }
    };

    if (messages.length > 0) {
      cleanExpiredMessages();
    }
  }, [messages, currentTime, roomId, getTimestampMs]);

  // 5. Decrypt text messages as keys or messages update
  useEffect(() => {
    const decryptAll = async () => {
      const key = roomCryptoKeys[roomId];
      if (!key) {
        setDecryptedMessages({});
        setDecryptedFiles({});
        return;
      }

      const decDict: { [msgId: string]: string } = {};
      const decFilesDict: { [msgId: string]: string } = {};

      for (const msg of messages) {
        try {
          // To support both text payloads and nested encrypted items,
          // decryptText parses JSON formatted ciphertext or decrypts base64 directly.
          if (msg.encryptedText.startsWith('{')) {
            const parsed = JSON.parse(msg.encryptedText);
            const dec = await decryptText(parsed.ciphertext, parsed.iv, key);
            decDict[msg.id] = dec;
          } else {
            decDict[msg.id] = msg.encryptedText; // fallback
          }
        } catch (e) {
          decDict[msg.id] = '🔒 [Decryption failed - Check passphrase]';
        }

        // Auto-decrypt image files for inline preview
        if (msg.hasFile && msg.fileType?.startsWith('image/') && msg.encryptedFile && msg.fileIV) {
          try {
            const decFile = await decryptText(msg.encryptedFile, msg.fileIV, key);
            decFilesDict[msg.id] = decFile;
          } catch (e) {
            console.error('Failed to auto-decrypt image:', e);
          }
        }
      }

      setDecryptedMessages(decDict);
      setDecryptedFiles(decFilesDict);
    };

    decryptAll();
  }, [messages, roomCryptoKeys, roomId]);

  // 6. Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, decryptedMessages]);

  const activeKey = roomCryptoKeys[roomId];

  // Derive key from manual password entry
  const handleUnlockRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphraseInput.trim()) return;

    setPassphraseError('');
    try {
      const success = await onLoadRoomKey(roomId, passphraseInput.trim());
      if (success) {
        setPassphraseInput('');
      } else {
        setPassphraseError('Invalid passphrase. Unable to derive key.');
      }
    } catch (err: any) {
      setPassphraseError('Error deriving key: ' + err.message);
    }
  };

  // Handle uploading files and converting to base64
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 500 * 1024) {
      setError('File size exceeds the 500KB limit for E2EE storage.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setAttachedFile({
        name: file.name,
        type: file.type,
        size: file.size,
        dataUrl: reader.result as string,
      });
      setError('');
    };
    reader.onerror = () => {
      setError('Failed to read file.');
    };
    reader.readAsDataURL(file);
  };

  const removeAttachedFile = () => {
    setAttachedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Decrypt and trigger dynamic download of files
  const downloadAndDecryptFile = async (msg: Message) => {
    if (!activeKey || !msg.encryptedFile || !msg.fileIV) return;

    setDecryptingFileIds((prev) => ({ ...prev, [msg.id]: true }));

    try {
      // Decrypt file dataUrl base64 string
      const decryptedDataUrl = await decryptText(msg.encryptedFile, msg.fileIV, activeKey);
      
      // Save in cache
      setDecryptedFiles((prev) => ({ ...prev, [msg.id]: decryptedDataUrl }));

      // Create download trigger
      const link = document.createElement('a');
      link.href = decryptedDataUrl;
      link.download = msg.fileName || 'decrypted_file';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      alert('Failed to decrypt and download file. Check room password.');
    } finally {
      setDecryptingFileIds((prev) => ({ ...prev, [msg.id]: false }));
    }
  };

  const handleSendMessage = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!input.trim() && !attachedFile) return;
    if (!activeKey) {
      setError('Cannot send message. Room key is locked.');
      return;
    }

    setSending(true);
    setError('');

    try {
      const messagesRef = collection(db, 'rooms', roomId, 'messages');

      // 1. Encrypt message text
      const encryptedMsg = await encryptText(input.trim() || 'Sent an attachment', activeKey);
      const encryptedMsgPayload = JSON.stringify(encryptedMsg);

      // 2. Encrypt attached file if any
      let encryptedFilePayload = '';
      let fileIVPayload = '';

      if (attachedFile) {
        const encryptedFile = await encryptText(attachedFile.dataUrl, activeKey);
        encryptedFilePayload = encryptedFile.ciphertext;
        fileIVPayload = encryptedFile.iv;
      }

      // 3. Compute expiration timestamp
      let expiresAtTimestamp: any = null;
      if (expirationDuration > 0) {
        expiresAtTimestamp = new Date(Date.now() + expirationDuration * 1000);
      }

      const msgData: any = {
        senderId: currentUser.uid,
        senderName: currentUser.displayName,
        senderTag: currentUser.tag,
        senderAvatar: currentUser.avatarUrl,
        encryptedText: encryptedMsgPayload,
        createdAt: new Date(), // using local timestamp to avoid index sync race conditions during E2EE client processing
        expirationDuration: expirationDuration || 0,
      };

      if (expiresAtTimestamp) {
        msgData.expiresAt = expiresAtTimestamp;
      }

      if (attachedFile) {
        msgData.hasFile = true;
        msgData.encryptedFile = encryptedFilePayload;
        msgData.fileIV = fileIVPayload;
        msgData.fileName = attachedFile.name;
        msgData.fileType = attachedFile.type;
        msgData.fileSize = attachedFile.size;
      }

      // Add to Firestore subcollection
      await addDoc(messagesRef, msgData);

      // Update room lastMessage for sidebar previews
      const roomRef = doc(db, 'rooms', roomId);
      await updateDoc(roomRef, {
        lastMessage: {
          senderName: currentUser.displayName,
          encryptedText: encryptedMsgPayload,
          createdAt: new Date().toISOString(),
        },
        lastMessageAt: serverTimestamp(),
      });

      // Reset state
      setInput('');
      setAttachedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      console.error('Failed to send message:', err);
      setError('Encryption/Delivery failure: ' + err.message);
    } finally {
      setSending(false);
    }
  };

  if (loadingRoom) {
    return (
      <div className="flex-grow bg-transparent flex flex-col justify-center items-center text-white/50">
        <div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mb-2" />
        <span className="text-sm">Connecting to secure tunnel...</span>
      </div>
    );
  }

  if (roomError) {
    return (
      <div className="flex-grow bg-transparent flex flex-col justify-center items-center text-rose-300 p-8 text-center">
        <div className="max-w-md space-y-6 glass p-8 rounded-3xl border border-rose-500/25 shadow-2xl relative z-10">
          <div className="w-16 h-16 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex items-center justify-center mx-auto text-rose-400 shadow-xl">
            <AlertCircle className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-white tracking-tight">
              Secure Connection Failed
            </h2>
            <p className="text-xs text-rose-300/70 leading-relaxed">
              Unable to sync secure messages. This can happen if the database rules are blocking access or the Firebase configuration is invalid.
            </p>
            <p className="text-xs text-rose-400 font-mono bg-rose-950/20 p-3 rounded-xl border border-rose-500/15 break-words font-mono">
              {roomError}
            </p>
          </div>
          {onBack && (
            <button
              onClick={onBack}
              className="inline-flex bg-white/5 hover:bg-white/10 text-white text-xs font-semibold px-6 py-3 rounded-xl transition-all border border-white/10 cursor-pointer"
            >
              Back to Sidebar
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="flex-grow bg-transparent flex flex-col justify-center items-center text-white/40">
        <AlertCircle className="w-12 h-12 text-white/10 mb-2" />
        <span className="text-sm">Secure room not found or access denied.</span>
      </div>
    );
  }

  // Get recipient name for DM
  let chatTitle = '';
  let chatAvatar = '';
  if (room.isGroup) {
    chatTitle = room.name;
    chatAvatar = 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)';
  } else {
    const otherUid = room.members.find((uid) => uid !== currentUser.uid);
    const otherDetails = otherUid ? room.memberDetails[otherUid] : null;
    chatTitle = otherDetails?.displayName || 'Unknown Secure User';
    chatAvatar = otherDetails?.avatarUrl || 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)';
  }

  return (
    <div className="flex-1 bg-transparent flex flex-col h-full relative overflow-hidden font-sans">
      
      {/* 1. Header Area */}
      <div className="px-6 py-4 bg-black/15 backdrop-blur-md border-b border-white/10 flex items-center justify-between shadow-sm relative z-10">
        <div className="flex items-center gap-3 min-w-0">
          {onBack && (
            <button
              onClick={onBack}
              className="md:hidden w-8 h-8 rounded-lg hover:bg-white/5 flex items-center justify-center text-white/60 hover:text-white transition-all cursor-pointer shrink-0 border border-white/10"
              title="Back to chats"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center border border-white/10 shadow-md shadow-black/20 text-white shrink-0"
            style={{ background: chatAvatar }}
          >
            {room.isGroup && <Users className="w-5 h-5 text-indigo-300" />}
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-white truncate font-display flex items-center gap-2">
              {chatTitle}
              {activeKey ? (
                <span className="text-[10px] bg-emerald-500/10 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/20 font-medium">
                  Secured
                </span>
              ) : (
                <span className="text-[10px] bg-indigo-500/10 text-indigo-300 px-2 py-0.5 rounded-full border border-indigo-500/20 font-medium flex items-center gap-1">
                  <Lock className="w-2.5 h-2.5 animate-pulse" /> Locked
                </span>
              )}
            </h3>
            <p className="text-[11px] text-white/50 truncate flex items-center gap-1 mt-0.5">
              {room.isGroup ? (
                <button
                  onClick={() => setShowMemberDetails(!showMemberDetails)}
                  className="hover:text-indigo-300 flex items-center gap-1 font-medium transition-all"
                >
                  {room.members.length} members <Info className="w-3 h-3" />
                </button>
              ) : (
                'End-to-End Encrypted Tunnel'
              )}
            </p>
          </div>
        </div>

        {/* Header CTA Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHeaderSettings(!showHeaderSettings)}
            className="px-3 py-1.5 bg-black/20 hover:bg-white/5 text-white/80 hover:text-white rounded-lg text-xs font-semibold border border-white/10 flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <Key className="w-3.5 h-3.5 text-indigo-300" />
            <span>Key Manager</span>
            <ChevronDown className={`w-3 h-3 transition-transform ${showHeaderSettings ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* Group Members detail overlay */}
      {showMemberDetails && room.isGroup && (
        <div className="absolute top-16 left-6 right-6 glass border border-white/10 rounded-2xl p-4 shadow-2xl z-20 animate-fade-in max-w-sm">
          <div className="flex justify-between items-center mb-2 pb-2 border-b border-white/10">
            <span className="text-xs font-bold text-slate-200">Group Members ({room.members.length})</span>
            <button onClick={() => setShowMemberDetails(false)} className="text-white/40 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {Object.keys(room.memberDetails).map((uid) => {
              const m = room.memberDetails[uid];
              return (
                <div key={uid} className="flex items-center gap-2 text-xs">
                  <div className="w-6 h-6 rounded-full border border-white/5" style={{ background: m.avatarUrl }} />
                  <span className="font-semibold text-white">{m.displayName}</span>
                  <span className="text-indigo-300 font-mono">#{m.tag}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Key Manager Settings Drawer */}
      <AnimatePresence>
        {showHeaderSettings && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-black/20 border-b border-white/10 px-6 py-4 overflow-hidden relative z-10 flex flex-col gap-3 backdrop-blur-md"
          >
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1 max-w-md">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Shield className="w-4 h-4 text-indigo-300" /> End-to-End Encryption Keys
                </span>
                <p className="text-[11px] text-white/50 leading-relaxed">
                  The encryption key is derived client-side using PBKDF2 with the salt: 
                  <span className="font-mono bg-black/30 text-indigo-300 px-1.5 py-0.5 rounded border border-white/5 ml-1 text-[10px] break-all">{room.encryptionKeySalt}</span>. 
                  Any database host can only see raw AES-GCM ciphertext.
                </p>
              </div>

              {/* Password synchronization visual */}
              <div className="bg-black/25 p-2.5 rounded-xl border border-white/10 flex items-center gap-3 shrink-0">
                <div className="space-y-0.5 font-mono min-w-0">
                  <span className="text-[9px] text-white/40 uppercase font-semibold block">Active Passphrase</span>
                  <span className="text-xs text-indigo-200 font-bold tracking-wider block truncate max-w-[120px]">
                    {activeKey ? '••••••••••••' : 'Not unlocked'}
                  </span>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={async () => {
                      const pass = localStorage.getItem(`room_key_${roomId}`);
                      if (pass) {
                        await navigator.clipboard.writeText(pass).catch(() => {});
                        setCopiedPassphrase(true);
                        setTimeout(() => setCopiedPassphrase(false), 2000);
                      }
                    }}
                    className="px-2.5 py-1.5 bg-white/5 hover:bg-white/10 text-indigo-300 hover:text-white rounded-lg text-[10px] font-bold border border-white/10 cursor-pointer transition-all shrink-0 flex items-center gap-1"
                    title="Copy passphrase to clipboard"
                  >
                    {copiedPassphrase ? <CheckCheck className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    {copiedPassphrase ? 'Copied!' : 'Copy'}
                  </button>
                  <button
                    onClick={() => {
                      const pass = prompt('Enter the shared room passphrase to unlock decryption:');
                      if (pass !== null && pass.trim()) {
                        onLoadRoomKey(roomId, pass.trim());
                        setShowHeaderSettings(false);
                      }
                    }}
                    className="px-2.5 py-1.5 bg-white/5 hover:bg-white/10 text-indigo-300 hover:text-white rounded-lg text-[10px] font-bold border border-white/10 cursor-pointer transition-all shrink-0"
                  >
                    Change
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>


      {/* 2. Chat Feed Overlay or Conversation */}
      {!activeKey ? (
        /* LOCK SCREEN OVERLAY */
        <div className="flex-1 bg-transparent flex flex-col justify-center items-center px-6 relative">
          <div className="w-full max-w-sm glass border border-white/10 rounded-3xl p-6 text-center space-y-5 shadow-2xl relative">
            <div className="w-12 h-12 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-center text-indigo-300 mx-auto shadow-sm">
              <Lock className="w-6 h-6 animate-pulse" />
            </div>

            <div className="space-y-1.5">
              <h4 className="text-sm font-bold text-white tracking-tight">
                Unlock Decrypted Payload
              </h4>
              <p className="text-[11px] text-white/50 leading-relaxed">
                This room is end-to-end encrypted. Enter the shared passphrase to derive the AES-GCM decryption key and unlock your messages.
              </p>
            </div>

            <form onSubmit={handleUnlockRoom} className="space-y-3">
              {passphraseError && (
                <div className="p-2 text-[10px] text-rose-400 bg-rose-500/5 border border-rose-500/20 rounded-lg">
                  {passphraseError}
                </div>
              )}

              <input
                type="password"
                placeholder="Enter shared room password passphrase..."
                value={passphraseInput}
                onChange={(e) => setPassphraseInput(e.target.value)}
                required
                className="w-full bg-black/25 border border-white/10 text-white text-xs px-3.5 py-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500/50 transition-all font-mono"
              />

              <button
                type="submit"
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold py-2.5 px-4 rounded-xl shadow-lg shadow-indigo-600/30 cursor-pointer transition-all flex items-center justify-center gap-1.5 border border-indigo-500/30"
              >
                <Unlock className="w-3.5 h-3.5" /> Unlock Secure Tunnel
              </button>
            </form>

            <p className="text-[10px] text-white/40">
              *If you created this room, copy the key you specified and paste it here.
            </p>
          </div>
        </div>
      ) : (
        /* MESSAGES VIEW CONTAINER */
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 flex flex-col">
          {messages.length === 0 ? (
            <div className="flex-1 flex flex-col justify-center items-center text-white/30 text-xs">
              <Shield className="w-10 h-10 text-white/10 mb-2" />
              <span>Secure tunnel initialized. Type a message to begin.</span>
              <span className="text-[10px] text-white/20 mt-1 max-w-[250px] text-center">
                All logs, file binaries, and text payloads are fully encrypted client-side.
              </span>
            </div>
          ) : (
            <div className="space-y-3.5 flex-1 flex flex-col">
              {/* Spacer to push content to bottom when there are few messages */}
              <div className="flex-grow" />
              <AnimatePresence initial={false}>
                {messages.map((msg) => {
                  const isSelf = msg.senderId === currentUser.uid;
                  const decryptedText = decryptedMessages[msg.id];
                  const expireMs = msg.expiresAt ? getTimestampMs(msg.expiresAt) : 0;
                  const hasExpired = expireMs > 0 && expireMs < currentTime;

                  if (hasExpired) return null; // Filter out

                  // Calculate remaining seconds
                  const remainingSeconds = expireMs > 0 ? Math.max(0, Math.ceil((expireMs - currentTime) / 1000)) : 0;

                  return (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 12, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9, y: -10, transition: { duration: 0.4 } }}
                      className={`flex flex-col max-w-[75%] ${isSelf ? 'self-end items-end' : 'self-start items-start'}`}
                    >
                      {/* Name Header for DMs/Group */}
                      {!isSelf && (
                        <div className="flex items-center gap-1.5 mb-1 text-[10px] font-semibold text-white/40 pl-1">
                          <span className="text-white/60">{msg.senderName}</span>
                          <span className="text-indigo-300 font-mono text-[9px]">#{msg.senderTag}</span>
                        </div>
                      )}

                      {/* Message Bubble */}
                      <div className={`p-3 rounded-2xl relative border ${
                        isSelf
                          ? 'bg-indigo-600/80 backdrop-blur-sm border-indigo-500/25 text-white rounded-tr-none shadow-md shadow-indigo-600/10'
                          : 'bg-white/5 backdrop-blur-sm border-white/10 text-white rounded-tl-none shadow-sm'
                      }`}>
                        
                        {/* Text Message decrypted or ciphertext fallback */}
                        {decryptedText ? (
                          <p className="text-xs leading-relaxed whitespace-pre-wrap select-text selection:bg-indigo-500 selection:text-white">
                            {decryptedText}
                          </p>
                        ) : (
                          <div className="flex items-center gap-1.5 text-[11px] text-indigo-300 font-mono bg-black/30 p-2 rounded-lg border border-white/5">
                            <Lock className="w-3.5 h-3.5 animate-pulse shrink-0" />
                            <span className="truncate max-w-[200px]">
                              {msg.encryptedText.substring(0, 30)}...
                            </span>
                          </div>
                        )}

                        {/* Expiring timer countdown pill */}
                        {msg.expiresAt && remainingSeconds > 0 && (
                          <div className="flex items-center gap-1 text-[8px] tracking-wider uppercase font-mono text-indigo-200 bg-black/25 px-1.5 py-0.5 rounded-full mt-2 w-max shrink-0">
                            <Clock className="w-2.5 h-2.5 animate-spin" style={{ animationDuration: '3s' }} />
                            <span>Self-destruct: {remainingSeconds}s</span>
                          </div>
                        )}

                        {/* Image Preview */}
                        {msg.hasFile && msg.fileType?.startsWith('image/') && decryptedFiles[msg.id] && (
                          <div className="mt-2 rounded-xl overflow-hidden max-w-xs border border-white/10 shadow-md">
                            <img
                              src={decryptedFiles[msg.id]}
                              alt={msg.fileName}
                              className="w-full h-auto max-h-48 object-cover cursor-pointer hover:scale-[1.02] transition-transform"
                              onClick={() => {
                                const link = document.createElement('a');
                                link.href = decryptedFiles[msg.id];
                                link.download = msg.fileName || 'image';
                                link.click();
                              }}
                            />
                          </div>
                        )}

                        {/* File Card Attachment */}
                        {msg.hasFile && (!msg.fileType?.startsWith('image/') || !decryptedFiles[msg.id]) && (
                          <div className="mt-2.5 p-2 bg-black/35 border border-white/10 rounded-xl flex items-center justify-between gap-3 min-w-[210px]">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-indigo-300 shrink-0">
                                <FileText className="w-4 h-4" />
                              </div>
                              <div className="min-w-0 leading-tight">
                                <span className="text-[11px] font-bold text-slate-200 block truncate" title={msg.fileName}>
                                  {msg.fileName}
                                </span>
                                <span className="text-[9px] text-white/40 font-mono">
                                  {msg.fileSize ? (msg.fileSize / 1024).toFixed(1) + ' KB' : 'Size unknown'}
                                </span>
                              </div>
                            </div>

                            <button
                              onClick={() => downloadAndDecryptFile(msg)}
                              disabled={decryptingFileIds[msg.id]}
                              className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 text-indigo-300 hover:text-white flex items-center justify-center transition-all cursor-pointer border border-white/10 shrink-0"
                              title="Decrypt and Download File"
                            >
                              {decryptingFileIds[msg.id] ? (
                                <div className="w-3.5 h-3.5 border border-indigo-400 border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <Download className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        )}

                      </div>

                      {/* Timestamp Footer */}
                      <span className="text-[9px] text-slate-600 font-mono mt-1 px-1 block">
                        {(() => {
                          const ms = getTimestampMs(msg.createdAt);
                          return ms > 0
                            ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : '';
                        })()}
                      </span>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      )}

      {/* 3. Input & Attachment Footer Panel */}
      {activeKey && (
        <div className="p-4 bg-black/15 border-t border-white/10 backdrop-blur-md relative z-10 flex flex-col gap-3.5">
          {error && (
            <div className="px-3.5 py-1.5 text-[10px] text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg flex items-center gap-1.5 animate-fade-in">
              <AlertCircle className="w-3.5 h-3.5" /> {error}
            </div>
          )}

          {/* Upload preview banner */}
          {attachedFile && (
            <div className="flex items-center justify-between bg-black/30 p-2.5 rounded-xl border border-white/10">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-300 shrink-0" />
                <div className="leading-tight">
                  <span className="text-xs font-semibold text-slate-200 block max-w-[200px] truncate">
                    {attachedFile.name}
                  </span>
                  <span className="text-[9px] text-white/40 font-mono">
                    {(attachedFile.size / 1024).toFixed(1)} KB (E2EE payload ready)
                  </span>
                </div>
              </div>
              <button
                onClick={removeAttachedFile}
                className="w-6 h-6 rounded-lg hover:bg-white/5 flex items-center justify-center text-white/40 hover:text-white transition-all cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Form Actions (Attachment select, Expiration timer, Text send) */}
          <form onSubmit={handleSendMessage} className="flex items-center gap-2">
            
            {/* Attachment Pin */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-10 h-10 bg-black/20 hover:bg-white/5 border border-white/10 rounded-xl flex items-center justify-center text-white/60 hover:text-white transition-all shrink-0 cursor-pointer"
              title="Attach File (Max 500KB)"
            >
              <Paperclip className="w-4 h-4" />
            </button>

            {/* Expiration Timer selector */}
            <div className="relative shrink-0">
              <select
                value={expirationDuration}
                onChange={(e) => setExpirationDuration(Number(e.target.value))}
                className="w-10 h-10 bg-black/20 hover:bg-white/5 border border-white/10 rounded-xl appearance-none flex items-center justify-center text-white/60 hover:text-white transition-all cursor-pointer text-[11px] font-mono font-semibold pl-3 pr-2 focus:outline-none"
                title="Set Temporary Message Expiry Time"
              >
                <option value={0}>♾️</option>
                <option value={15}>15s</option>
                <option value={60}>1m</option>
                <option value={300}>5m</option>
                <option value={3600}>1h</option>
              </select>
              {expirationDuration > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-indigo-600 text-white font-mono text-[9px] rounded-full flex items-center justify-center border border-white/10 font-bold scale-90 animate-pulse">
                  T
                </span>
              )}
            </div>

            {/* Text Input - textarea with Enter to send, Shift+Enter for newline */}
            <textarea
              placeholder={attachedFile ? "Type a file description (optional)..." : "Type a secure E2EE message..."}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (input.trim() || attachedFile) {
                    handleSendMessage(e as any);
                  }
                }
              }}
              rows={1}
              className="flex-1 bg-black/20 border border-white/10 text-white px-4 py-2.5 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500/50 transition-all placeholder:text-white/20 resize-none"
              style={{ minHeight: '40px', maxHeight: '96px' }}
            />

            {/* Send Button */}
            <button
              type="submit"
              disabled={sending || (!input.trim() && !attachedFile)}
              className="w-10 h-10 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:bg-white/5 disabled:text-white/20 text-white rounded-xl flex items-center justify-center transition-all shrink-0 cursor-pointer shadow-lg shadow-indigo-600/25 border border-indigo-500/30"
              title="Send Secured Message"
            >
              {sending ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </form>
        </div>
      )}

    </div>
  );
}
