import React, { useState, useEffect, useRef } from 'react';
import { Search, Film, Tv, Flame, Heart, Sparkles, X, Shield, Lock, Settings, Smartphone, Skull, Volume2, VolumeX, Command, Disc, Zap, Share2, Check, MoreHorizontal, Milestone, Users } from 'lucide-react';
import soundFx from '../services/soundFx';

export function HanimeIcon({ className = "w-3.5 h-3.5 sm:w-4 sm:h-4", ...props }) {
  const [imgFailed, setImgFailed] = useState(false);
  if (imgFailed) {
    return (
      <span 
        className={`inline-flex items-center justify-center rounded-full bg-gradient-to-tr from-pink-600 via-rose-500 to-pink-400 text-white font-black text-[9px] sm:text-[10px] leading-none shadow-[0_0_8px_rgba(244,63,94,0.6)] select-none border border-pink-300/40 shrink-0 ${className}`}
        title="Hanime Vault"
        {...props}
      >
        H
      </span>
    );
  }
  return (
    <img 
      src="./hanime_icon.png" 
      alt="Hanime Vault" 
      onError={() => setImgFailed(true)}
      className={`rounded-full object-contain inline-block filter drop-shadow-[0_0_6px_rgba(255,20,147,0.7)] shrink-0 ${className}`}
      {...props} 
    />
  );
}

