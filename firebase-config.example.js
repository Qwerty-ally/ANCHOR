// ── ANCHOR FIREBASE CONFIGURATION ─────────────────────────────────
// SETUP STEPS:
// 1. Go to https://console.firebase.google.com and create a project
// 2. Add a Web App (</> icon), copy the config below
// 3. In Firebase console, enable these services:
//    - Authentication → Sign-in method → Email/Password → Enable
//    - Firestore Database → Create database → Start in test mode
//    - Storage → Get started → Start in test mode
//    - Realtime Database → Create database → Start in test mode
// 4. Paste your config values below and save

const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL:       "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

// The username that becomes the Owner when they first register
const OWNER_USERNAME = "admin";

// ── FIREBASE SECURITY RULES (paste these in the Firebase console) ──
//
// FIRESTORE RULES (Firestore → Rules):
// rules_version = '2';
// service cloud.firestore {
//   match /databases/{database}/documents {
//     match /{document=**} {
//       allow read, write: if request.auth != null;
//     }
//   }
// }
//
// STORAGE RULES (Storage → Rules):
// rules_version = '2';
// service firebase.storage {
//   match /b/{bucket}/o {
//     match /{allPaths=**} {
//       allow read, write: if request.auth != null;
//     }
//   }
// }
//
// REALTIME DATABASE RULES (Realtime Database → Rules):
// { "rules": { ".read": "auth != null", ".write": "auth != null" } }
