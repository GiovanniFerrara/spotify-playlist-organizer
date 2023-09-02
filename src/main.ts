import SpotifyApi from 'spotify-web-api-node';
import express from 'express';
import { configDotenv } from 'dotenv';
import bodyParser from 'body-parser';
import { createChatCompletion } from './openai';
import { SUPER_PROMPT } from './constants';
configDotenv();

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

app.post('/playlist', async (req, res) => {
  try {
    const { body: playlistsToCreate } = req as {
      body: { name: string; description: string }[];
    };
    const savedTracks = await spotifyApi.getMySavedTracks({
      limit: 50,
      offset: 0,
    });

    const playlistsCreatedPromises = playlistsToCreate.map(async (playlist) => {
      return spotifyApi.createPlaylist(playlist.name, {
        description: playlist.description,
        public: true,
      });
    });

    const playlistsCreated = await Promise.all(playlistsCreatedPromises);

    const completion = await createChatCompletion({
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

    const organizedPlaylists = JSON.parse(completion.message.content);

    for (const playlist of organizedPlaylists) {
      const songIds = playlist.songs.map(song => `spotify:track:${song.id}`);
      await spotifyApi.addTracksToPlaylist(playlist.id, songIds);
  }

  res.send('Playlists created!');
  } catch (err) {
    res.redirect('/login');
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
