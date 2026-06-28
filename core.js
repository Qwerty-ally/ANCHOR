// ── ANCHOR CORE — Firebase Edition ────────────────────────────────

// ── FIREBASE GLOBALS ───────────────────────────────────────────────
let db, auth, storage, rtdb;

// ── DATA CACHE (populated by Firestore listeners) ──────────────────
const cache = {
  users: [], posts: [], assignments: [], lyrics: [],
  videos: [], events: [], audioTracks: [], activityLog: [],
  settings: {}, loaded: {}
};

// ── FIREBASE INIT ──────────────────────────────────────────────────
function initFirebase() {
  if (!firebaseConfig || firebaseConfig.apiKey === 'YOUR_API_KEY') {
    console.warn('Firebase not configured — running in demo mode');
    return false;
  }
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  db      = firebase.firestore();
  auth    = firebase.auth();
  storage = firebase.storage();
  rtdb    = firebase.database();
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
  return true;
}

const FIREBASE_READY = initFirebase();

// ── REALTIME LISTENERS ─────────────────────────────────────────────
function setupListeners() {
  const toDate = v => v?.toDate ? v.toDate().toISOString() : (v || new Date().toISOString());

  db.collection('users').onSnapshot(snap => {
    cache.users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    cache.loaded.users = true;
    _notify('users');
  });

  db.collection('posts').orderBy('createdAt', 'desc').onSnapshot(snap => {
    cache.posts = snap.docs.map(d => {
      const data = d.data();
      return { id: d.id, ...data, createdAt: toDate(data.createdAt) };
    }).sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
    cache.loaded.posts = true;
    _notify('posts');
  });

  db.collection('assignments').onSnapshot(snap => {
    cache.assignments = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.dueDate || '') > (b.dueDate || '') ? 1 : -1);
    cache.loaded.assignments = true;
    _notify('assignments');
  });

  db.collection('lyrics').orderBy('uploadedAt', 'desc').onSnapshot(snap => {
    cache.lyrics = snap.docs.map(d => ({ id: d.id, ...d.data(), uploadedAt: toDate(d.data().uploadedAt) }));
    cache.loaded.lyrics = true;
    _notify('lyrics');
  });

  db.collection('videos').orderBy('uploadedAt', 'desc').onSnapshot(snap => {
    cache.videos = snap.docs.map(d => ({ id: d.id, ...d.data(), uploadedAt: toDate(d.data().uploadedAt) }));
    cache.loaded.videos = true;
    _notify('videos');
  });

  db.collection('events').onSnapshot(snap => {
    cache.events = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.date || '') > (b.date || '') ? 1 : -1);
    cache.loaded.events = true;
    _notify('events');
  });

  db.collection('audioTracks').orderBy('uploadedAt', 'desc').onSnapshot(snap => {
    cache.audioTracks = snap.docs.map(d => ({ id: d.id, ...d.data(), uploadedAt: toDate(d.data().uploadedAt) }));
    cache.loaded.audioTracks = true;
    _notify('audioTracks');
  });

  db.collection('settings').doc('main').onSnapshot(doc => {
    cache.settings = doc.exists ? doc.data() : {};
    cache.loaded.settings = true;
    _notify('settings');
  });

  db.collection('activityLog').orderBy('timestamp', 'desc').limit(100).onSnapshot(snap => {
    cache.activityLog = snap.docs.map(d => ({ id: d.id, ...d.data(), timestamp: toDate(d.data().timestamp) }));
    cache.loaded.activityLog = true;
    _notify('activityLog');
  });
}

function _notify(col) {
  if (window.onAnchorDataUpdate) window.onAnchorDataUpdate(col);
}

// ── CLOUDINARY UPLOAD (no Firebase Storage needed) ─────────────────
const CLOUDINARY_CLOUD = 'dtt5ie1ax';
const CLOUDINARY_PRESET = 'hiiiiiiiii';

