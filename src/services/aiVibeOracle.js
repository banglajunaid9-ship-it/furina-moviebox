// ============================================================================
// Furina MovieBox — AI Vibe Oracle & Semantic Mood Discovery Service
// Dynamic AI & Natural Language Mood Recommendation Engine
// Powers real-time search, deep semantic intent mapping, and Gemini Live AI.
// ============================================================================

import { searchContent, fetchGenreMovies, FALLBACK_MEDIA } from './tmdb';
import { askGeminiOracle } from './geminiOracleService';

export const QUICK_VIBES = [
  { id: 'horror', label: '👻 Midnight Horror', query: 'midnight psychological horror ghost demon curse' },
  { id: 'scifi', label: '🌌 Mind-Bending Sci-Fi', query: 'mind bending sci-fi time travel space odyssey' },
  { id: 'hype', label: '⚔️ Shonen Hype Battles', query: 'epic hype battle anime superpower martial arts' },
  { id: 'rainy', label: '🌧️ Fontaine Cozy Rain', query: 'rainy midnight cozy lofi anime comfort aesthetic' },
  { id: 'twist', label: '🧠 Mind Game Twists', query: 'psychological thriller crime mystery unexpected twist' },
  { id: 'zombie', label: '🧟 Zombie Apocalypse', query: 'zombie apocalypse survival outbreak infection undead' },
  { id: 'romance', label: '💖 Heartfelt Romance', query: 'emotional romance love story tearjerker beautiful' },
  { id: 'comedy', label: '😂 Laugh Out Loud', query: 'hilarious comedy buddy comedy funny parody' },
  { id: 'action', label: '🏎️ Pure Adrenaline', query: 'high octane action car chase revenge explosion adrenaline' }
];

