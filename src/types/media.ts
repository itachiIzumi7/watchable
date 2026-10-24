export interface MediaItem {
  id: number | string;
  title?: string;
  name?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string;
  vote_average?: number;
  release_date?: string;
  first_air_date?: string;
}

export interface WatchlistItem {
  id: number | string;
  title: string;
  image: string | null;
  rating: number;
  categories: string[];
  adult: boolean;
  type: 'movie' | 'tv' | 'anime';
}

export interface EpisodeLike {
  episode_number: number;
  season_number?: number;
  name?: string;
  still_path?: string | null;
  air_date?: string | null;
}
