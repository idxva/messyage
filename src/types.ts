export interface UserProfile {
  uid: string;
  displayName: string;
  displayNameLowercase?: string; // Case-insensitive search helper
  tag: string; // 4-digit string, e.g., "4829"
  avatarUrl: string; // Selected avatar
  createdAt: any;
}

export interface ChatRoom {
  id: string;
  name: string; // Group chat name, or empty for DM
  isGroup: boolean;
  members: string[]; // List of user UIDs
  memberDetails: {
    [uid: string]: {
      displayName: string;
      tag: string;
      avatarUrl: string;
    };
  };
  encryptionKeySalt: string; // Salt used for Web Crypto PBKDF2 key derivation
  verificationSentinel?: string; // E2EE key validation sentinel
  lastMessage?: {
    senderName: string;
    encryptedText: string;
    createdAt: any;
  };
  lastMessageAt?: any;
  createdAt: any;
}

export interface Message {
  id: string;
  senderId: string;
  senderName: string;
  senderTag: string;
  senderAvatar: string;
  encryptedText: string; // AES-GCM ciphertext
  iv: string; // AES-GCM IV (hex or base64)
  createdAt: any; // Firestore Timestamp
  expiresAt?: any; // Optional expiration timestamp
  expirationDuration?: number; // Expiration duration in seconds (0 means no expiration)
  
  // File sharing
  hasFile?: boolean;
  encryptedFile?: string; // AES-GCM ciphertext of base64 file data
  fileIV?: string; // IV for the file encryption
  fileName?: string; // Plaintext filename (or we can encrypt it too, but plaintext is fine for UX)
  fileType?: string; // Mime type
  fileSize?: number; // Size in bytes
}
