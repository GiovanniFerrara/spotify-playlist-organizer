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

async function addMySavedTracksToPlaylist(
  playlistsCreated: { body: SpotifyApi.CreatePlaylistResponse }[],
  options: { limit: number; offset: number },
): Promise<SpotifyApi.UsersSavedTracksResponse> {
  const { limit, offset } = options;

  console.log('Getting saved tracks', { limit, offset })

  let savedTracks = null;
  try {
    savedTracks = await spotifyApi.getMySavedTracks({
      limit,
      offset,
    });
  } catch (err) {
    console.log('Error getting saved tracks', err);
    throw err;
  }

  let aiOrganizedPlaylists = null;
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
            songs: savedTracks.body.items.map((item) => {
              return {
                name: item.track.name,
                artist: item.track.artists[0].name,
                album: item.track.album.name,
                id: item.track.id,
              };
            }),
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
      console.log({
        savedSongsCountInGivenStep,
        offset,
        limit: step,
      });
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
