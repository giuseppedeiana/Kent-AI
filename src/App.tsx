import { useState, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import ReactMarkdown from 'react-markdown';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Search, 
  Link as LinkIcon, 
  Loader2, 
  CheckCircle2, 
  TrendingUp, 
  BarChart,
  Copy,
  History,
  Trash2,
  Pencil,
  Plus,
  Clock,
  LogOut,
  User as UserIcon,
  ShieldCheck,
  ArrowRight,
  X,
  Phone,
  Building2,
  Mail
} from 'lucide-react';

// Firebase imports
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User as FirebaseUser 
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  deleteDoc, 
  doc, 
  updateDoc, 
  query, 
  orderBy, 
  onSnapshot,
  setDoc,
  getDoc,
  getDocs,
  deleteField
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface HistoryItem {
  id: string;
  name: string;
  url: string;
  result: string;
  timestamp: number;
}

export default function App() {
  const adminEmail = 'giuseppedeiana.info@gmail.com';
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showLogin, setShowLogin] = useState(false);
  const [showInquiryModal, setShowInquiryModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(false);
  
  // Inquiry Form State
  const [inquiryForm, setInquiryForm] = useState({
    email: '',
    company: '',
    phone: ''
  });
  const [inquiryLoading, setInquiryLoading] = useState(false);
  const [inquirySuccess, setInquirySuccess] = useState(false);
  
  // Admin State
  const [view, setView] = useState<'app' | 'admin'>('app');
  const [authorizedEmails, setAuthorizedEmails] = useState<{id: string, email: string}[]>([]);
  const [allInquiries, setAllInquiries] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [adminLoading, setAdminLoading] = useState(false);

  // Handle Authentication
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      
      if (user) {
        const isUserAdmin = user.email === adminEmail;
        setIsAdmin(isUserAdmin);

        // Check if authorized
        if (isUserAdmin) {
          setIsAuthorized(true);
        } else {
          const authRef = doc(db, 'authorized_emails', user.email!);
          const authSnap = await getDoc(authRef);
          setIsAuthorized(authSnap.exists());
        }

        // Ensure user document exists
        const userRef = doc(db, 'users', user.uid);
        try {
          await setDoc(userRef, {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
            updatedAt: new Date().toISOString()
          }, { merge: true });
        } catch (e) {
          console.error("Failed to sync user profile", e);
        }
      } else {
        setIsAdmin(false);
        setIsAuthorized(false);
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Admin Data Sync
  useEffect(() => {
    if (!isAdmin || view !== 'admin') return;

    // Sync Authorized Emails
    const emailsRef = collection(db, 'authorized_emails');
    const unsubEmails = onSnapshot(emailsRef, (snap) => {
      setAuthorizedEmails(snap.docs.map(doc => ({ id: doc.id, email: doc.data().email })));
    });

    // Sync All Users
    const usersRef = collection(db, 'users');
    const unsubUsers = onSnapshot(usersRef, (snap) => {
      setAllUsers(snap.docs.map(doc => doc.data()));
    });

    // Sync Inquiries
    const inquiriesRef = collection(db, 'inquiries');
    const unsubInquiries = onSnapshot(query(inquiriesRef, orderBy('timestamp', 'desc')), (snap) => {
      setAllInquiries(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => {
      unsubEmails();
      unsubUsers();
      unsubInquiries();
    };
  }, [isAdmin, view]);

  // Sync History from Firestore
  useEffect(() => {
    if (!user) {
      setHistory([]);
      return;
    }

    const historyRef = collection(db, 'users', user.uid, 'history');
    const q = query(historyRef, orderBy('timestamp', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items: HistoryItem[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as HistoryItem[];
      setHistory(items);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, `users/${user.uid}/history`);
    });

    return () => unsubscribe();
  }, [user]);

  const login = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      console.error("Login failed", e);
    }
  };

  const logout = () => signOut(auth);

  const handleAnalyze = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!url || !user) return;

    setLoading(true);
    setError('');
    setResult('');
    setCopied(false);

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: `I have an Amazon product link: ${url}. 
        Please act as an expert Amazon SEO, COSMO, and Rufus optimization specialist. 
        Analyze this product and provide a highly optimized, search-intent-based listing strategy to improve organic ranking and sales velocity.
        
        CRITICAL COMPLIANCE RULES:
        - The content MUST be 100% compliant and claim-free.
        - Strictly avoid risky keywords, subjective claims (e.g., "best", "guaranteed", "number one"), and medical/health claims (e.g., "cures", "treats", "prevents").
        - Keep all suggestions factual, objective, and safe for Amazon's strict policies.
        
        Please include:
        1. **Title Optimization**: A search-friendly title optimized for traditional SEO, COSMO (contextual relevance), and Rufus (conversational queries).
        2. **Bullet Points (Rufus & COSMO Optimized)**: 5 key feature bullets structured for maximum conversion. Focus on user intent, practical benefits, and conversational readability.
        3. **Product Description**: A highly engaging, SEO-rich, and compliant product description that expands on the bullet points, tells the brand/product story, and captures long-tail conversational queries for Rufus.
        4. **Keyword & Intent Strategy**: High-intent backend search terms, long-tail keywords, and specific user intents (e.g., "gifts for...", "how to solve...") to target for COSMO/Rufus.
        5. **Competitor Differentiation**: Practical, compliant ways to stand out from similar products without bashing competitors or making unverified claims.
        
        Format the output clearly using Markdown with distinct headers (##) for each section. Keep the tone objective, practical, and heavily focused on realistic, compliant e-commerce strategies.`,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      if (response.text) {
        const text = response.text;
        setResult(text);
        
        // Save to Firestore
        const historyRef = collection(db, 'users', user.uid, 'history');
        const itemName = new URL(url).pathname.split('/').pop() || 'Untitled Analysis';
        
        try {
          await addDoc(historyRef, {
            userId: user.uid,
            name: itemName,
            url: url,
            result: text,
            timestamp: Date.now()
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `users/${user.uid}/history`);
        }
      } else {
        setError('Failed to analyze the listing. Please try again.');
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred while analyzing the link.');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const deleteHistoryItem = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;
    
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'history', id));
      if (result && history.find(item => item.id === id)?.result === result) {
        setResult('');
        setUrl('');
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${user.uid}/history/${id}`);
    }
  };

  const startRenaming = (item: HistoryItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(item.id);
    setEditName(item.name);
  };

  const saveRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId || !user) return;
    
    try {
      await updateDoc(doc(db, 'users', user.uid, 'history', editingId), {
        name: editName
      });
      setEditingId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}/history/${editingId}`);
    }
  };

  const selectHistoryItem = (item: HistoryItem) => {
    setUrl(item.url);
    setResult(item.result);
    setError('');
  };

  const clearCurrent = () => {
    setUrl('');
    setResult('');
    setError('');
  };

  const filteredHistory = history.filter(item => 
    item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.url.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const addAuthorizedEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail || !isAdmin) return;
    setAdminLoading(true);
    try {
      await setDoc(doc(db, 'authorized_emails', newEmail.toLowerCase()), {
        email: newEmail.toLowerCase(),
        addedAt: new Date().toISOString()
      });
      setNewEmail('');
    } catch (err) {
      console.error("Failed to add email", err);
    } finally {
      setAdminLoading(false);
    }
  };

  const handleInquirySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setInquiryLoading(true);
    try {
      // 1. Save to Firestore for the dashboard
      await addDoc(collection(db, 'inquiries'), {
        ...inquiryForm,
        timestamp: new Date().toISOString()
      });

      // 2. Trigger email notification via server API
      await fetch('/api/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inquiryForm)
      });

      setInquirySuccess(true);
      setTimeout(() => {
        setShowInquiryModal(false);
        setInquirySuccess(false);
        setInquiryForm({ email: '', company: '', phone: '' });
      }, 3000);
    } catch (err) {
      console.error("Inquiry failed", err);
    } finally {
      setInquiryLoading(false);
    }
  };

  const deleteInquiry = async (id: string) => {
    if (!isAdmin) return;
    try {
      await deleteDoc(doc(db, 'inquiries', id));
    } catch (err) {
      console.error("Failed to delete inquiry", err);
    }
  };

  const removeAuthorizedEmail = async (email: string) => {
    if (!isAdmin) return;
    try {
      await deleteDoc(doc(db, 'authorized_emails', email));
    } catch (err) {
      console.error("Failed to remove email", err);
    }
  };

  const deleteUserAccount = async (userId: string) => {
    if (!isAdmin) return;
    if (window.confirm("Are you sure you want to delete this user's data? This cannot be undone.")) {
      try {
        await deleteDoc(doc(db, 'users', userId));
        // Note: This only deletes their profile/data, not the Auth account
        // Admin would need Firebase Admin SDK to delete the actual Auth account
      } catch (err) {
        console.error("Failed to delete user data", err);
      }
    }
  };

  if (authLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (user && !isAuthorized) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white p-8 rounded-3xl shadow-xl border border-slate-200 max-w-md w-full text-center"
        >
          <div className="bg-amber-100 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <ShieldCheck className="w-8 h-8 text-amber-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Restricted Access</h1>
          <p className="text-slate-500 mb-8 leading-relaxed">
            Your account ({user.email}) is not authorized to use Kentai. Please contact the administrator to gain access.
          </p>
          <button
            onClick={logout}
            className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-3 px-6 rounded-xl transition-all"
          >
            Sign Out
          </button>
        </motion.div>
      </div>
    );
  }

  if (!user) {
    if (showLogin) {
      return (
        <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
          <button 
            onClick={() => setShowLogin(false)}
            className="absolute top-8 left-8 flex items-center gap-2 text-slate-500 hover:text-indigo-600 font-bold transition-colors"
          >
            <ArrowRight className="w-4 h-4 rotate-180" />
            Back to Home
          </button>
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white p-8 rounded-3xl shadow-xl border border-slate-200 max-w-md w-full text-center"
          >
            <div className="bg-indigo-600 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-indigo-200 shadow-lg">
              <BarChart className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Kentai Pro</h1>
            <p className="text-slate-500 mb-8 leading-relaxed">
              This is Private Access. Please enter your invitation password to continue.
            </p>

            {!isUnlocked ? (
              <div className="space-y-4">
                <input 
                  type="password"
                  placeholder="Enter Password..."
                  value={passwordInput}
                  onChange={(e) => {
                    setPasswordInput(e.target.value);
                    if (e.target.value === 'Ask-Kent!') {
                      setIsUnlocked(true);
                    }
                  }}
                  className="w-full px-6 py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-indigo-500 outline-none font-bold text-center tracking-[0.2em] transition-all"
                />
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  Invite Only Access
                </p>
              </div>
            ) : (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4"
              >
                <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100 flex items-center justify-center gap-2 text-emerald-600 text-sm font-bold mb-4">
                  <CheckCircle2 className="w-4 h-4" />
                  Access Granted
                </div>
                <button
                  onClick={login}
                  className="w-full flex items-center justify-center gap-3 bg-white hover:bg-indigo-600 hover:text-white text-slate-700 font-bold py-4 px-6 border-2 border-slate-100 hover:border-indigo-600 rounded-2xl transition-all hover:shadow-lg active:scale-[0.98]"
                >
                  <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5 bg-white p-0.5 rounded-full" />
                  Sign in with Google
                </button>
              </motion.div>
            )}

            <div className="mt-8 flex items-center justify-center gap-2 text-xs text-slate-400 font-medium uppercase tracking-wider">
              <ShieldCheck className="w-4 h-4" />
              Secure & Private
            </div>
          </motion.div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-white text-slate-900 selection:bg-indigo-50">
        {/* Navigation */}
        <nav className="max-w-7xl mx-auto px-6 py-8 flex justify-between items-center sticky top-0 bg-white/80 backdrop-blur-md z-50">
          <div className="flex items-center gap-2.5">
            <div className="bg-indigo-600 p-2 rounded-xl shadow-lg shadow-indigo-100">
              <BarChart className="w-6 h-6 text-white" />
            </div>
            <span className="text-2xl font-black text-slate-900 tracking-tight">Kentai Pro</span>
          </div>
          <div className="flex items-center gap-8">
            <button 
              onClick={() => setShowLogin(true)} 
              className="hidden sm:block text-[15px] font-bold text-slate-600 hover:text-indigo-600 transition-colors"
            >
              Log in
            </button>
            <button 
              onClick={() => setShowInquiryModal(true)}
              className="bg-slate-900 text-white px-6 py-3 rounded-xl font-bold text-[15px] hover:bg-indigo-600 transition-all shadow-lg active:scale-95"
            >
              Get Started
            </button>
          </div>
        </nav>

        {/* Hero Section */}
        <header className="max-w-7xl mx-auto px-6 py-16 md:py-32 text-center lg:text-left grid lg:grid-cols-2 gap-16 items-center">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-indigo-50 border border-indigo-100 text-indigo-600 rounded-full text-sm font-extrabold uppercase tracking-widest mb-8">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-600"></span>
              </span>
              Engineered for Rufus & COSMO
            </div>
            <h1 className="text-6xl md:text-8xl font-black text-slate-900 leading-[0.9] tracking-tight mb-8">
              Sell More with <br/> <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-indigo-400">Contextual</span> AI.
            </h1>
            <p className="text-xl text-slate-500 max-w-xl leading-relaxed mb-12">
              The first Amazon optimization tool built for the age of conversational search. Dominate Rufus and COSMO with intent-driven listings.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <button 
                onClick={() => setShowInquiryModal(true)}
                className="bg-indigo-600 text-white px-10 py-5 rounded-[1.5rem] font-black text-lg hover:bg-indigo-700 transition-all shadow-2xl shadow-indigo-100 flex items-center justify-center gap-3 group"
              >
                Join for Private Access <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
              <div className="flex items-center gap-4 px-6 py-5 border-2 border-slate-50 rounded-[1.5rem]">
                <div className="flex -space-x-3">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="w-10 h-10 rounded-full border-4 border-white bg-slate-100 overflow-hidden">
                      <img src={`https://i.pravatar.cc/100?img=${i+10}`} alt="user" className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
                <div className="text-left">
                  <div className="flex gap-0.5 text-amber-400">
                    {[1, 2, 3, 4, 5].map(i => <Plus key={i} className="w-3 h-3 fill-current" />)}
                  </div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">100+ Trusted Sellers</p>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Visual Element */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="relative"
          >
            <div className="bg-indigo-600 p-8 rounded-[3rem] shadow-2xl shadow-indigo-200 transform rotate-3 hover:rotate-0 transition-transform duration-700">
               <div className="bg-white rounded-[2rem] p-6 space-y-6">
                 <div className="flex items-center gap-4 border-b border-slate-50 pb-6">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center">
                      <Search className="w-6 h-6 text-indigo-600" />
                    </div>
                    <div>
                      <h4 className="font-extrabold text-slate-900">Analysis Pipeline</h4>
                      <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Real-time processing</p>
                    </div>
                 </div>
                 <div className="space-y-3">
                    <div className="h-4 bg-slate-50 rounded-full w-[80%]" />
                    <div className="h-4 bg-indigo-50 rounded-full w-[100%]" />
                    <div className="h-4 bg-slate-50 rounded-full w-[60%]" />
                 </div>
                 <div className="pt-6">
                    <div className="flex items-center justify-between mb-2">
                       <span className="text-sm font-bold text-slate-600">COSMO Integrity</span>
                       <span className="text-sm font-black text-emerald-500 underline">98% OPTIMIZED</span>
                    </div>
                 </div>
               </div>
            </div>
            <div className="absolute -bottom-10 -right-10 bg-white p-6 rounded-3xl shadow-xl border border-slate-100 max-w-[200px] hidden md:block">
              <TrendingUp className="w-10 h-10 text-emerald-500 mb-4" />
              <p className="text-sm font-bold text-slate-900 leading-tight">Average 32% increase in CTR</p>
            </div>
          </motion.div>
        </header>

        {/* Features Split */}
        <section className="bg-slate-50 py-32">
          <div className="max-w-7xl mx-auto px-6">
            <div className="text-center mb-20">
               <h2 className="text-4xl font-black text-slate-900 mb-4">Master the New Amazon</h2>
               <p className="text-slate-500 font-medium">Every tool you need to stay ahead of the Rufus rollout.</p>
            </div>
            <div className="grid md:grid-cols-3 gap-12">
              {[
                { 
                  icon: <CheckCircle2 className="w-8 h-8 text-indigo-600" />, 
                  title: "Rufus Readiness", 
                  desc: "Optimized for conversational AI queries to win the 'Recommended' badge."
                },
                { 
                  icon: <TrendingUp className="w-8 h-8 text-indigo-600" />, 
                  title: "COSMO Core", 
                  desc: "Context-aware listing generation that aligns with actual shopper intent."
                },
                { 
                  icon: <ShieldCheck className="w-8 h-8 text-indigo-600" />, 
                  title: "Claim Protection", 
                  desc: "Fully compliant listings. We filter medical and subjective claims automatically."
                }
              ].map((f, i) => (
                <div key={i} className="p-10 bg-white rounded-3xl border border-slate-100 hover:shadow-xl hover:-translate-y-2 transition-all duration-500">
                  <div className="mb-6">{f.icon}</div>
                  <h3 className="text-xl font-bold text-slate-900 mb-4">{f.title}</h3>
                  <p className="text-slate-500 leading-relaxed font-medium">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-slate-100 flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-2 grayscale hover:grayscale-0 transition-all opacity-50">
            <BarChart className="w-5 h-5" />
            <span className="text-sm font-black tracking-tight">Kentai Pro</span>
          </div>
          <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">© 2026 Developed by Sellers for Sellers</p>
          <div className="flex gap-6">
            <button onClick={() => setShowLogin(true)} className="text-sm font-bold text-slate-500 hover:underline underline-offset-4 decoration-indigo-500 decoration-2">Terms</button>
            <button onClick={() => setShowLogin(true)} className="text-sm font-bold text-slate-500 hover:underline underline-offset-4 decoration-indigo-500 decoration-2">Privacy</button>
          </div>
        </footer>

        {/* Inquiry Modal */}
        <AnimatePresence>
          {showInquiryModal && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowInquiryModal(false)}
                className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden"
              >
                <div className="p-8 sm:p-12">
                  <div className="flex justify-between items-start mb-8">
                    <div className="bg-indigo-600 p-3 rounded-2xl shadow-lg shadow-indigo-100">
                      <BarChart className="w-6 h-6 text-white" />
                    </div>
                    <button 
                      onClick={() => setShowInquiryModal(false)}
                      className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 transition-colors"
                    >
                      <X className="w-6 h-6" />
                    </button>
                  </div>

                  {inquirySuccess ? (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="text-center py-12"
                    >
                      <div className="w-20 h-20 bg-emerald-100 rounded-3xl flex items-center justify-center mx-auto mb-6">
                        <CheckCircle2 className="w-10 h-10 text-emerald-600" />
                      </div>
                      <h3 className="text-3xl font-black text-slate-900 mb-4">Request Sent!</h3>
                      <p className="text-slate-500 font-medium">We've received your inquiry. One of our experts will contact you shortly.</p>
                    </motion.div>
                  ) : (
                    <>
                      <h2 className="text-4xl font-black text-slate-900 mb-2 tracking-tight">Get Started</h2>
                      <p className="text-slate-500 font-medium mb-10 leading-relaxed">
                        Complete the form below to request Private Access to Kentai Pro.
                      </p>

                      <form onSubmit={handleInquirySubmit} className="space-y-4">
                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1">Business Email</label>
                          <div className="relative">
                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                            <input 
                              required
                              type="email"
                              value={inquiryForm.email}
                              onChange={e => setInquiryForm({...inquiryForm, email: e.target.value})}
                              placeholder="name@company.com"
                              className="w-full pl-12 pr-6 py-4 bg-slate-50 border-2 border-transparent rounded-2xl focus:border-indigo-500 focus:bg-white transition-all outline-none font-semibold text-slate-900"
                            />
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1">Company / Full Name</label>
                          <div className="relative">
                            <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                            <input 
                              required
                              type="text"
                              value={inquiryForm.company}
                              onChange={e => setInquiryForm({...inquiryForm, company: e.target.value})}
                              placeholder="Acme Inc."
                              className="w-full pl-12 pr-6 py-4 bg-slate-50 border-2 border-transparent rounded-2xl focus:border-indigo-500 focus:bg-white transition-all outline-none font-semibold text-slate-900"
                            />
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1">Telephone Number</label>
                          <div className="relative">
                            <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                            <input 
                              required
                              type="tel"
                              value={inquiryForm.phone}
                              onChange={e => setInquiryForm({...inquiryForm, phone: e.target.value})}
                              placeholder="+1 (555) 000-0000"
                              className="w-full pl-12 pr-6 py-4 bg-slate-50 border-2 border-transparent rounded-2xl focus:border-indigo-500 focus:bg-white transition-all outline-none font-semibold text-slate-900"
                            />
                          </div>
                        </div>

                        <button 
                          disabled={inquiryLoading}
                          type="submit"
                          className="w-full bg-slate-900 hover:bg-indigo-600 text-white font-black py-5 rounded-2xl transition-all shadow-xl shadow-slate-200 mt-6 flex items-center justify-center gap-3 disabled:opacity-50"
                        >
                          {inquiryLoading ? (
                            <Loader2 className="w-6 h-6 animate-spin" />
                          ) : (
                            <>Submit Request <ArrowRight className="w-5 h-5" /></>
                          )}
                        </button>
                      </form>
                    </>
                  )}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans selection:bg-indigo-100 selection:text-indigo-900 overflow-hidden">
      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ width: sidebarOpen ? 300 : 0, opacity: sidebarOpen ? 1 : 0 }}
        className="bg-white border-r border-slate-200 flex-shrink-0 flex flex-col relative z-20 shadow-xl sm:shadow-none overflow-hidden"
      >
        <div className="p-4 border-b border-slate-200 flex items-center justify-between min-w-[300px]">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-indigo-600" />
            <h2 className="font-semibold text-slate-800">History</h2>
          </div>
          <button 
            onClick={() => {
              setView('app');
              clearCurrent();
            }}
            className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors"
            title="New Analysis"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>

        {view === 'admin' ? (
          <div className="flex-1 flex flex-col min-w-[300px]">
             <div className="p-4 bg-indigo-50 border-b border-indigo-100">
                <p className="text-xs font-bold text-indigo-600 uppercase tracking-widest">Admin Control Panel</p>
             </div>
             <div className="flex-1 overflow-y-auto p-4 space-y-4">
               <div>
                  <h3 className="text-sm font-bold text-slate-900 mb-2">Platform Users</h3>
                  <div className="space-y-2">
                    {allUsers.map(u => (
                      <div key={u.uid} className="bg-slate-50 p-2 rounded-xl text-[11px] flex items-center justify-between">
                         <span className="truncate pr-2">{u.email}</span>
                         <button 
                          onClick={() => deleteUserAccount(u.uid)}
                          className="text-red-500 hover:text-red-700"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
               </div>

               <div>
                  <h3 className="text-sm font-bold text-slate-900 mb-2">Inquiries</h3>
                  <div className="space-y-2">
                    {allInquiries.map(i => (
                      <div key={i.id} className="bg-slate-50 p-3 rounded-xl text-[10px] space-y-1 border border-slate-100">
                         <div className="flex justify-between items-start">
                           <span className="font-bold text-slate-900">{i.company}</span>
                           <button 
                            onClick={() => deleteInquiry(i.id)}
                            className="text-slate-300 hover:text-red-500"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                         </div>
                         <div className="flex items-center gap-2 text-slate-500">
                           <Mail className="w-2.5 h-2.5" /> {i.email}
                         </div>
                         <div className="flex items-center gap-2 text-slate-500">
                           <Phone className="w-2.5 h-2.5" /> {i.phone}
                         </div>
                      </div>
                    ))}
                  </div>
               </div>
             </div>
          </div>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-slate-100 min-w-[300px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                  type="text"
                  placeholder="Search history..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto min-w-[300px] p-3 space-y-1">
              {filteredHistory.length === 0 ? (
                <div className="p-12 text-center text-slate-400 text-sm">
                  <Clock className="w-10 h-10 mx-auto mb-3 opacity-20 text-indigo-600" />
                  <p className="font-medium">{searchQuery ? 'No results found' : 'No history yet'}</p>
                </div>
              ) : (
                filteredHistory.map((item) => (
                  <div 
                    key={item.id}
                    onClick={() => selectHistoryItem(item)}
                    className={`group p-3 rounded-2xl cursor-pointer transition-all border border-transparent ${result === item.result ? 'bg-indigo-50 border-indigo-100 shadow-sm' : 'hover:bg-slate-50'}`}
                  >
                    {editingId === item.id ? (
                      <form onSubmit={saveRename} className="flex gap-1" onClick={e => e.stopPropagation()}>
                        <input 
                          autoFocus
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          onBlur={() => setEditingId(null)}
                          className="flex-1 px-3 py-1 text-sm border border-indigo-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </form>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">{item.name}</p>
                          <p className="text-[11px] text-slate-400 mt-0.5">{new Date(item.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button 
                            onClick={(e) => startRenaming(item, e)}
                            className="p-1.5 hover:bg-white rounded-lg hover:text-indigo-600 text-slate-400 transition-all shadow-sm"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            onClick={(e) => deleteHistoryItem(item.id, e)}
                            className="p-1.5 hover:bg-white rounded-lg hover:text-red-500 text-slate-400 transition-all shadow-sm"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}

        <div className="p-4 border-t border-slate-200 min-w-[300px]">
          {isAdmin && (
            <button 
              onClick={() => setView(view === 'admin' ? 'app' : 'admin')}
              className={`w-full flex items-center justify-center gap-2 mb-3 py-2 px-4 rounded-xl text-xs font-bold transition-all ${view === 'admin' ? 'bg-indigo-600 text-white' : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'}`}
            >
              <ShieldCheck className="w-4 h-4" />
              {view === 'admin' ? 'Exit Admin Dashboard' : 'Open Admin Dashboard'}
            </button>
          )}
          <div className="flex items-center justify-between gap-3 bg-slate-50 p-2 rounded-2xl">
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center flex-shrink-0">
                {user.photoURL ? (
                  <img src={user.photoURL} alt={user.displayName || ''} className="w-full h-full rounded-xl object-cover" />
                ) : (
                  <UserIcon className="w-5 h-5 text-slate-400" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-900 truncate">{user.displayName || 'Seller'}</p>
                <p className="text-[10px] text-slate-400 truncate">{user.email}</p>
              </div>
            </div>
            <button 
              onClick={logout}
              className="p-2.5 hover:bg-white rounded-xl text-slate-400 hover:text-red-500 transition-all shadow-sm flex-shrink-0"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </motion.aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 relative h-full">
        <header className="bg-white border-b border-slate-200 h-16 flex items-center justify-between px-4 sm:px-8 flex-shrink-0">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className={`p-2.5 rounded-xl transition-all ${sidebarOpen ? 'bg-indigo-50 text-indigo-600 shadow-sm border border-indigo-100' : 'hover:bg-slate-50 text-slate-500 border border-transparent'}`}
              title={sidebarOpen ? "Close History" : "Open History"}
            >
              <History className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <div className="bg-indigo-600 p-1.5 rounded-xl shadow-lg shadow-indigo-100">
                <BarChart className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900 hidden sm:block">Kentai Pro</h1>
            </div>
          </div>
          
          <div className="flex items-center gap-6 text-[13px] font-bold uppercase tracking-wider text-slate-400">
            <div className="hidden md:flex items-center gap-2">
              <Search className="w-4 h-4 text-indigo-500" />
              <span>SEO Analysis</span>
            </div>
            <div className="hidden md:flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-500" />
              <span>Conversion Focus</span>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-8 lg:p-12">
          <div className="max-w-4xl mx-auto h-full">
            <AnimatePresence mode="wait">
              {view === 'admin' ? (
                <motion.div
                  key="admin"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-8"
                >
                  <div className="bg-white rounded-3xl shadow-xl shadow-slate-100 border border-slate-100 p-8">
                    <h2 className="text-3xl font-extrabold text-slate-900 mb-6 flex items-center gap-3">
                      <ShieldCheck className="w-8 h-8 text-indigo-600" />
                      Manage Authorized Clients
                    </h2>
                    
                    <form onSubmit={addAuthorizedEmail} className="flex gap-4 mb-8">
                      <input 
                        type="email"
                        required
                        placeholder="Client Google Email..."
                        value={newEmail}
                        onChange={e => setNewEmail(e.target.value)}
                        className="flex-1 px-6 py-4 bg-slate-50 border border-transparent rounded-2xl focus:ring-4 focus:ring-indigo-100 focus:bg-white outline-none font-medium shadow-inner"
                      />
                      <button 
                        disabled={adminLoading}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-8 py-4 rounded-2xl transition-all shadow-lg shadow-indigo-100 flex items-center gap-2"
                      >
                        {adminLoading ? <Loader2 className="animate-spin w-5 h-5" /> : <Plus className="w-5 h-5" />}
                        Authorize Email
                      </button>
                    </form>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {authorizedEmails.map(item => (
                        <div key={item.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                           <div className="flex items-center gap-3">
                             <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                               <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                             </div>
                             <span className="font-semibold text-slate-700">{item.email}</span>
                           </div>
                           <button 
                            onClick={() => removeAuthorizedEmail(item.id)}
                            className="p-2 hover:bg-red-50 rounded-xl text-slate-400 hover:text-red-500 transition-all"
                           >
                             <Trash2 className="w-4 h-4" />
                           </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-white rounded-3xl shadow-xl shadow-slate-100 border border-slate-100 p-8">
                     <h3 className="text-xl font-bold text-slate-900 mb-6">User Database ({allUsers.length})</h3>
                     <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead>
                            <tr className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100">
                              <th className="pb-4">User</th>
                              <th className="pb-4">Email</th>
                              <th className="pb-4">Last Sync</th>
                              <th className="pb-4">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {allUsers.map(u => (
                              <tr key={u.uid} className="group">
                                <td className="py-4">
                                  <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center overflow-hidden">
                                      {u.photoURL ? <img src={u.photoURL} className="w-full h-full object-cover" /> : <UserIcon className="w-4 h-4 text-slate-400" />}
                                    </div>
                                    <span className="font-semibold text-slate-700">{u.displayName || 'Seller'}</span>
                                  </div>
                                </td>
                                <td className="py-4 text-sm text-slate-500">{u.email}</td>
                                <td className="py-4 text-sm text-slate-400">{u.updatedAt ? new Date(u.updatedAt).toLocaleDateString() : 'N/A'}</td>
                                <td className="py-4">
                                   <button 
                                    onClick={() => deleteUserAccount(u.uid)}
                                    className="p-2 hover:bg-red-50 rounded-lg text-slate-300 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100"
                                   >
                                     <Trash2 className="w-4 h-4" />
                                   </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                     </div>
                  </div>

                  <div className="bg-white rounded-3xl shadow-xl shadow-slate-100 border border-slate-100 p-8">
                     <h3 className="text-xl font-bold text-slate-900 mb-6">Recent Inquiries ({allInquiries.length})</h3>
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {allInquiries.map(i => (
                          <div key={i.id} className="p-6 bg-slate-50 rounded-2xl border border-slate-100 group relative">
                             <div className="flex items-start justify-between mb-4">
                                <div>
                                   <h4 className="font-bold text-slate-900">{i.company}</h4>
                                   <p className="text-xs text-slate-400">{new Date(i.timestamp).toLocaleString()}</p>
                                </div>
                                <button 
                                  onClick={() => deleteInquiry(i.id)}
                                  className="p-2 hover:bg-red-50 rounded-xl text-slate-300 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                             </div>
                             <div className="space-y-2">
                                <div className="flex items-center gap-3 text-sm text-slate-600">
                                   <Mail className="w-4 h-4 text-indigo-400" />
                                   {i.email}
                                </div>
                                <div className="flex items-center gap-3 text-sm text-slate-600">
                                   <Phone className="w-4 h-4 text-indigo-400" />
                                   {i.phone}
                                </div>
                             </div>
                             <button 
                              onClick={() => {
                                setNewEmail(i.email);
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }}
                              className="mt-4 w-full bg-white border border-slate-200 hover:border-indigo-600 hover:text-indigo-600 text-slate-500 py-2 rounded-xl text-xs font-bold transition-all"
                             >
                               Copy Email to Add
                             </button>
                          </div>
                        ))}
                     </div>
                  </div>
                </motion.div>
              ) : !result && !loading ? (
                <motion.div 
                  key="landing"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="flex flex-col items-center justify-center min-h-[70vh] text-center"
                >
                  <div className="mb-10 text-center relative">
                    <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-40 h-40 bg-indigo-50 rounded-full blur-3xl opacity-50 -z-10" />
                    <h2 className="text-5xl sm:text-6xl font-extrabold tracking-tight mb-6 text-slate-900 leading-tight">
                      Optimize your <br className="hidden sm:block" /> <span className="text-indigo-600">Inventory</span> AI
                    </h2>
                    <p className="text-lg text-slate-500 max-w-xl mx-auto leading-relaxed">
                      Transform your Amazon listings into high-converting sales machines with context-aware AI analysis.
                    </p>
                  </div>
                  
                  <div className="bg-white rounded-[2.5rem] shadow-2xl shadow-slate-100 border border-slate-100 p-3 sm:p-4 max-w-2xl w-full">
                    <form onSubmit={handleAnalyze} className="flex flex-col sm:flex-row gap-3">
                      <div className="relative flex-1">
                        <div className="absolute inset-y-0 left-0 pl-6 flex items-center pointer-events-none">
                          <LinkIcon className="h-5 w-5 text-indigo-400" />
                        </div>
                        <input
                          type="url"
                          required
                          value={url}
                          onChange={(e) => setUrl(e.target.value)}
                          placeholder="Paste Amazon product link..."
                          className="block w-full pl-14 pr-6 py-5 bg-slate-50 border border-transparent rounded-[2rem] text-slate-900 placeholder-slate-400 focus:ring-4 focus:ring-indigo-100 focus:bg-white focus:border-indigo-100 transition-all outline-none font-medium shadow-inner"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={loading || !url}
                        className="inline-flex items-center justify-center px-10 py-5 border border-transparent text-lg font-bold rounded-[2rem] text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xl shadow-indigo-100 transform active:scale-95"
                      >
                        <Search className="-ml-1 mr-3 h-5 w-5 stroke-[2.5]" />
                        Analyze
                      </button>
                    </form>
                  </div>
                  
                  <div className="mt-12 flex items-center gap-8 text-xs font-bold text-slate-400 uppercase tracking-widest leading-none">
                    <span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-indigo-500" /> Claim Free</span>
                    <span className="flex items-center gap-2"><Plus className="w-4 h-4 text-emerald-500" /> COSMO Optimized</span>
                    <span className="flex items-center gap-2"><History className="w-4 h-4 text-amber-500" /> Rufus Ready</span>
                  </div>
                </motion.div>
              ) : (
                <motion.div 
                  key="content"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-8"
                >
                  <div className="bg-white rounded-3xl shadow-xl shadow-slate-100 border border-slate-100 p-4 sm:p-5">
                    <div className="flex flex-col sm:flex-row gap-4 items-center">
                      <div className="relative flex-1 w-full">
                        <div className="absolute inset-y-0 left-0 pl-6 flex items-center pointer-events-none">
                          <LinkIcon className="h-5 w-5 text-indigo-400" />
                        </div>
                        <input
                          type="url"
                          required
                          value={url}
                          onChange={(e) => setUrl(e.target.value)}
                          className="block w-full pl-14 pr-6 py-4 bg-slate-50 border border-transparent rounded-2xl text-slate-900 focus:ring-4 focus:ring-indigo-100 focus:bg-white focus:border-indigo-100 transition-all outline-none font-medium shadow-inner"
                        />
                      </div>
                      <button
                        onClick={() => handleAnalyze()}
                        disabled={loading || !url}
                        className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-4 border border-transparent text-sm font-bold rounded-2xl text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-lg shadow-indigo-100 active:scale-95 flex-shrink-0"
                      >
                        {loading ? <Loader2 className="animate-spin h-5 w-5" /> : <Search className="h-5 w-5 mr-2" />}
                        {loading ? 'Analyzing...' : 'Re-analyze'}
                      </button>
                    </div>
                    {error && <p className="mt-3 text-sm font-medium text-red-500 px-3 flex items-center gap-2"><Trash2 className="w-4 h-4" /> {error}</p>}
                  </div>

                  <AnimatePresence>
                    {result && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-white rounded-[2rem] shadow-2xl shadow-slate-100 border border-slate-100 overflow-hidden mb-12"
                      >
                        <div className="px-8 py-6 border-b border-slate-100 bg-slate-50/50 backdrop-blur-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <h3 className="text-xl font-extrabold text-slate-900 flex items-center gap-3">
                            <div className="bg-emerald-500 p-1.5 rounded-lg shadow-lg shadow-emerald-100">
                              <CheckCircle2 className="w-5 h-5 text-white" />
                            </div>
                            Optimization Strategy
                          </h3>
                          <button
                            onClick={copyToClipboard}
                            className="inline-flex items-center justify-center gap-2.5 px-6 py-3 text-sm font-bold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all active:scale-95 shadow-sm"
                          >
                            {copied ? <><CheckCircle2 className="w-4 h-4 text-emerald-500" /><span>Copied!</span></> : <><Copy className="w-4 h-4" /><span>Copy Results</span></>}
                          </button>
                        </div>
                        <div className="p-8 sm:p-12 prose prose-slate prose-indigo max-w-none prose-headings:font-bold prose-headings:tracking-tight prose-p:leading-relaxed prose-li:leading-relaxed prose-img:rounded-3xl prose-pre:bg-slate-900 prose-pre:rounded-2xl">
                          <ReactMarkdown>{result}</ReactMarkdown>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </main>
      </div>
    </div>
  );
}
