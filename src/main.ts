import SpotifyApi from 'spotify-web-api-node';
import express from 'express';
import { configDotenv } from 'dotenv';
import bodyParser from 'body-parser';
import { createChatCompletion } from './openai';
import { SUPER_PROMPT } from './constants';

configDotenv();

interface Response<T> {
  body: T;
}

const app = express();

app.use(bodyParser.json());

app.use(bodyParser.urlencoded({ extended: true }));

const spotifyApi = new SpotifyApi({
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  redirectUri: 'http://localhost:3000/callback',
});

app.get('/login', (_req, res) => {
  const scopes = [
    'user-read-private',
    'user-read-email',
    'user-library-read',
    'playlist-modify-public',
    'playlist-modify-private',
    'playlist-read-private',
  ];
  try{
    console.log('Attempting to get access token');
    const authorizeURL = spotifyApi.createAuthorizeURL(
      scopes,
      'Development mode',
    );
    console.log('Created authorization URL');
    res.redirect(authorizeURL);
  } catch (err) {
    console.error('Error creating authorization URL', err);
  }
});

app.get('/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const data = await spotifyApi.authorizationCodeGrant(code);
    const { access_token, refresh_token } = data.body;
    spotifyApi.setAccessToken(access_token);
    spotifyApi.setRefreshToken(refresh_token);
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.redirect('/login');
  }
});

async function createPlaylists(
  playlistsToCreate: { name: string; description: string }[],
): Promise<Response<SpotifyApi.CreatePlaylistResponse>[]> {
  try {
    const playlistsCreatedPromises = playlistsToCreate.map(async (playlist) => {
      return spotifyApi.createPlaylist(playlist.name, {
        description: playlist.description,
        public: true,
      });
    });

    return Promise.all(playlistsCreatedPromises);
  } catch (err) {
    console.log({ playlistsToCreate, err });
    throw err;
  }
}

function songPropertiesMapper(
  mergedTrack: SpotifyApi.AudioFeaturesObject &
    Omit<SpotifyApi.TrackObjectFull, 'type'>,
) {
  return {
    id: mergedTrack.id,
    name: mergedTrack.name,
    artists: mergedTrack.artists,
    album: mergedTrack.album,
    type: mergedTrack.type,
    popularity: mergedTrack.popularity,
    acousticness: mergedTrack.acousticness,
    energy: mergedTrack.energy,
    danceability: mergedTrack.danceability,
    explicit: mergedTrack.explicit,
    instrumentalness: mergedTrack.instrumentalness,
    key: mergedTrack.key,
    liveness: mergedTrack.liveness,
    loudness: mergedTrack.loudness,
    mode: mergedTrack.mode,
    speechiness: mergedTrack.speechiness,
    tempo: mergedTrack.tempo,
    time_signature: mergedTrack.time_signature,
    valence: mergedTrack.valence,
  };
}

type MergedTrack = SpotifyApi.AudioFeaturesObject &
  Omit<SpotifyApi.TrackObjectFull, 'type'>;

// Function to get saved tracks and their moods
async function getSavedTracksAndMoods(options: {
  limit: number;
  offset: number;
}): Promise<
  [
    Response<SpotifyApi.UsersSavedTracksResponse>,
    Response<SpotifyApi.MultipleAudioFeaturesResponse>,
  ]
> {
  const { limit, offset } = options;

  try {
    const savedTracks = await spotifyApi.getMySavedTracks({ limit, offset });
    const tracksWithMood = await spotifyApi.getAudioFeaturesForTracks(
      savedTracks.body.items.map((item) => item.track.id),
    );

    return [savedTracks, tracksWithMood];
  } catch (err) {
    console.log('Error getting saved tracks', err);
    throw err;
  }
}

