document.addEventListener("DOMContentLoaded", function() {
  const playlistForm = document.getElementById('playlist-form');
  const addPlaylistButton = document.getElementById('add-playlist');

  addPlaylistButton.addEventListener('click', function() {
    const newPlaylist = document.createElement('div');
    newPlaylist.className = 'playlist mb-3';
    newPlaylist.innerHTML = `
      <label for="playlist-name" class="form-label">Playlist Name</label>
      <input type="text" class="form-control" id="playlist-name" required>
      <label for="playlist-description" class="form-label">Playlist Description</label>
      <input type="text" class="form-control" id="playlist-description">
    `;
    playlistForm.insertBefore(newPlaylist, addPlaylistButton);
  });

  playlistForm.addEventListener('submit', function(event) {
    event.preventDefault();
    const playlists = [];
    const playlistElements = document.querySelectorAll('.playlist');
    playlistElements.forEach(function(playlistElement) {
      const playlistName = playlistElement.querySelector('#playlist-name').value;
      const playlistDescription = playlistElement.querySelector('#playlist-description').value;
      playlists.push({ name: playlistName, description: playlistDescription });
    });
    sendCollectedData(playlists);
  });
});

const logoutButton = document.querySelector('#logout');
  if (logoutButton) {
    logoutButton.addEventListener('click', function(event) {
      event.preventDefault();
      handleLogout();
    });
  }

function sendCollectedData(playlists){
  fetch('http://localhost:3000/playlist', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(playlists)
  })
  .then(function(response) {
    return response.json();
  })
  .then(function(data) {
    console.log(data);
  });
}

function handleLogout() {
  fetch('/logout', {
    method: 'GET',
  })
  .then(function(response) {
    return response.json();
  })
  .then(function(data) {
    if(data.success) {
      // Open Spotify logout in a new tab
      window.open('https://www.spotify.com/logout/', '_blank');
      // Redirect the current page to login
      window.location.href = '/login';
    } else {
      console.error('Logout failed');
    }
  })
  .catch(function(error) {
    console.error('Error:', error);
  });
}