export default function Navbar({ 
  activeCategory, 
  setActiveCategory, 
  onSearch, 
  searchQuery, 
  setSearchQuery,
  isStealthMode,
  isMasterMode,
  includeMature,
  isLowSpecMode,
  onToggleLowSpec,
  onOpenSettings,
  onOpenIPhoneModal,
  onOpenAndroidModal,
  onOpenStudio,
  onOpenSearchOverlay,
  onOpenOracle,
  onOpenJukebox,
  onOpenTimeline,
  onOpenWatchTogether
}) {
  const baseCategories = [
    { id: 'trending', label: 'Trending', icon: Flame },
    { id: 'new_movies', label: 'New Movies', icon: Sparkles },
    { id: 'moviebox', label: 'MovieBox', icon: Film },
    { id: 'hollywood', label: 'Hollywood', icon: Film },
    { id: 'hindi', label: 'Hindi', icon: Sparkles },
    { id: 'kdrama', label: 'K-Drama', icon: Tv },
    { id: 'anime', label: 'Anime', icon: Sparkles },
    { id: 'horror', label: 'Horror', icon: Skull },
    { id: 'series', label: 'Series', icon: Tv },
    { id: 'watchlist', label: 'Watchlist', icon: Heart }
  ];

  const categories = isMasterMode
    ? [
        ...baseCategories.slice(0, 6),
        { id: 'mature', label: 'Uncut', icon: Flame, isVault: true },
        { id: 'ecchi_anime', label: 'Hanime', icon: HanimeIcon, isVault: true },
        ...baseCategories.slice(6)
      ]
    : baseCategories;

  const [localSearch, setLocalSearch] = useState(searchQuery || '');
  const [isSoundOn, setIsSoundOn] = useState(() => !soundFx.isMuted());
  const [shareCopied, setShareCopied] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const moreRef = useRef(null);
  const inputRef = useRef(null);

  // Close the "More" menu on outside click or Escape.
  useEffect(() => {
    if (!isMoreOpen) return;
    const onPointer = (e) => {
      if (moreRef.current && !moreRef.current.contains(e.target)) setIsMoreOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setIsMoreOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [isMoreOpen]);
  const isFocusedRef = useRef(false);
  const isComposingRef = useRef(false);
  const debounceTimerRef = useRef(null);
  const lastEmittedQueryRef = useRef(searchQuery || '');

  useEffect(() => {
    if (!isFocusedRef.current) {
      setLocalSearch(searchQuery || '');
      lastEmittedQueryRef.current = searchQuery || '';
    }
  }, [searchQuery]);

  const handleInputChange = (e) => {
    const nextVal = e.target.value;
    setLocalSearch(nextVal);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (!nextVal.trim()) {
      lastEmittedQueryRef.current = '';
      onSearch('');
      return;
    }

    debounceTimerRef.current = setTimeout(() => {
      if (!isComposingRef.current) {
        lastEmittedQueryRef.current = nextVal;
        onSearch(nextVal);
      }
    }, 300);
  };

  const handleKeyDown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      lastEmittedQueryRef.current = localSearch;
      onSearch(localSearch);
      e.target.blur();
    } else if (e.key === 'Escape') {
      if (localSearch) {
        handleClear();
      }
      e.target.blur();
    }
  };

  const handleClear = () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    lastEmittedQueryRef.current = '';
    setLocalSearch('');
    onSearch('');
  };

  return (
    <header className="sticky top-0 z-40 glass-nav px-2 sm:px-4 py-1.5 sm:py-2 pt-[max(0.75rem,calc(env(safe-area-inset-top,0px)+0.25rem))] w-full border-b border-cyan-500/20 backdrop-blur-2xl">
      <div className="w-full max-w-full mx-auto flex items-center justify-between gap-1 sm:gap-2">
        
        {/* Brand Logo with Cute Furina Chibi Animated Mascot */}
        <div 
          onClick={() => { 
            soundFx.playWaterDrop();
            setActiveCategory('trending'); 
            setSearchQuery(''); 
          }}
          className="flex items-center gap-1 sm:gap-2.5 cursor-pointer group shrink-0"
        >
          {isStealthMode ? (
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-gradient-to-br from-slate-700 to-slate-900 border border-slate-600/50 flex items-center justify-center text-cyan-400 font-black text-xs shadow">
              <Film className="w-4 h-4 text-cyan-400" />
            </div>
          ) : (
            <div className="relative w-8 h-8 sm:w-9 sm:h-9 rounded-full overflow-hidden border-2 border-cyan-400/90 shadow-[0_0_16px_rgba(56,189,248,0.7)] ring-1 ring-cyan-200/50 group-hover:scale-105 group-hover:shadow-[0_0_24px_rgba(56,189,248,0.9)] group-active:scale-95 transition-all duration-300 bg-[#060d24] shrink-0">
              <img 
                src="./furina-avatar.png" 
                alt="Furina MovieBox" 
                className="w-full h-full object-cover object-center group-hover:scale-110 transition-transform duration-300" 
                onError={(e) => { e.currentTarget.src = './favicon.png'; }}
              />
            </div>
          )}
          
          <div className="shrink-0 flex flex-col justify-center">
            <div className="flex items-center gap-1 sm:gap-1.5">
              <span className={`font-black text-sm sm:text-base tracking-tight ${
                isStealthMode
                  ? 'text-white'
                  : 'bg-gradient-to-r from-cyan-200 via-sky-300 to-blue-400 bg-clip-text text-transparent drop-shadow-[0_0_10px_rgba(56,189,248,0.5)]'
              }`}>
                {isStealthMode ? 'Stream' : 'Furina'}
              </span>
              <span className="font-extrabold text-sm sm:text-base text-white tracking-tight flex items-center gap-1">
                <span>{isStealthMode ? 'Cinema' : 'MovieBox'}</span>
                {!isStealthMode && (
                  <span className="text-[8.5px] font-black uppercase px-1 py-0.5 rounded bg-gradient-to-r from-cyan-400 to-blue-500 text-slate-950 font-mono shadow-[0_0_8px_rgba(56,189,248,0.6)] leading-none hidden xs:inline-block">
                    4K
                  </span>
                )}
              </span>
            </div>
            <div className="text-[8px] sm:text-[8.5px] text-cyan-300/80 font-semibold tracking-wider uppercase hidden 2xl:flex items-center gap-1">
              <span>{isStealthMode ? 'HD Stream Player' : '4K Cinema & Multi-Dub'}</span>
              <span className="text-cyan-400">✦</span>
            </div>
          </div>
        </div>

        {/* Compact Search Bar with 3D Spotlight Overlay Shortcut Trigger */}
        <div className="flex-1 min-w-[110px] max-w-none sm:max-w-xs lg:max-w-[220px] xl:max-w-sm relative transition-all duration-300">
          <div className="relative flex items-center">
            <Search className="absolute left-2.5 w-3.5 h-3.5 text-cyan-400/70 pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              inputMode="search"
              value={localSearch}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onFocus={() => { 
                isFocusedRef.current = true;
              }}
              onBlur={() => { isFocusedRef.current = false; }}
              onCompositionStart={() => { isComposingRef.current = true; }}
              onCompositionEnd={(e) => {
                isComposingRef.current = false;
                handleInputChange(e);
              }}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck="false"
              enterKeyHint="search"
              placeholder="Search..."
              style={{ touchAction: 'manipulation' }}
              className="w-full bg-[#0b1633]/90 border border-cyan-500/25 rounded-full pl-7 pr-7 py-1 sm:py-1 text-base sm:text-xs text-white placeholder-cyan-200/40 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/50 transition shadow-inner"
            />
            {localSearch && (
              <>
                <button 
                  onClick={handleClear}
                  className="absolute right-2 text-cyan-400/60 hover:text-white cursor-pointer"
                  type="button"
                  aria-label="Clear search"
                  title="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={handleClear}
                  className="sr-only"
                  type="button"
                  aria-label="Clear search input"
                  tabIndex={-1}
                />
              </>
            )}
          </div>
        </div>

        {/* Desktop Category Navigation */}
        <nav className="hidden lg:flex items-center gap-1 bg-[#0a1329]/80 p-0.5 rounded-full border border-cyan-500/20 min-w-0 shrink overflow-x-auto no-scrollbar">
          {categories.map((cat) => {
            const Icon = cat.icon;
            const isActive = activeCategory === cat.id && !searchQuery;
            return (
              <button
                key={cat.id}
                onClick={() => {
                  soundFx.playClick();
                  setActiveCategory(cat.id);
                  setSearchQuery('');
                  setLocalSearch('');
                }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap transition shrink-0 cursor-pointer ${
                  cat.isVault
                    ? isActive
                      ? 'bg-amber-500 text-gray-950 font-bold shadow'
                      : 'text-amber-400 hover:bg-amber-500/10'
                    : isActive
                    ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-[0_0_10px_rgba(77,197,249,0.4)]'
                    : 'text-cyan-200/70 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon className="w-3 h-3" />
                <span>{cat.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Action Controls: one "More" menu + Settings */}
        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
          <div className="relative" ref={moreRef}>
            <button
              type="button"
              onClick={() => setIsMoreOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={isMoreOpen}
              title="More"
              className={`p-1.5 sm:px-2.5 sm:py-1 rounded-full border transition flex items-center gap-1 text-[11px] font-semibold cursor-pointer ${
                isMoreOpen
                  ? 'bg-cyan-500/20 border-cyan-400 text-white'
                  : 'bg-[#0b1633] border-cyan-500/30 text-cyan-300 hover:text-white hover:bg-white/10'
              }`}
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">More</span>
            </button>

            {isMoreOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-60 rounded-2xl border border-cyan-500/25 bg-[#081129] shadow-[0_18px_50px_rgba(0,0,0,0.6)] p-1.5 z-50"
              >
                {[
                  onOpenSearchOverlay && { label: 'Spotlight search', hint: 'Ctrl+K', icon: Search, run: onOpenSearchOverlay },
                  onOpenOracle && { label: 'AI mood picks', icon: Sparkles, run: onOpenOracle },
                  onOpenTimeline && { label: 'Franchise timelines', icon: Milestone, run: onOpenTimeline },
                  onOpenWatchTogether && { label: 'Watch together', icon: Users, run: onOpenWatchTogether },
                  onOpenJukebox && { label: 'Jukebox', icon: Disc, run: onOpenJukebox },
                  onOpenStudio && { label: 'Studio', icon: Film, run: onOpenStudio },
                  'divider',
                  onOpenAndroidModal && { label: 'Install on Android', icon: Smartphone, run: onOpenAndroidModal },
                  onOpenIPhoneModal && { label: 'Install on iPhone', icon: Smartphone, run: onOpenIPhoneModal },
                  'divider',
                  {
                    label: isSoundOn ? 'Sound effects: on' : 'Sound effects: off',
                    icon: isSoundOn ? Volume2 : VolumeX,
                    keepOpen: true,
                    run: () => setIsSoundOn(soundFx.toggleMute()),
                  },
                  {
                    label: isLowSpecMode ? 'Eco mode: on' : 'Eco mode: off',
                    icon: Zap,
                    keepOpen: true,
                    run: () => onToggleLowSpec?.(),
                  },
                  {
                    label: shareCopied ? 'Link copied' : 'Copy share link',
                    icon: shareCopied ? Check : Share2,
                    keepOpen: true,
                    run: async () => {
                      try {
                        await navigator.clipboard.writeText(window.location.href);
                        setShareCopied(true);
                        setTimeout(() => setShareCopied(false), 2000);
                      } catch (e) {}
                    },
                  },
                ]
                  .filter(Boolean)
                  .map((entry, i) => {
                    if (entry === 'divider') {
                      return <div key={`d${i}`} className="my-1 h-px bg-cyan-500/15" />;
                    }
                    const Icon = entry.icon;
                    return (
                      <button
                        key={entry.label}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          soundFx.playClick?.();
                          entry.run();
                          if (!entry.keepOpen) setIsMoreOpen(false);
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] text-cyan-50/90 hover:bg-cyan-500/10 hover:text-white transition cursor-pointer text-left"
                      >
                        <Icon className="w-4 h-4 text-cyan-400 shrink-0" />
                        <span className="flex-1">{entry.label}</span>
                        {entry.hint && (
                          <kbd className="text-[10px] font-mono text-cyan-300/60 border border-cyan-500/25 rounded px-1">{entry.hint}</kbd>
                        )}
                      </button>
                    );
                  })}
              </div>
            )}
          </div>

          <button
            onClick={onOpenSettings}
            data-testid="settings-btn"
            aria-label="Settings"
            title="Settings & Master Vault"
            className={`p-1.5 sm:px-2 sm:py-1 rounded-full border transition-all duration-200 flex items-center gap-1 cursor-pointer shrink-0 group/settings ${
              isMasterMode
                ? 'bg-emerald-500/20 border-emerald-400 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.5)]'
                : 'bg-[#0b1633] border-cyan-500/30 text-cyan-300 hover:text-white hover:bg-white/10 hover:border-cyan-400/50'
            }`}
          >
            {isMasterMode ? (
              <Shield className="w-3.5 h-3.5 text-emerald-400 group-hover/settings:scale-110 transition-transform" />
            ) : (
              <Settings className="w-3.5 h-3.5 text-cyan-400 group-hover/settings:rotate-90 transition-transform duration-500" />
            )}
            <span className="hidden sm:inline text-[11px] font-semibold">
              {isMasterMode ? 'VIP Active' : 'Settings'}
            </span>
          </button>
        </div>

      </div>

      {/* Mobile Category Scrollable Bar */}
      <div 
        className="flex lg:hidden overflow-x-auto gap-1 pt-1.5 pb-0.5 no-scrollbar"
        style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-x' }}
      >
        {categories.map((cat) => {
          const Icon = cat.icon;
          const isActive = activeCategory === cat.id && !searchQuery;
          return (
            <button
              key={cat.id}
              data-category={cat.id}
              onClick={() => { 
                soundFx.playClick();
                setActiveCategory(cat.id); 
                setSearchQuery(''); 
              }}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] sm:text-[11px] font-medium whitespace-nowrap transition border ${
                cat.isVault
                  ? isActive
                    ? 'bg-amber-500 text-gray-950 border-amber-400 font-bold shadow'
                    : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                  : isActive
                  ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-[0_0_8px_rgba(77,197,249,0.3)] font-semibold'
                  : 'bg-[#0c1836]/60 border-cyan-500/15 text-cyan-200/60'
              }`}
            >
              <Icon className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
              <span>{cat.label}</span>
            </button>
          );
        })}
      </div>
    </header>
  );
}