// Function to merge saved tracks with their moods
function mergeSavedTracksWithMoods(
  savedTracks: Response<SpotifyApi.UsersSavedTracksResponse>,
  tracksWithMood: Response<SpotifyApi.MultipleAudioFeaturesResponse>,
): MergedTrack[] {
  const mergedTracks: MergedTrack[] = [];

  for (const savedTrackIndex in savedTracks.body.items) {
    mergedTracks.push({
      ...savedTracks[savedTrackIndex],
      ...tracksWithMood.body.audio_features[savedTrackIndex],
    });
  }

  return mergedTracks;
}

// Function to create the AI-organized playlists
async function createAIOrganizedPlaylists(
  playlistsCreated: { body: SpotifyApi.CreatePlaylistResponse }[],
  mergedTracks: MergedTrack[],
): Promise<unknown> {
  try {
    const aiOrganizedPlaylists = await createChatCompletion({
      messages: [
        {
          content: SUPER_PROMPT,
          role: 'system',
        },
        {
          role: 'user',
          content: JSON.stringify({
            playlists: playlistsCreated.map((playlist) => playlist.body),
            songs: mergedTracks.map(songPropertiesMapper),
          }),
        },
      ],
    });

    return JSON.parse(aiOrganizedPlaylists.message.content);
  } catch (err) {
    console.log('Error creating chat completion', err);
    throw err;
  }
}

// Function to add tracks to Spotify playlists
async function addTracksToSpotifyPlaylists(
  organizedPlaylists: { playlists: { id: string; songs: { id: string }[] }[] },
): Promise<void> {
  try {
    for (const playlist of organizedPlaylists.playlists) {
      const songIds = playlist.songs.map((song) => `spotify:track:${song.id}`);
      await spotifyApi.addTracksToPlaylist(playlist.id, songIds);
    }
  } catch (err) {
    console.log('Error adding tracks to playlist', err);
    throw err;
  }
}

// The main function
async function addMySavedTracksToPlaylist(
  playlistsCreated: { body: SpotifyApi.CreatePlaylistResponse }[],
  options: { limit: number; offset: number },
): Promise<SpotifyApi.UsersSavedTracksResponse> {
  const [savedTracks, tracksWithMood] = await getSavedTracksAndMoods(options);
  const mergedTracks = mergeSavedTracksWithMoods(savedTracks, tracksWithMood);
  const organizedPlaylists = await createAIOrganizedPlaylists(
    playlistsCreated,
    mergedTracks,
  );
  await addTracksToSpotifyPlaylists(organizedPlaylists as { playlists: { id: string; songs: { id: string }[] }[] });

  return savedTracks.body;
}

app.post('/playlist', async (req, res) => {
  const step = 25;
  try {
    const { body: playlistsToCreate } = req as {
      body: { name: string; description: string }[];
    };

    const playlistsCreated = await createPlaylists(playlistsToCreate);

    let savedSongsCountInGivenStep = null;
    let offset = 0;

    while (
      savedSongsCountInGivenStep > 0 ||
      savedSongsCountInGivenStep === null
    ) {
      const savedSongsInCurrentStep = await addMySavedTracksToPlaylist(
        playlistsCreated,
        {
          limit: step,
          offset,
        },
      );

      savedSongsCountInGivenStep = savedSongsInCurrentStep.items.length;
      offset += step;
    }

    res.send({ savedCount: offset * step });
  } catch (err) {
    if (err.statusCode === 401) {
      res.redirect('/login');
    }

    res.send(err.message);
  }
});

// handle the website routes
app.get('/', async (_req, res) => {
  try {
    await spotifyApi.getMe();
    res.sendFile(`${__dirname}/website/website.html`);
  } catch (err) {
    console.error(err);
    res.redirect('/login');
  }
});

app.get('/logout', (_req, res) => {
  // Clear the access and refresh tokens from the Spotify API client instance
  spotifyApi.setAccessToken(null);
  spotifyApi.setRefreshToken(null);

  // Send a JSON response instead of redirecting
  res.json({ success: true, message: 'Logged out successfully' });
});

// send the public files back to the client
app.use(express.static(`${__dirname}/website`));

app.listen(3000, () => {
  console.log('Server is listening on port 3000');
});