async function uploadFile(file, path, onProgress) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CLOUDINARY_PRESET);
  formData.append('folder', 'anchor/' + path);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/auto/upload`);
    if (onProgress) xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total * 100); };
    xhr.onload = () => {
      const res = JSON.parse(xhr.responseText);
      if (xhr.status === 200) resolve(res.secure_url);
      else reject(new Error(res.error?.message || 'Upload failed'));
    };
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(formData);
  });
}

// ── AUTH & SECURITY ────────────────────────────────────────────────
function _toEmail(username) { return username.trim().toLowerCase() + '@anchor.internal'; }

// Local attempt tracking (lightweight firewall layer on top of Firebase Auth)
function _getAttempts() { try { return JSON.parse(sessionStorage.getItem('_attempts') || '{}'); } catch { return {}; } }
function _setAttempts(v) { sessionStorage.setItem('_attempts', JSON.stringify(v)); }

function checkFirewall() {
  const a = _getAttempts();
  if (a.lockedUntil && Date.now() < a.lockedUntil) {
    const secs = Math.ceil((a.lockedUntil - Date.now()) / 1000);
    return { blocked: true, remaining: secs };
  }
  if (a.lockedUntil && Date.now() >= a.lockedUntil) { _setAttempts({}); }
  return { blocked: false, count: a.count || 0 };
}

function recordAttempt(success) {
  if (success) { _setAttempts({}); return; }
  const s = getSettings();
  const max = s.maxLoginAttempts || 5;
  const mins = s.lockoutMinutes || 15;
  const a = _getAttempts();
  a.count = (a.count || 0) + 1;
  if (a.count >= max) a.lockedUntil = Date.now() + mins * 60 * 1000;
  _setAttempts(a);
}

async function login(username, password) {
  const fw = checkFirewall();
  if (fw.blocked) return { success: false, error: `Too many failed attempts. Try again in ${fw.remaining}s.`, locked: true, remaining: fw.remaining };

  try {
    const cred = await auth.signInWithEmailAndPassword(_toEmail(username), password);
    recordAttempt(true);
    // Load user profile
    let userDoc = await db.collection('users').doc(cred.user.uid).get();
    // Auto-create Firestore doc if missing (Auth succeeded but doc wasn't saved)
    if (!userDoc.exists) {
      const isOwner = username === (OWNER_USERNAME || 'admin').toLowerCase();
      const newData = {
        username, displayName: username, role: isOwner ? 'owner' : 'member',
        approved: true, joinDate: new Date().toISOString(),
        profilePic: null, bio: '', positions: [], email: ''
      };
      await db.collection('users').doc(cred.user.uid).set(newData);
      if (isOwner) await ensureSettings();
      userDoc = { exists: true, data: () => newData };
    }
    const userData = userDoc.data();
    if (!userData.approved) {
      await auth.signOut();
      return { success: false, error: 'Your account is pending approval.' };
    }
    logActivity(cred.user.uid, `${userData.displayName} logged in`);
    return { success: true, user: { id: cred.user.uid, ...userData } };
  } catch (err) {
    recordAttempt(false);
    const fw2 = _getAttempts();
    const max = getSettings().maxLoginAttempts || 5;
    const left = max - (fw2.count || 0);
    if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
      return { success: false, error: `Invalid username or password. ${Math.max(0,left)} attempt(s) remaining.` };
    }
    return { success: false, error: err.message };
  }
}

async function logout() {
  const u = getCurrentUser();
  if (u) logActivity(u.id, `${u.displayName} logged out`);
  await auth.signOut();
  window.location.href = 'index.html';
}

function checkSession() { return !!auth?.currentUser; }

function requireAuth(ownerOnly) {
  if (!auth?.currentUser) { window.location.href = 'index.html'; return false; }
  if (ownerOnly) {
    const u = getCurrentUser();
    if (!u || u.role !== 'owner') { window.location.href = 'dashboard.html'; return false; }
  }
  return true;
}

function getCurrentUser() {
  if (!auth?.currentUser) return null;
  return cache.users.find(u => u.id === auth.currentUser.uid) || null;
}

// ── REGISTRATION ───────────────────────────────────────────────────
async function register(username, password, displayName) {
  username = username.trim().toLowerCase();
  displayName = displayName.trim();
  if (!username || !password || !displayName) return { success: false, error: 'All fields are required.' };
  if (username.length < 3) return { success: false, error: 'Username must be at least 3 characters.' };
  if (password.length < 6) return { success: false, error: 'Password must be at least 6 characters.' };

  // Check username taken
  const existing = await db.collection('users').where('username', '==', username).get();
  if (!existing.empty) return { success: false, error: 'Username already taken.' };

  try {
    const cred = await auth.createUserWithEmailAndPassword(_toEmail(username), password);
    const s = getSettings();
    const isOwner = username === (OWNER_USERNAME || 'admin').toLowerCase();
    const approved = isOwner || !s.requireApproval;
    const userData = {
      username, displayName, role: isOwner ? 'owner' : 'member',
      approved, joinDate: new Date().toISOString(),
      profilePic: null, bio: '', positions: [], email: ''
    };
    await db.collection('users').doc(cred.user.uid).set(userData);
    // Init settings if owner
    if (isOwner) await ensureSettings();
    logActivity(cred.user.uid, `New registration: ${displayName}`);
    return { success: true, pending: !approved };
  } catch (err) {
    if (err.code === 'auth/email-already-in-use') return { success: false, error: 'Username already taken.' };
    return { success: false, error: err.message };
  }
}

async function ensureSettings() {
  const doc = await db.collection('settings').doc('main').get();
  if (!doc.exists) {
    await db.collection('settings').doc('main').set({
      groupName: 'ANCHOR', tagline: 'Rising from the Depths',
      description: 'ANCHOR — a global girl group making waves.',
      banner: null, allowMemberPosts: true, requireApproval: false,
      maxLoginAttempts: 5, lockoutMinutes: 15,
      groupRules: '1. Be respectful to all members.\n2. Stay active and participate.\n3. Support each other always.\n4. All group matters stay private.'
    });
  }
}

// ── USER CRUD ──────────────────────────────────────────────────────
function getUsers() { return cache.users; }
function getUserById(id) { return cache.users.find(u => u.id === id) || null; }

async function updateUser(id, updates) {
  await db.collection('users').doc(id).update(updates);
  const idx = cache.users.findIndex(u => u.id === id);
  if (idx !== -1) cache.users[idx] = { ...cache.users[idx], ...updates };
}

async function deleteUser(id) {
  await db.collection('users').doc(id).delete();
  cache.users = cache.users.filter(u => u.id !== id);
}

// ── POSTS ──────────────────────────────────────────────────────────
function getPosts() { return cache.posts; }

async function createPost(authorId, title, content, type, imageUrl) {
  const post = { authorId, type: type || 'post', title: title || '', content, pinned: false, createdAt: firebase.firestore.FieldValue.serverTimestamp(), likes: [], comments: [], imageUrl: imageUrl || null };
  const ref = await db.collection('posts').add(post);
  const user = getUserById(authorId);
  logActivity(authorId, `${user?.displayName} created a ${type || 'post'}`);
  return { id: ref.id, ...post };
}

async function deletePost(id) { await db.collection('posts').doc(id).delete(); }

async function togglePin(id) {
  const post = cache.posts.find(p => p.id === id);
  if (!post) return;
  await db.collection('posts').doc(id).update({ pinned: !post.pinned });
}

async function toggleLike(postId, userId) {
  const post = cache.posts.find(p => p.id === postId);
  if (!post) return 0;
  const likes = post.likes || [];
  const idx = likes.indexOf(userId);
  const newLikes = idx === -1 ? [...likes, userId] : likes.filter(l => l !== userId);
  await db.collection('posts').doc(postId).update({ likes: newLikes });
  post.likes = newLikes;
  return newLikes.length;
}

async function addComment(postId, userId, text) {
  const post = cache.posts.find(p => p.id === postId);
  if (!post) return;
  const user = getUserById(userId);
  const comment = { id: 'c' + Date.now(), userId, author: user?.displayName || 'Unknown', text: sanitize(text), createdAt: new Date().toISOString() };
  const comments = [...(post.comments || []), comment];
  await db.collection('posts').doc(postId).update({ comments });
  post.comments = comments;
  return comments;
}

// ── ASSIGNMENTS ────────────────────────────────────────────────────
function getAssignments() { return cache.assignments; }

async function createAssignment(createdBy, data) {
  const a = { createdBy, ...data, createdAt: firebase.firestore.FieldValue.serverTimestamp(), submissions: [] };
  const ref = await db.collection('assignments').add(a);
  const user = getUserById(createdBy);
  logActivity(createdBy, `${user?.displayName} created assignment: ${data.title}`);
  return { id: ref.id, ...a };
}

async function deleteAssignment(id) { await db.collection('assignments').doc(id).delete(); }

async function submitAssignment(assignmentId, userId, content) {
  const a = cache.assignments.find(x => x.id === assignmentId);
  if (!a) return false;
  const subs = [...(a.submissions || [])];
  const idx = subs.findIndex(s => s.userId === userId);
  const sub = { userId, content, submittedAt: new Date().toISOString(), status: 'submitted' };
  if (idx !== -1) subs[idx] = sub; else subs.push(sub);
  await db.collection('assignments').doc(assignmentId).update({ submissions: subs });
  const user = getUserById(userId);
  logActivity(userId, `${user?.displayName} submitted assignment: ${a.title}`);
  return true;
}

async function gradeSubmission(assignmentId, userId, grade, feedback) {
  const a = cache.assignments.find(x => x.id === assignmentId);
  if (!a) return;
  const subs = [...(a.submissions || [])];
  const sub = subs.find(s => s.userId === userId);
  if (sub) { sub.grade = grade; sub.feedback = feedback; sub.status = 'graded'; }
  await db.collection('assignments').doc(assignmentId).update({ submissions: subs });
}

// ── LYRICS ────────────────────────────────────────────────────────
function getLyrics() { return cache.lyrics; }

async function createLyrics(uploadedBy, data) {
  const l = { uploadedBy, ...data, uploadedAt: firebase.firestore.FieldValue.serverTimestamp() };
  const ref = await db.collection('lyrics').add(l);
  const user = getUserById(uploadedBy);
  logActivity(uploadedBy, `${user?.displayName} uploaded lyrics: ${data.songTitle}`);
  return { id: ref.id, ...l };
}

async function deleteLyrics(id) { await db.collection('lyrics').doc(id).delete(); }

// ── VIDEOS ────────────────────────────────────────────────────────
function getVideos() { return cache.videos; }

async function addVideo(uploadedBy, data) {
  const v = { uploadedBy, ...data, uploadedAt: firebase.firestore.FieldValue.serverTimestamp() };
  const ref = await db.collection('videos').add(v);
  const user = getUserById(uploadedBy);
  logActivity(uploadedBy, `${user?.displayName} added video: ${data.title}`);
  return { id: ref.id, ...v };
}

async function deleteVideo(id) { await db.collection('videos').doc(id).delete(); }

// ── EVENTS ────────────────────────────────────────────────────────
function getEvents() { return cache.events; }

async function createEvent(createdBy, data) {
  const e = { createdBy, ...data, createdAt: firebase.firestore.FieldValue.serverTimestamp() };
  const ref = await db.collection('events').add(e);
  const user = getUserById(createdBy);
  logActivity(createdBy, `${user?.displayName} created event: ${data.title}`);
  return { id: ref.id, ...e };
}

async function deleteEvent(id) { await db.collection('events').doc(id).delete(); }

// ── AUDIO ─────────────────────────────────────────────────────────
function getAudioTracks() { return cache.audioTracks; }

async function addAudioTrack(uploadedBy, file, meta, onProgress) {
  const storageUrl = await uploadFile(file, 'audio', onProgress);
  const track = {
    uploadedBy, title: meta.title, category: meta.category || 'Other',
    description: meta.description || '', fileName: file.name,
    fileSize: file.size, fileType: file.type, storageUrl,
    uploadedAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  const ref = await db.collection('audioTracks').add(track);
  const user = getUserById(uploadedBy);
  logActivity(uploadedBy, `${user?.displayName} uploaded audio: ${meta.title}`);
  return { id: ref.id, ...track };
}

async function deleteAudioTrack(id) {
  await db.collection('audioTracks').doc(id).delete();
}

// ── SETTINGS ──────────────────────────────────────────────────────
function getSettings() { return cache.settings || {}; }

async function saveSettings(updates) {
  await db.collection('settings').doc('main').set({ ...cache.settings, ...updates }, { merge: true });
  cache.settings = { ...cache.settings, ...updates };
}

// ── ACTIVITY LOG ──────────────────────────────────────────────────
function getActivityLog() { return cache.activityLog; }

function logActivity(userId, action) {
  if (!db) return;
  db.collection('activityLog').add({ userId, action, timestamp: firebase.firestore.FieldValue.serverTimestamp() })
    .then(() => {
      // Trim old logs
      db.collection('activityLog').orderBy('timestamp', 'desc').get().then(snap => {
        if (snap.size > 150) {
          const toDelete = snap.docs.slice(150);
          const batch = db.batch();
          toDelete.forEach(d => batch.delete(d.ref));
          batch.commit();
        }
      });
    }).catch(() => {});
}

// ── UTILITIES ──────────────────────────────────────────────────────
function sanitize(str) {
  if (typeof str !== 'string') return String(str || '');
  return str.replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' at ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
}

function initials(name) { return (name || '?').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase(); }

function getYouTubeId(url) {
  const m = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
  return m ? m[1] : null;
}

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function toast(msg, type = 'info') {
  let c = document.getElementById('toast-container');
  if (!c) { c = document.createElement('div'); c.id = 'toast-container'; document.body.appendChild(c); }
  const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span>${icons[type]||'ℹ'}</span><span>${msg}</span>`;
  c.appendChild(el);
  setTimeout(() => el.remove(), 3100);
}

