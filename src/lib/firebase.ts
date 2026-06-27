import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "mercurial-valor-62t1j",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:327674895758:web:2a9934bdd2f378defc18df",
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDNzvtFjKjtDtSAup1txPLmEKDhH1M0Qe0",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "mercurial-valor-62t1j.firebaseapp.com",
  firestoreDatabaseId: import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID || "default",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "mercurial-valor-62t1j.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "327674895758",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || ""
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Cloud Firestore and get a reference to the service
export const db = getFirestore(app);
export default app;
