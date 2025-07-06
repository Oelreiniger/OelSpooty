import axios from 'axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SpotifyService {
  private readonly logger = new Logger(SpotifyService.name);

  constructor(private readonly configService: ConfigService) { }

  private async getAccessToken(): Promise<string> {
    const clientId = this.configService.get<string>('SPOTIFY_CLIENT_ID');
    const clientSecret = this.configService.get<string>('SPOTIFY_CLIENT_SECRET');

    const encoded = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    try {
      const res = await axios.post(
        'https://accounts.spotify.com/api/token',
        new URLSearchParams({ grant_type: 'client_credentials' }),
        {
          headers: {
            Authorization: `Basic ${encoded}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      return res.data.access_token;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        throw new Error('Invalid Spotify credentials: Client ID or Secret may be incorrect.');
      }
      throw new Error(`Failed to get Spotify access token: ${error.message}`);
    }
  }

  private getSpotifyId(url: string): { type: 'playlist' | 'album' | 'artist', id: string } {
    const match = url.match(/(playlist|album|artist)\/([a-zA-Z0-9]+)/);
    if (!match) throw new Error('Invalid Spotify URL');
    return { type: match[1] as 'playlist' | 'album' | 'artist', id: match[2] };
  }

  async getDetailsWithRetry(url: string, retries = 3, timeoutMs = 10000): Promise<{ name: string; tracks: any[] }> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      this.logger.debug('[Fetching details] Attempt ${attempt} to fetch playlist...`')
      const result = await Promise.race([
        this.getDetails(url),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout during getDetails')), timeoutMs)
        ),
      ]) as { name: string; tracks: any[] };

      this.logger.debug(`[Fetching details] Success on attempt ${attempt}`)
      return { name: result.name, tracks: result.tracks ?? [] };
    }
  }

  async getDetails(url: string): Promise<{ name: string; tracks: any[] }> {
    const token = await this.getAccessToken();
    const { type, id } = this.getSpotifyId(url);
    const headers = { Authorization: `Bearer ${token}` };

    switch (type) {
      case 'playlist':
        return await this.fetchPlaylistDetails(url, id, headers);
      case 'album':
        return await this.fetchAlbumDetails(url, id, headers);
      case 'artist':
        return await this.fetchTopSongsOfArtistDetails(url, id, headers);
      default:
        throw new Error(`Unsupported Spotify type: ${type}`);
    }
  }

  async fetchPlaylistDetails(url: string, id: string, headers: Record<string, string>): Promise<{ name: string; tracks: any[] }> {
    const playlistRes = await axios.get(`https://api.spotify.com/v1/playlists/${id}`, { headers });
    const name = playlistRes.data.name;

    const tracks: any[] = [];
    let offset = 0;
    const limit = 100;
    while (true) {
      const res = await axios.get(`https://api.spotify.com/v1/playlists/${id}/tracks`, {
        headers,
        params: { limit, offset },
      });

      const items = res.data.items;
      if (!items.length) break;

      for (const item of items) {
        const track = item.track;
        tracks.push({
          artist: track.artists.map((a: any) => a.name).join(', '),
          name: track.name,
          duration: track.duration_ms,
          previewUrl: track.preview_url,
          uri: track.uri,
        });
      }

      offset += limit;
      if (!res.data.next) break;
    }

    return { name, tracks };
  }

  async fetchAlbumDetails(url: string, id: string, headers: Record<string, string>): Promise<{ name: string; tracks: any[] }> {
    const albumRes = await axios.get(`https://api.spotify.com/v1/albums/${id}`, { headers });
    const name = albumRes.data.name;

    const tracks = albumRes.data.tracks.items.map((track: any) => ({
      artist: track.artists.map((artist: any) => artist.name).join(', '),
      name: track.name,
      duration: track.duration_ms,
      previewUrl: track.preview_url,
      uri: track.uri,
    }));

    return { name, tracks };
  }

  async fetchTopSongsOfArtistDetails(url: string, id: string, headers: Record<string, string>): Promise<{ name: string; tracks: any[] }> {
    const result = await axios.get(`https://api.spotify.com/v1/artists/${id}`, { headers });
    const name = result.data.name;

    const topTracksRes = await axios.get(`https://api.spotify.com/v1/artists/${id}/top-tracks`, { headers });

    const tracks = topTracksRes.data.tracks.map((track: any) => ({
      artist: track.artists.map((artist: any) => artist.name).join(', '),
      name: track.name,
      duration: track.duration_ms,
      previewUrl: track.preview_url,
      uri: track.uri,
    }));

    return { name: `${name} (Top Tracks)`, tracks };
  }

  async getPlaylistTracks(url: string): Promise<any[]> {
    const result = await this.getDetails(url);
    return result.tracks;
  }
}
