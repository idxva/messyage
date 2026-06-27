import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "messyage-b82a3",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:118650433319:web:668fcc0c75f47191d20302",
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyC_8-gJdWUVs8mUVzWoc0ERI3eG9ZhWO3U",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "messyage-b82a3.firebaseapp.com",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "messyage-b82a3.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "118650433319",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-QP41Y3MK69",
};

// The Firestore database ID - 'default' means the default database
const firestoreDatabaseId = import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID || 'default';

// Detect if any custom configuration was supplied
const isCustomConfig = !!(
  import.meta.env.VITE_FIREBASE_PROJECT_ID ||
  import.meta.env.VITE_FIREBASE_API_KEY ||
  import.meta.env.VITE_FIREBASE_APP_ID
);

console.log(
  `[Firebase Init] Using ${isCustomConfig ? 'custom environment config' : 'fallback template config'} (Project: ${firebaseConfig.projectId})`
);

if (isCustomConfig) {
  const missing = [];
  if (!import.meta.env.VITE_FIREBASE_PROJECT_ID) missing.push('VITE_FIREBASE_PROJECT_ID');
  if (!import.meta.env.VITE_FIREBASE_API_KEY) missing.push('VITE_FIREBASE_API_KEY');
  if (!import.meta.env.VITE_FIREBASE_APP_ID) missing.push('VITE_FIREBASE_APP_ID');
  if (missing.length > 0) {
    console.warn(`[Firebase Init] Warning: Custom configuration is active but missing critical variables: ${missing.join(', ')}. This might prevent database connection.`);
  }
}

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Cloud Firestore - pass the database ID if it's not 'default'
export const db = firestoreDatabaseId && firestoreDatabaseId !== 'default'
  ? getFirestore(app, firestoreDatabaseId)
  : getFirestore(app);

export default app;