export const VIBE_DICTIONARY = [
  {
    keywords: ['horror', 'scary', 'spooky', 'curse', 'ghost', 'haunted', 'blood', 'demon', 'conjuring', 'sinister', 'slasher', 'killer', 'exorcist', 'creepy', 'nightmare', 'evil'],
    vibeName: 'Terrifying Midnight Nightmares',
    vibeBadge: '👻 Pure Horror',
    accentColor: '#dc2626',
    reason: 'Hand-picked for pulse-pounding tension, paranormal dread, and psychological frights.',
    matches: [
      { id: 138843, title: 'The Conjuring', media_type: 'movie', vote_average: 7.5, poster_path: '/wVYREutTvI2tmxr6ujrHT704wGF.jpg', release_date: '2013-07-18', overview: 'Paranormal investigators Ed and Lorraine Warren work to help a family terrorized by a dark presence.' },
      { id: 82507, title: 'Sinister', media_type: 'movie', vote_average: 6.9, poster_path: '/5A6b73V7eCg4r3e2M6w7m0o4K7a.jpg', release_date: '2012-10-12', overview: 'A true-crime writer discovers a box of super 8 home movies depicting gory murders in his new house.' },
      { id: 493922, title: 'Hereditary', media_type: 'movie', vote_average: 7.3, poster_path: '/p9fmuz2Oj3b77v96N4n1F9qUfW3.jpg', release_date: '2018-06-07', overview: 'When Ellen passes away, her daughter’s family begins to unravel cryptic and terrifying ancestral secrets.' },
      { id: 447332, title: 'A Quiet Place', media_type: 'movie', vote_average: 7.4, poster_path: '/nAU74GmpUk7t5iklEp3bufwDq4n.jpg', release_date: '2018-04-03', overview: 'A family must navigate their lives in silence to avoid mysterious creatures that hunt by sound.' },
      { id: 882598, title: 'Smile', media_type: 'movie', vote_average: 6.8, poster_path: '/aPqcQwu4VGEewPhagRIDa7RffWk.jpg', release_date: '2022-09-23', overview: 'After witnessing a bizarre, traumatic incident, Dr. Rose Cotter begins experiencing frightening occurrences.' }
    ]
  },
  {
    keywords: ['mind', 'bending', 'inception', 'interstellar', 'time', 'space', 'tenet', 'matrix', 'reality', 'scifi', 'sci-fi', 'quantum', 'cosmos'],
    vibeName: 'Mind-Bending Dimension Hoppers',
    vibeBadge: '🌌 Quantum Sci-Fi',
    accentColor: '#06b6d4',
    reason: 'Selected for mind-bending philosophical concepts, cosmic scale, and reality-altering cinematography.',
    matches: [
      { id: 157336, title: 'Interstellar', media_type: 'movie', vote_average: 8.4, poster_path: '/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg', release_date: '2014-11-05', overview: 'A journey through a wormhole to surpass the limits of human space travel.' },
      { id: 27205, title: 'Inception', media_type: 'movie', vote_average: 8.4, poster_path: '/edv5CZvWj09upOsy2Y6IwDhK8bt.jpg', release_date: '2010-07-15', overview: 'A thief who steals corporate secrets through dream-sharing technology.' },
      { id: 335984, title: 'Blade Runner 2049', media_type: 'movie', vote_average: 8.0, poster_path: '/gajva2L0rPYkEWjzgFlBXCAVBE5.jpg', release_date: '2017-10-04', overview: 'A young blade runner unearths a long-buried secret that leads him to Rick Deckard.' },
      { id: 693134, title: 'Dune: Part Two', media_type: 'movie', vote_average: 8.2, poster_path: '/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg', release_date: '2024-02-27', overview: 'Paul Atreides unites with Chani and the Fremen while seeking revenge.' },
      { id: 603, title: 'The Matrix', media_type: 'movie', vote_average: 8.2, poster_path: '/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg', release_date: '1999-03-30', overview: 'A computer hacker learns the shocking truth about his reality from mysterious rebels.' }
    ]
  },
  {
    keywords: ['hype', 'battle', 'shonen', 'fight', 'action', 'powers', 'jujutsu', 'demon slayer', 'solo leveling', 'dbz', 'naruto', 'punch', 'hero'],
    vibeName: 'Max Adrenaline Shonen Peak',
    vibeBadge: '⚔️ Hype Battles',
    accentColor: '#f59e0b',
    reason: 'Delivers raw 60 FPS sakuga animation, god-tier power escalations, and goosebump-inducing fight choreography.',
    matches: [
      { id: 85937, title: 'Demon Slayer: Kimetsu no Yaiba', media_type: 'tv', vote_average: 8.7, poster_path: '/xUfRZu2mi8jH6SzQEJGP6tjBuYj.jpg', overview: 'Tanjiro seeks to turn his demon-transformed sister Nezuko back into a human.' },
      { id: 95479, title: 'Jujutsu Kaisen', media_type: 'tv', vote_average: 8.6, poster_path: '/fHpKW79EhaI1q20upXuhW1P6x6h.jpg', overview: 'Yuji Itadori swallows a cursed finger to save his friends and enters the Jujutsu Sorcerer world.' },
      { id: 127532, title: 'Solo Leveling', media_type: 'tv', vote_average: 8.6, poster_path: '/geCRueV3ElhRTr0xtJuPxJ8HGdJ.jpg', overview: 'The weakest E-rank hunter gains a quest window only visible to him, unlocking infinite leveling.' },
      { id: 1429, title: 'Attack on Titan', media_type: 'tv', vote_average: 8.7, poster_path: '/hTP1DtLGFamjfu8WqjnuQdP1n4i.jpg', overview: 'Humanity battles colossal humanoid Titans behind defensive concentric walls.' },
      { id: 31910, title: 'Naruto Shippuden', media_type: 'tv', vote_average: 8.6, poster_path: '/kV27inQaQi0ZsQ7Z98r9jZq951e.jpg', overview: 'Naruto returns to the Hidden Leaf village to protect his friends and face the Akatsuki.' }
    ]
  },
  {
    keywords: ['zombie', 'apocalypse', 'virus', 'infection', 'undead', 'outbreak', 'survival', 'walking dead', 'last of us'],
    vibeName: 'Post-Apocalyptic Survival & Undead',
    vibeBadge: '🧟 Zombie Survival',
    accentColor: '#10b981',
    reason: 'Raw grit, desperation, and relentless infected swarms testing the limits of human survival.',
    matches: [
      { id: 396535, title: 'Train to Busan', media_type: 'movie', vote_average: 7.8, poster_path: '/vNVFt6dtcqnI7hB6vooqebzgZ1M.jpg', release_date: '2016-07-20', overview: 'Passengers on a bullet train struggle to survive a sudden zombie outbreak spreading across South Korea.' },
      { id: 72190, title: 'World War Z', media_type: 'movie', vote_average: 6.8, poster_path: '/1SWb5i2D0zG324p2Y9vW9a4p4f6.jpg', release_date: '2013-06-19', overview: 'Former United Nations investigator Gerry Lane travels the world in a race against time to stop a pandemic.' },
      { id: 100088, title: 'The Last of Us', media_type: 'tv', vote_average: 8.6, poster_path: '/uKvVjHNqB5VmOrdxqAt2V7J9OwP.jpg', overview: '20 years after modern civilization was destroyed, Joel is hired to smuggle Ellie out of an oppressive quarantine zone.' },
      { id: 170, title: '28 Days Later', media_type: 'movie', vote_average: 7.2, poster_path: '/sQ5K0Ue3a1fQ5r2T6w8m4o2M7c1.jpg', release_date: '2002-10-31', overview: 'Four weeks after a mysterious virus spreads throughout the UK, a handful of survivors attempt to find sanctuary.' }
    ]
  },
  {
    keywords: ['romance', 'love', 'romantic', 'couple', 'heart', 'relationship', 'dating', 'wedding', 'titanic', 'notebook', 'la la land', 'tears'],
    vibeName: 'Epic Romances & Tearjerkers',
    vibeBadge: '💖 Pure Romance',
    accentColor: '#ec4899',
    reason: 'Heartwarming confessions, breathtaking chemistry, and unforgettable timeless love stories.',
    matches: [
      { id: 597, title: 'Titanic', media_type: 'movie', vote_average: 7.9, poster_path: '/9xjZS2rlVxm8SFx8kPC3aIGCOYQ.jpg', release_date: '1997-11-18', overview: '101-year-old Rose DeWitt Bukater tells the story of her life aboard the Titanic, 84 years later.' },
      { id: 313369, title: 'La La Land', media_type: 'movie', vote_average: 7.9, poster_path: '/uDO8zWDhfWwoFdKS4fzkVJt0Rf0.jpg', release_date: '2016-11-29', overview: 'While navigating their careers in Los Angeles, a pianist and an actress fall in love while attempting to reconcile their aspirations.' },
      { id: 11036, title: 'The Notebook', media_type: 'movie', vote_average: 7.9, poster_path: '/rNzQyW4f8B8cqq92Mz0R5p7m6V4.jpg', release_date: '2004-06-25', overview: 'An epic love story centered on two young people from different social classes who fall in love in the 1940s.' },
      { id: 372058, title: 'Your Name.', media_type: 'movie', vote_average: 8.5, poster_path: '/q719jXXEzvA76hu4Jt951eorWC8.jpg', release_date: '2016-08-26', overview: 'Two teenagers share a profound, magical connection upon discovering they are swapping bodies.' }
    ]
  },
  {
    keywords: ['comedy', 'funny', 'hilarious', 'laugh', 'humor', 'parody', 'deadpool', 'superbad', 'hangover', 'fun'],
    vibeName: 'Uncontrollable Laughs & Comedies',
    vibeBadge: '😂 Pure Comedy',
    accentColor: '#eab308',
    reason: 'Zero drama, side-splitting humor, irreverent banter, and instant mood-lifters.',
    matches: [
      { id: 533535, title: 'Deadpool & Wolverine', media_type: 'movie', vote_average: 7.7, poster_path: '/8cdWjvZQUExUUTzyp4t6EDMubfO.jpg', release_date: '2024-07-24', overview: 'A listless Wade Wilson teams up with an aloof Wolverine on a chaotic multiverse mission.' },
      { id: 8363, title: 'Superbad', media_type: 'movie', vote_average: 7.3, poster_path: '/ek8e8txUyUvd2BNqj6UFE59q2P6.jpg', release_date: '2007-08-17', overview: 'Two co-dependent high school seniors are forced to deal with separation anxiety after their plan to stage a party goes awry.' },
      { id: 18785, title: 'The Hangover', media_type: 'movie', vote_average: 7.3, poster_path: '/aF1v6t3C2j6K7o3L5m8N2x9p6Q5.jpg', release_date: '2009-06-05', overview: 'Three buddies wake up from a bachelor party in Las Vegas with no memory of the previous night and the bachelor missing.' },
      { id: 9502, title: 'Kung Fu Panda', media_type: 'movie', vote_average: 7.3, poster_path: '/wWt4JYUtqUgmKjU64qTz9m7w6F9.jpg', release_date: '2008-06-04', overview: 'When the Valley of Peace is threatened, lazy panda Po discovers he is the chosen Dragon Warrior.' }
    ]
  },
  {
    keywords: ['action', 'revenge', 'fast', 'adrenaline', 'john wick', 'cars', 'explosion', 'shootout', 'gun', 'kick', 'badass'],
    vibeName: 'Pure High-Octane Mayhem',
    vibeBadge: '🔥 Non-Stop Action',
    accentColor: '#ef4444',
    reason: 'Pure adrenaline surges with kinetic gun-fu, brutal hand-to-hand combat, and world-class stuntwork.',
    matches: [
      { id: 603692, title: 'John Wick: Chapter 4', media_type: 'movie', vote_average: 7.8, poster_path: '/vZloFAK7NKnMGKEslUsZloewAcW.jpg', release_date: '2023-03-22', overview: 'John Wick uncovers a path to defeating The High Table while facing lethal global assassins.' },
      { id: 76341, title: 'Mad Max: Fury Road', media_type: 'movie', vote_average: 7.6, poster_path: '/hA2ple9q4qnwxp3hKVNhroipsir.jpg', release_date: '2015-05-13', overview: 'In a post-apocalyptic wasteland, a woman rebels against a tyrannical ruler with the aid of Max.' },
      { id: 155, title: 'The Dark Knight', media_type: 'movie', vote_average: 8.5, poster_path: '/qJ2tW6WMUDux911r6m7haRef0WH.jpg', release_date: '2008-07-16', overview: 'Batman raises the stakes in his war on crime with the help of Lt. Jim Gordon and District Attorney Harvey Dent.' },
      { id: 168259, title: 'Furious 7', media_type: 'movie', vote_average: 7.3, poster_path: '/ktofZ9Htrjiy0P6LEowsDaxd3Ri.jpg', release_date: '2015-04-01', overview: 'Deckard Shaw seeks revenge against Dominic Toretto and his family for his comatose brother.' }
    ]
  }
];