// ── CONSTANTS ──────────────────────────────────────────────────────
const GROUP_POSITIONS = [
  'Leader','Co-Leader','Main Vocalist','Lead Vocalist','Vocalist',
  'Main Dancer','Lead Dancer','Dancer','Main Rapper','Lead Rapper',
  'Rapper','Center','Visual','Face of the Group','Maknae','Eldest',
  'Choreographer','Composer','Producer','Social Media Manager'
];
const VIDEO_CATEGORIES   = ['Practice','Performance','MV','Behind the Scenes','Vlog','Cover','Interview','Other'];
const EVENT_TYPES        = ['Practice','Performance','Meeting','Photoshoot','Recording','Fan Event','Other'];
const LYRIC_LANGUAGES    = ['Korean','English','Japanese','Chinese','Spanish','Other'];
const AUDIO_CATEGORIES   = ['Practice Track','Demo','Final Recording','Performance','Cover','Instrumental','Vocal Guide','Other'];

// ── WEBRTC CALL ENGINE ─────────────────────────────────────────────
const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80',             username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443',            username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ]
};

const callState = { active: false, roomId: null, localStream: null, pcs: {} };

async function _getMedia() {
  try { return await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); }
  catch {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      toast('Camera unavailable — audio only.', 'info');
      return s;
    } catch (e) { toast('Mic error: ' + e.message, 'error'); return null; }
  }
}

