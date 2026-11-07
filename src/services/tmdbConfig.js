// Single place for TMDB settings.
// Set VITE_TMDB_API_KEY in a .env file (see .env.example). The fallback keeps
// existing deployments working; note any key shipped to the browser is public.
export const TMDB_API_KEY =
  import.meta.env?.VITE_TMDB_API_KEY || '4e44d9029b1270a757cddc766a1bcb63';

export const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
