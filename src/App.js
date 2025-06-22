import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, query, onSnapshot, addDoc, deleteDoc, doc, where, getDocs } from 'firebase/firestore';

// IMPORTANT: This is the URL of your deployed Node.js backend on Render.
const BACKEND_URL = 'https://musicplayer-lr87-91bv.onrender.com'; // VERIFIED NEW RENDER URL

// Firebase Configuration - YOUR ACTUAL FIREBASE PROJECT DETAILS!
const firebaseConfig = {
  apiKey: "AIzaSyCWyH0Zj3OyLrd73PAgIgMN1LA94YMHW9w",
  authDomain: "yourmusicplayerapp.firebaseapp.com",
  projectId: "yourmusicplayerapp",
  storageBucket: "yourmusicplayerapp.firebasestorage.app",
  messagingSenderId: "427968300667",
  appId: "1:427968300667:web:1caef8afdb90c27ed444de",
  measurementId: "G-TPLF8D6ZCN"
};

const App = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [tracks, setTracks] = useState([]); // User's downloaded library
  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState(''); // 'success' or 'error'
  const [isLoading, setIsLoading] = useState(false); // For search/download loading
  const [activeView, setActiveView] = useState('search'); // 'search' or 'library'
  const audioRef = useRef(null);

  // Constants for Firestore paths
  const GITHUB_APP_ID = "your-music-player-github-app"; // Matches Firestore rules

  // Initialize Firebase and set up auth listener
  useEffect(() => {
    try {
      const app = initializeApp(firebaseConfig);
      const firestoreDb = getFirestore(app);
      const firebaseAuth = getAuth(app);
      setDb(firestoreDb);
      setAuth(firebaseAuth);

      const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
        if (user) {
          setUserId(user.uid);
          showMessage(`Signed in as: ${user.uid.substring(0, 8)}...`, 'success');
        } else {
          try {
            await signInAnonymously(firebaseAuth);
            showMessage('Signed in anonymously.', 'success');
          } catch (error) {
            console.error("Firebase Auth Error:", error);
            showMessage(`Authentication failed: ${error.message}. Please check Firebase config.`, 'error');
          }
        }
        setAuthReady(true);
      });

      return () => unsubscribe();
    } catch (error) {
      console.error("Firebase initialization error:", error);
      showMessage(`Firebase initialization failed: ${error.message}. Please check Firebase config.`, 'error');
    }
  }, []);

  // Fetch user's downloaded tracks from Firestore
  useEffect(() => {
    if (authReady && db && userId) {
      const userTracksCollectionRef = collection(db, `artifacts/${GITHUB_APP_ID}/users/${userId}/tracks`);
      const q = query(userTracksCollectionRef);

      const unsubscribe = onSnapshot(q, (snapshot) => {
        const fetchedTracks = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        fetchedTracks.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
        setTracks(fetchedTracks);
      }, (error) => {
        console.error("Error fetching tracks:", error);
        showMessage(`Error fetching music library: ${error.message}`, 'error');
      });

      return () => unsubscribe();
    }
  }, [authReady, db, userId]);

  // Handle audio playback controls
  useEffect(() => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.play().catch(e => {
          console.error("Error playing audio:", e);
          showMessage(`Failed to play audio: ${e.message}. Ensure the track URL is valid and accessible.`, 'error');
        });
      } else {
        audioRef.current.pause();
      }
    }
  }, [isPlaying, currentTrack]);

  const showMessage = (msg, type) => {
    setMessage(msg);
    setMessageType(type);
    setTimeout(() => {
      setMessage('');
      setMessageType('');
    }, 5000);
  };

  // --- Search Functionality ---
  const handleSearch = async (e) => {
    e.preventDefault(); // Prevent page reload on form submit
    if (!searchTerm.trim()) {
      showMessage('Please enter a search term.', 'error');
      return;
    }
    setIsLoading(true);
    showMessage(`Searching for "${searchTerm}"...`, 'success');
    setSearchResults([]); // Clear previous search results

    try {
      const response = await fetch(`${BACKEND_URL}/search?q=${encodeURIComponent(searchTerm)}`);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Backend search failed: ${errorText}`);
      }
      const data = await response.json();
      if (data.success && data.results.length > 0) {
        setSearchResults(data.results);
        showMessage(`Found ${data.results.length} results for "${searchTerm}".`, 'success');
        setActiveView('search'); // Switch to search results view
      } else {
        showMessage(`No results found for "${searchTerm}".`, 'error');
        setSearchResults([]);
      }
    } catch (error) {
      console.error("Search error:", error);
      showMessage(`Search failed: ${error.message}. Ensure your backend is running and accessible.`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // --- Play/Download Logic for Search Results ---
  const handlePlaySearchResult = async (trackInfo) => {
    if (!userId) {
      showMessage('User not authenticated. Please wait for Firebase authentication to complete.', 'error');
      return;
    }
    setIsLoading(true);

    try {
      // 1. Check if the song is already in the user's library (by youtubeId)
      const tracksRef = collection(db, `artifacts/${GITHUB_APP_ID}/users/${userId}/tracks`);
      const q = query(tracksRef, where("youtubeId", "==", trackInfo.youtubeId));
      const querySnapshot = await getDocs(q);

      if (!querySnapshot.empty) {
        // Song already in library, play it
        const existingTrack = querySnapshot.docs[0].data();
        playTrack({ ...existingTrack, id: querySnapshot.docs[0].id }); // Add Firestore doc ID
        showMessage(`Playing "${existingTrack.title}" from your library.`, 'success');
      } else {
        // Song not in library, trigger download/conversion via backend
        showMessage(`Downloading and adding "${trackInfo.title}" to your library...`, 'success');
        const downloadResponse = await fetch(`${BACKEND_URL}/download-mp3`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: trackInfo.url })
        });

        if (!downloadResponse.ok) {
          const errorData = await downloadResponse.json();
          throw new Error(errorData.message || `HTTP error! Status: ${downloadResponse.status}`);
        }

        const data = await downloadResponse.json();
        if (data.success) {
          const newTrack = {
            title: data.title || trackInfo.title,
            artist: data.artist || trackInfo.artist,
            audioUrl: data.audioUrl,
            youtubeId: trackInfo.youtubeId, // Store YouTube ID for future checks
            thumbnail: trackInfo.thumbnail,
            timestamp: new Date().toISOString()
          };
          const docRef = await addDoc(collection(db, `artifacts/${GITHUB_APP_ID}/users/${userId}/tracks`), newTrack);
          playTrack({ ...newTrack, id: docRef.id }); // Play the newly added track
          showMessage(`"${newTrack.title}" downloaded and added to your library!`, 'success');
        } else {
          throw new Error(data.message || 'Download failed on backend.');
        }
      }
    } catch (error) {
      console.error("Play/Download error:", error);
      showMessage(`Error: ${error.message}. Please check backend and network.`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // --- Player Controls ---
  const playTrack = (track) => {
    setCurrentTrack(track);
    setIsPlaying(true);
  };

  const handleAudioEnded = () => {
    setIsPlaying(false);
    // Logic to play next track in current view (library if active, otherwise search results if any)
    const currentList = activeView === 'library' ? tracks : searchResults;
    const currentIndex = currentList.findIndex(t => t.id === currentTrack.id || t.youtubeId === currentTrack.youtubeId);
    if (currentIndex > -1 && currentIndex < currentList.length - 1) {
      handlePlaySearchResult(currentList[currentIndex + 1]); // Use general play logic for next track
    } else {
      // Loop to first track if at the end
      if (currentList.length > 0) {
        handlePlaySearchResult(currentList[0]);
      } else {
        setCurrentTrack(null);
        setIsPlaying(false);
      }
    }
  };

  const handlePlayPause = () => {
    setIsPlaying(!isPlaying);
  };

  const handleNextTrack = () => {
    if (!currentTrack) return;
    const currentList = activeView === 'library' ? tracks : searchResults;
    const currentIndex = currentList.findIndex(t => t.id === currentTrack.id || t.youtubeId === currentTrack.youtubeId);
    if (currentIndex > -1 && currentIndex < currentList.length - 1) {
      handlePlaySearchResult(currentList[currentIndex + 1]);
    } else {
      if (currentList.length > 0) {
        handlePlaySearchResult(currentList[0]); // Loop back to start
      }
    }
  };

  const handlePreviousTrack = () => {
    if (!currentTrack) return;
    const currentList = activeView === 'library' ? tracks : searchResults;
    const currentIndex = currentList.findIndex(t => t.id === currentTrack.id || t.youtubeId === currentTrack.youtubeId);
    if (currentIndex > 0) {
      handlePlaySearchResult(currentList[currentIndex - 1]);
    } else {
      if (currentList.length > 0) {
        handlePlaySearchResult(currentList[currentList.length - 1]); // Loop to end
      }
    }
  };

  const handleDeleteTrack = async (trackId, trackTitle) => {
    if (!db || !userId) {
      showMessage('Firebase not initialized or user not authenticated.', 'error');
      return;
    }
    try {
      await deleteDoc(doc(db, `artifacts/${GITHUB_APP_ID}/users/${userId}/tracks`, trackId));
      showMessage(`"${trackTitle}" deleted successfully.`, 'success');
    } catch (error) {
      console.error("Error deleting track:", error);
      showMessage(`Failed to delete "${trackTitle}": ${error.message}`, 'error');
    }
  };


  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-gray-900 to-black text-white font-inter">
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <style>
        {`
          body { font-family: 'Inter', sans-serif; overflow-x: hidden; }
          .sidebar {
            width: 100%;
            height: auto;
            border-bottom: 1px solid rgba(255,255,255,0.1);
          }
          .main-content {
            flex-grow: 1;
            padding-bottom: 96px; /* Space for the fixed player */
          }
          .footer-player {
            height: 96px;
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            z-index: 100;
          }
          .scroll-container {
            max-height: calc(100vh - 350px); /* Adjust based on header/player height */
            overflow-y: auto;
            scrollbar-width: thin;
            scrollbar-color: #6B46C1 #2D3748;
          }
          .scroll-container::-webkit-scrollbar {
            width: 8px;
          }
          .scroll-container::-webkit-scrollbar-track {
            background: #2D3748;
            border-radius: 10px;
          }
          .scroll-container::-webkit-scrollbar-thumb {
            background-color: #6B46C1;
            border-radius: 10px;
            border: 2px solid #2D3748;
          }
          /* Custom styling for play button in list items */
          .play-button-overlay {
            opacity: 0;
            transition: opacity 0.2s ease-in-out;
          }
          .list-item-hover:hover .play-button-overlay {
            opacity: 1;
          }
          .player-gradient-overlay {
            background: linear-gradient(to top, rgba(0,0,0,0.8), rgba(0,0,0,0));
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            height: 50px; /* Adjust as needed */
            pointer-events: none; /* Allows clicks to pass through */
            z-index: 99;
          }

          @media (min-width: 768px) { /* md breakpoint */
            .sidebar {
              width: 250px;
              height: 100vh;
              border-right: 1px solid rgba(255,255,255,0.1);
              border-bottom: none;
            }
            .main-layout {
              display: flex;
              flex-direction: row;
              min-height: 100vh;
            }
            .main-content {
              flex-grow: 1;
              padding-bottom: 0; /* No need for padding here, player is outside flow */
            }
          }
        `}
      </style>

      {/* Main Layout Container */}
      <div className="flex flex-col md:flex-row flex-grow main-layout">
        {/* Sidebar */}
        <aside className="sidebar bg-gray-900 p-4 flex flex-col items-center justify-center md:justify-start pt-6">
          <div className="mb-8 text-center">
            <h2 className="text-3xl font-bold text-white mb-2">My Music</h2>
            <p className="text-sm text-gray-400">Powered by YouTube</p>
          </div>
          <nav className="w-full flex md:flex-col justify-center gap-4">
            <button
              onClick={() => setActiveView('search')}
              className={`w-full py-2 px-4 rounded-lg flex items-center justify-center gap-3 font-semibold transition-colors duration-200
                ${activeView === 'search' ? 'bg-purple-600 text-white shadow-lg' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
              </svg>
              Search
            </button>
            <button
              onClick={() => setActiveView('library')}
              className={`w-full py-2 px-4 rounded-lg flex items-center justify-center gap-3 font-semibold transition-colors duration-200
                ${activeView === 'library' ? 'bg-purple-600 text-white shadow-lg' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M7 4a1 1 0 00-1 1v10a1 1 0 001 1h6a1 1 0 001-1V5a1 1 0 00-1-1H7zM4 5a3 3 0 013-3h6a3 3 0 013 3v10a3 3 0 01-3 3H7a3 3 0 01-3-3V5z" />
              </svg>
              Library
            </button>
          </nav>
          {authReady && userId && (
            <div className="mt-auto md:mt-8 text-center text-xs text-gray-500 p-2 rounded-lg bg-gray-800 border border-gray-700 max-w-full overflow-hidden text-ellipsis">
              User ID: <span className="font-mono text-purple-300 break-words">{userId.substring(0, 10)}...</span>
            </div>
          )}
        </aside>

        {/* Main Content Area */}
        <main className="main-content flex-grow bg-gray-800 p-4 sm:p-6 md:p-8 relative overflow-hidden">
          {/* Message Box */}
          {message && (
            <div className={`absolute top-4 left-1/2 -translate-x-1/2 w-11/12 max-w-md p-3 rounded-lg text-center font-medium shadow-xl transition-opacity duration-300 ${messageType === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'} opacity-95 z-50`}>
              {message}
            </div>
          )}

          {activeView === 'search' && (
            <section className="space-y-6">
              <h1 className="text-3xl sm:text-4xl font-bold text-purple-400 mb-6 drop-shadow-lg text-center md:text-left">
                Discover Music
              </h1>
              {/* Search Bar */}
              <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-4">
                <input
                  type="text"
                  className="flex-grow p-3 rounded-lg bg-gray-700 border border-purple-600 focus:outline-none focus:ring-2 focus:ring-purple-400 text-white placeholder-gray-400 text-base shadow-inner transition duration-200 focus:border-purple-400"
                  placeholder="Search for songs or artists..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  disabled={isLoading}
                />
                <button
                  type="submit"
                  className="w-full sm:w-auto px-6 py-3 bg-purple-700 hover:bg-purple-600 rounded-lg font-semibold text-white shadow-xl transform transition duration-300 hover:scale-105 button-glow flex items-center justify-center gap-2 text-base md:text-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  )}
                  Search
                </button>
              </form>

              {/* Search Results Display */}
              <div className="scroll-container bg-gray-900 rounded-xl p-4 shadow-inner relative">
                {searchResults.length === 0 && !isLoading ? (
                  <p className="text-gray-500 text-center py-8 text-base">Search for a song to get started!</p>
                ) : searchResults.length === 0 && isLoading ? (
                    <p className="text-gray-500 text-center py-8 text-base">Loading search results...</p>
                ) : (
                  <ul className="space-y-3">
                    {searchResults.map((result) => (
                      <li
                        key={result.youtubeId}
                        className={`flex items-center p-3 rounded-xl transition duration-200 ease-in-out border border-gray-700 bg-gray-800 hover:bg-gray-700 group list-item-hover`}
                      >
                        <img
                          src={result.thumbnail || 'https://placehold.co/60x60/333/FFF?text=No+Thumb'}
                          alt={result.title}
                          className="w-16 h-16 rounded-lg mr-4 object-cover"
                          onError={(e) => { e.target.onerror = null; e.target.src="https://placehold.co/60x60/333/FFF?text=No+Thumb"; }}
                        />
                        <div className="flex-1 min-w-0 pr-4">
                          <p className="font-semibold text-lg truncate text-white">{result.title}</p>
                          <p className="text-sm text-gray-400 truncate">{result.artist}</p>
                        </div>
                        <div className="relative">
                          <button
                            onClick={() => handlePlaySearchResult(result)}
                            disabled={isLoading}
                            className="p-2 bg-green-500 hover:bg-green-400 rounded-full text-white shadow-md transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed play-button-overlay"
                            title="Play Song"
                          >
                            {isLoading && currentTrack && currentTrack.youtubeId === result.youtubeId ? (
                                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                                </svg>
                            )}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {searchResults.length > 0 && <div className="player-gradient-overlay"></div>}
              </div>
            </section>
          )}

          {activeView === 'library' && (
            <section className="space-y-6">
              <h1 className="text-3xl sm:text-4xl font-bold text-purple-400 mb-6 drop-shadow-lg text-center md:text-left">
                Your Downloaded Library
              </h1>
              <div className="scroll-container bg-gray-900 rounded-xl p-4 shadow-inner relative">
                {tracks.length === 0 ? (
                  <p className="text-gray-500 text-center py-8 text-base">No music in your library. Search and download some songs!</p>
                ) : (
                  <ul className="space-y-3">
                    {tracks.map((track) => (
                      <li
                        key={track.id}
                        className={`flex items-center justify-between p-3 rounded-xl cursor-pointer transition duration-200 ease-in-out border
                                  ${currentTrack && currentTrack.id === track.id ? 'bg-purple-800 text-white shadow-xl list-item-active border-purple-600' : 'bg-gray-700 hover:bg-gray-600 text-gray-200 border-gray-700'}
                                  group`}
                        onClick={() => playTrack(track)}
                      >
                        <img
                          src={track.thumbnail || 'https://placehold.co/60x60/333/FFF?text=No+Thumb'}
                          alt={track.title}
                          className="w-16 h-16 rounded-lg mr-4 object-cover"
                          onError={(e) => { e.target.onerror = null; e.target.src="https://placehold.co/60x60/333/FFF?text=No+Thumb"; }}
                        />
                        <div className="flex-1 min-w-0 pr-4">
                          <p className="font-semibold text-lg truncate">{track.title}</p>
                          <p className="text-sm text-gray-300 truncate">{track.artist}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {currentTrack && currentTrack.id === track.id && isPlaying ? (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-purple-300" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                          ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-400 group-hover:text-white" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                            </svg>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteTrack(track.id, track.title); }}
                            className="text-red-400 hover:text-red-300 p-2 rounded-full hover:bg-red-800 transition duration-200"
                            title="Delete Track"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm6 0a1 1 0 11-2 0v6a1 1 0 112 0V8z" clipRule="evenodd" />
                            </svg>
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {tracks.length > 0 && <div className="player-gradient-overlay"></div>}
              </div>
            </section>
          )}
        </main>
      </div>

      {/* Audio Player Controls (Fixed at Bottom) */}
      <footer className="footer-player bg-gray-900 border-t border-gray-700 p-4 sm:p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <audio
          ref={audioRef}
          src={currentTrack ? currentTrack.audioUrl : ''}
          onEnded={handleAudioEnded}
          className="hidden" // Keep HTML controls hidden, use custom ones
          controls
        ></audio>

        <div className="flex items-center gap-4 flex-grow sm:flex-grow-0 min-w-0">
          <img
            src={currentTrack?.thumbnail || 'https://placehold.co/60x60/222/555?text=🎧'}
            alt="Album Art"
            className="w-16 h-16 rounded-md object-cover flex-shrink-0"
          />
          <div className="flex flex-col min-w-0 flex-grow">
            <p className="font-semibold text-white truncate text-lg">
              {currentTrack ? currentTrack.title : 'Not playing'}
            </p>
            <p className="text-sm text-gray-400 truncate">
              {currentTrack ? currentTrack.artist : 'Select a song'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 sm:gap-6 justify-center w-full sm:w-auto">
          <button
            onClick={handlePreviousTrack}
            disabled={!currentTrack || isLoading}
            className="p-3 bg-gray-700 hover:bg-gray-600 rounded-full shadow-lg transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-white text-opacity-80 hover:text-opacity-100 button-player-glow"
            title="Previous Track"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832L14 11.002a1 1 0 000-1.664l-4.445-2.834z" clipRule="evenodd" />
            </svg>
          </button>
          <button
            onClick={handlePlayPause}
            disabled={!currentTrack || isLoading}
            className="p-4 bg-purple-600 hover:bg-purple-500 rounded-full shadow-xl transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-white button-player-glow"
            title={isPlaying ? "Pause" : "Play"}
          >
            {isLoading && currentTrack ? (
                 <svg className="animate-spin h-7 w-7 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                   <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                   <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                 </svg>
            ) : isPlaying ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
              </svg>
            )}
          </button>
          <button
            onClick={handleNextTrack}
            disabled={!currentTrack || isLoading}
            className="p-3 bg-gray-700 hover:bg-gray-600 rounded-full shadow-lg transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-white text-opacity-80 hover:text-opacity-100 button-player-glow"
            title="Next Track"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM10.445 7.168A1 1 0 0012 8v4a1 1 0 00-1.555.832L6 11.002a1 1 0 000-1.664l4.445-2.834z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* Fullscreen button (optional, moved to sidebar or main content for player consistency) */}
        {/* <div className="flex justify-center sm:hidden mt-4">
          <button
            onClick={requestFullscreen}
            className="px-4 py-2 bg-blue-700 hover:bg-blue-600 rounded-lg font-semibold text-white shadow-lg transition duration-300 hover:scale-105 flex items-center justify-center gap-2 text-sm button-glow"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 0h-4m4 0l-5-5" />
            </svg>
            Fullscreen
          </button>
        </div> */}
      </footer>
    </div>
  );
};

export default App;
