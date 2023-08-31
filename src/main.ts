import SpotifyApi from 'spotify-web-api-node';
import express from 'express';
import { configDotenv } from 'dotenv';

configDotenv();

const app = express();

const spotifyApi = new SpotifyApi({
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  redirectUri: 'http://localhost:3000/callback',
});

app.get('/login', (_req, res) => {
  const scopes = ['user-read-private', 'user-read-email', 'user-library-read'];
  const authorizeURL = spotifyApi.createAuthorizeURL(scopes,'Development mode');
  res.redirect(authorizeURL);
});

app.get('/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const data = await spotifyApi.authorizationCodeGrant(code);
    const { access_token, refresh_token } = data.body;
    spotifyApi.setAccessToken(access_token);
    spotifyApi.setRefreshToken(refresh_token);
    res.redirect('/home');
  } catch (err) {
    console.error(err);
    res.redirect('/login');
  }
});

app.get('/home', async (_req, res) => {
  try {

    const playlists = await spotifyApi.getMySavedTracks()

    res.json(playlists.body.items.map((item) => {
      return {
        name: item.track.name,
        artist: item.track.artists[0].name,
        album: item.track.album.name,
      };
    }));
  } catch (err) {
    console.error(err);
    res.redirect('/login');
  }
});

app.listen(3000, () => {
  console.log('Server is listening on port 3000');
});
