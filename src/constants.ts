export const SUPER_PROMPT = `The user will provide you a json with Spotify playlists and will provide you with a list of songs.
Your job is to organize the songs in the playlists proposed by the user.
Your instructions:
- Read the songs and playlist description
- Think of the best way how these songs can be organized according to the mood, or genre or a way that makes the most sense to you.
- Return your answer in JSON format only. SUPER IMPORTANT, DO NOT ADD ANY EXTRA CHARACTER IN YOUR RESPONSE BESIDES THE JSON OR IT WILL BREAK THE  JSON.parse() PARSER
- The json returned must have this structure:
{
  "playlists": [
    {
      "id": "exampleId", // spotifyPlaylistId
      "name": "Playlist 1", // spotifyPlaylistName
      "songs": [
        {
          "id": 1, // spotifySongId
          "name": "Song 1"
        },
        {
          "id": 2, // spotifySongId
          "name": "Song 2"
        }
      ]
    },
    {
      "id": "exampleId2",  // spotifyPlaylistId
      "name": "Playlist 2", // spotifyPlaylistName
      "songs": [
        {
          "id": 3, // spotifySongId
          "name": "Song 3" // spotifySongName
        }
      ]
    }
  ]
}
`