export function queryVibeOracle(naturalPrompt) {
  const clean = (naturalPrompt || '').toLowerCase().trim();
  if (!clean) return VIBE_DICTIONARY[0];

  let bestMatch = null;
  let highestScore = 0;

  for (const entry of VIBE_DICTIONARY) {
    let score = 0;
    for (const kw of entry.keywords) {
      if (clean.includes(kw)) {
        score += 4;
      }
    }
    for (const m of entry.matches) {
      if (clean.includes(m.title.toLowerCase())) {
        score += 6;
      }
    }
    if (score > highestScore) {
      highestScore = score;
      bestMatch = entry;
    }
  }

  if (bestMatch && highestScore > 0) {
    return bestMatch;
  }

  return VIBE_DICTIONARY[0];
}

export async function queryVibeOracleAsync(naturalPrompt) {
  const clean = (naturalPrompt || '').trim();
  if (!clean) return queryVibeOracle('');

  // 1. Try real live Google Gemini AI first
  try {
    const geminiResult = await askGeminiOracle(clean);
    if (geminiResult && geminiResult.matches && geminiResult.matches.length > 0) {
      return geminiResult;
    }
  } catch (e) {}

  // 2. Check local curated Vibe Dictionary
  const localMatch = queryVibeOracle(clean);
  const cleanLower = clean.toLowerCase();
  const hasKeywordHit = localMatch.keywords.some((kw) => cleanLower.includes(kw));

  if (hasKeywordHit) {
    return localMatch;
  }

  // 3. Dynamic Live TMDB Search — NEVER return a dummy 5-movie list!
  // If user typed "horror", "zombies", "spiderman", or any movie/genre,
  // query TMDB live so they get real, 100% relevant movies with verified posters!
  try {
    const searchHits = await searchContent(clean);
    if (Array.isArray(searchHits) && searchHits.length > 0) {
      const validMovies = searchHits
        .filter((m) => m && (m.poster_path || m.backdrop_path))
        .slice(0, 8);

      if (validMovies.length > 0) {
        return {
          vibeName: `Curated for: "${clean}"`,
          vibeBadge: '🎬 Live Dynamic Match',
          accentColor: '#38bdf8',
          furinaCommentary: `“A connoisseur's choice! Here are the finest cinema titles matching '${clean}' from the Fontaine Archives!”`,
          reason: `Dynamically retrieved from global cinema archives to match your exact vibe query "${clean}".`,
          matches: validMovies
        };
      }
    }
  } catch (err) {}

  // 4. Default to first genre
  return localMatch;
}

export default { queryVibeOracle, queryVibeOracleAsync, QUICK_VIBES, VIBE_DICTIONARY };