async function startCall() {
  if (!rtdb) { toast('Realtime Database not connected.', 'error'); return; }
  const stream = await _getMedia(); if (!stream) return;
  callState.localStream = stream;
  const roomId = 'room_' + Date.now();
  callState.roomId = roomId; callState.active = true;
  const me = getCurrentUser();
  await rtdb.ref(`calls/${roomId}/participants/${auth.currentUser.uid}`).set({ name: me?.displayName || 'Unknown', joinedAt: firebase.database.ServerValue.TIMESTAMP });
  await db.collection('activeCall').doc('current').set({ roomId, active: true, startedBy: auth.currentUser.uid, starterName: me?.displayName || 'Unknown', startedAt: firebase.firestore.FieldValue.serverTimestamp() });
  if (window.onCallStarted) window.onCallStarted(roomId, stream, true);
  _watchParticipants(roomId);
}

async function joinCall(roomId) {
  if (!rtdb) { toast('Realtime Database not connected.', 'error'); return; }
  const stream = await _getMedia(); if (!stream) return;
  callState.localStream = stream;
  callState.roomId = roomId; callState.active = true;
  const me = getCurrentUser();
  // Get existing participants BEFORE announcing (so we know who to initiate to)
  const snap = await rtdb.ref(`calls/${roomId}/participants`).once('value');
  const existing = [];
  snap.forEach(c => { if (c.key !== auth.currentUser.uid) existing.push(c.key); });
  // Join
  await rtdb.ref(`calls/${roomId}/participants/${auth.currentUser.uid}`).set({ name: me?.displayName || 'Unknown', joinedAt: firebase.database.ServerValue.TIMESTAMP });
  if (window.onCallStarted) window.onCallStarted(roomId, stream, false);
  // Initiate to all existing participants
  existing.forEach(uid => _initPeer(roomId, uid, true));
  _watchParticipants(roomId);
}

