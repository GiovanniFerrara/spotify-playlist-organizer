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
  const authorizeURL = spotifyApi.createAuthorizeURL(
    scopes,
    'Development mode',
  );
  res.redirect(authorizeURL);
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

function songPropertiesMapper(mergedTrack: SpotifyApi.AudioFeaturesObject & Omit<SpotifyApi.TrackObjectFull, 'type'>){
   return ({
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
  })
}

async function addMySavedTracksToPlaylist(
  playlistsCreated: { body: SpotifyApi.CreatePlaylistResponse }[],
  options: { limit: number; offset: number },
): Promise<SpotifyApi.UsersSavedTracksResponse> {
  const { limit, offset } = options;

  let savedTracks: Response<SpotifyApi.UsersSavedTracksResponse> = null;
  let tracksWithMood: Response<SpotifyApi.MultipleAudioFeaturesResponse> = null;
  try {
    savedTracks = await spotifyApi.getMySavedTracks({
      limit,
      offset,
    });
    tracksWithMood = await spotifyApi.getAudioFeaturesForTracks(
      savedTracks.body.items.map((item) => item.track.id),
    );
  } catch (err) {
    console.log('Error getting saved tracks', err);
    throw err;
  }

  type MergedTrack = SpotifyApi.AudioFeaturesObject & Omit<SpotifyApi.TrackObjectFull, 'type'>

  let aiOrganizedPlaylists = null;
  const mergedTracksAudioFeaturesWithTracksInfo: (MergedTrack)[] = [];

  for (const savedTrackIndex in savedTracks.body.items) {
    mergedTracksAudioFeaturesWithTracksInfo.push({
      ... savedTracks[savedTrackIndex],
      ...tracksWithMood.body.audio_features[savedTrackIndex],
    });
  }

  try {
    aiOrganizedPlaylists = await createChatCompletion({
      messages: [
        {
          content: SUPER_PROMPT,
          role: 'system',
        },
        {
          role: 'user',
          content: JSON.stringify({
            playlists: playlistsCreated.map((playlist) => playlist.body),
            songs: mergedTracksAudioFeaturesWithTracksInfo.map(songPropertiesMapper),
          }),
        },
      ],
    });
  } catch (err) {
    console.log('Error creating chat completion', err);
    throw err;
  }

  const organizedPlaylists = JSON.parse(aiOrganizedPlaylists.message.content);

  try {
    for (const playlist of organizedPlaylists.playlists) {
      const songIds = playlist.songs.map((song) => `spotify:track:${song.id}`);
      await spotifyApi.addTracksToPlaylist(playlist.id, songIds);
    }

    return savedTracks.body;
  } catch (err) {
    console.log('Error adding tracks to playlist', err);
    throw err;
  }
}

app.post('/playlist', async (req, res) => {
  const step = 50;
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
    console.log(err);
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

// send the public files back to the client
app.use(express.static(`${__dirname}/website`));

app.listen(3000, () => {
  console.log('Server is listening on port 3000');
});