function _watchParticipants(roomId) {
  const myUid = auth.currentUser.uid;
  rtdb.ref(`calls/${roomId}/participants`).on('child_added', snap => {
    const uid = snap.key; if (uid === myUid || callState.pcs[uid]) return;
    // Someone joined after me — they'll initiate, I answer
    _initPeer(roomId, uid, false);
    if (window.onParticipantJoined) window.onParticipantJoined(uid, snap.val().name);
  });
  rtdb.ref(`calls/${roomId}/participants`).on('child_removed', snap => {
    const uid = snap.key;
    if (callState.pcs[uid]) { callState.pcs[uid].close(); delete callState.pcs[uid]; }
    if (window.onParticipantLeft) window.onParticipantLeft(uid);
  });
}

async function _initPeer(roomId, theirUid, iAmInitiator) {
  if (callState.pcs[theirUid]) return;
  const pc = new RTCPeerConnection(ICE_CONFIG);
  callState.pcs[theirUid] = pc;
  const myUid = auth.currentUser.uid;

  callState.localStream.getTracks().forEach(t => pc.addTrack(t, callState.localStream));

  pc.ontrack = e => {
    if (window.onRemoteStream) window.onRemoteStream(theirUid, e.streams[0]);
  };

  // Signal paths: initiator always writes offer, answerer writes answer
  // initiator = person who joined later (called _initPeer with iAmInitiator=true)
  const [initUid, ansUid] = iAmInitiator ? [myUid, theirUid] : [theirUid, myUid];
  const base = `calls/${roomId}/sig/${initUid}__${ansUid}`;

  if (iAmInitiator) {
    pc.onicecandidate = e => { if (e.candidate) rtdb.ref(`${base}/ice_init`).push(e.candidate.toJSON()); };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await rtdb.ref(`${base}/offer`).set({ sdp: offer.sdp, type: offer.type });
    // Wait for answer
    rtdb.ref(`${base}/answer`).on('value', async snap => {
      const a = snap.val();
      if (a && !pc.currentRemoteDescription) await pc.setRemoteDescription(new RTCSessionDescription(a)).catch(() => {});
    });
    rtdb.ref(`${base}/ice_ans`).on('child_added', async snap => { try { await pc.addIceCandidate(new RTCIceCandidate(snap.val())); } catch {} });

  } else {
    pc.onicecandidate = e => { if (e.candidate) rtdb.ref(`${base}/ice_ans`).push(e.candidate.toJSON()); };
    // Wait for offer then answer
    rtdb.ref(`${base}/offer`).on('value', async snap => {
      const o = snap.val();
      if (!o || pc.currentRemoteDescription || pc.signalingState !== 'stable') return;
      await pc.setRemoteDescription(new RTCSessionDescription(o));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await rtdb.ref(`${base}/answer`).set({ sdp: answer.sdp, type: answer.type });
    });
    rtdb.ref(`${base}/ice_init`).on('child_added', async snap => { try { await pc.addIceCandidate(new RTCIceCandidate(snap.val())); } catch {} });
  }
}

async function endCall() {
  if (!callState.active) return;
  Object.values(callState.pcs).forEach(pc => pc.close());
  callState.pcs = {};
  callState.localStream?.getTracks().forEach(t => t.stop());
  callState.localStream = null;
  if (callState.roomId) {
    await rtdb.ref(`calls/${callState.roomId}/participants/${auth.currentUser.uid}`).remove();
    const snap = await rtdb.ref(`calls/${callState.roomId}/participants`).once('value');
    if (!snap.hasChildren()) {
      await rtdb.ref(`calls/${callState.roomId}`).remove();
      await db.collection('activeCall').doc('current').set({ active: false });
    }
  }
  callState.active = false; callState.roomId = null;
  if (window.onCallEnded) window.onCallEnded();
}

function toggleMute() {
  const t = callState.localStream?.getAudioTracks()[0]; if (!t) return false;
  t.enabled = !t.enabled; return !t.enabled;
}

function toggleCamera() {
  const t = callState.localStream?.getVideoTracks()[0]; if (!t) return false;
  t.enabled = !t.enabled; return !t.enabled;
}

function watchActiveCall(callback) {
  if (!db) return;
  db.collection('activeCall').doc('current').onSnapshot(doc => { if (doc.exists) callback(doc.data()); });
}
