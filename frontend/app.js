// StreamFlix frontend logic.
// Talks to the API and draws the movie cards on the page.

// Where the backend lives.
const API = 'http://localhost:4000';

// Load the saved login token if we have one from last time.
let token = localStorage.getItem('sf_token') || '';

// State that the page keeps track of.
let movies = [];              // all movies from the server
let watchlistIds = [];        // ids the user has saved
let activeGenre = 'all';      // which genre the dropdown is on
let searchTerm = '';          // what is typed in the search box
let authMode = '';            // '', 'login', or 'register'

// Small helper that does a fetch and returns the JSON.
// It also adds the token header when we are logged in.
async function api(path, opts) {
  if (!opts) {
    opts = {};
  }

  const headers = { 'Content-Type': 'application/json' };
  if (opts.headers) {
    Object.assign(headers, opts.headers);
  }
  if (token) {
    headers.Authorization = 'Bearer ' + token;
  }

  const res = await fetch(API + path, { method: opts.method, body: opts.body, headers: headers });

  // Try to read the JSON. If the body is empty just use an object.
  let data = {};
  try {
    data = await res.json();
  } catch (err) {
    data = {};
  }

  // If the server said something went wrong, throw so the caller can show it.
  if (!res.ok) {
    throw new Error(data.error || 'Something went wrong');
  }

  return data;
}

// Show a little message at the top and clear it after a few seconds.
function setStatus(message, type) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = 'status ' + (type || 'info');

  if (message) {
    setTimeout(function () {
      status.textContent = '';
      status.className = 'status';
    }, 3500);
  }
}

// Read the email and password from the input boxes.
function getCredentials() {
  return {
    email: document.getElementById('email').value.trim().toLowerCase(),
    password: document.getElementById('pass').value
  };
}

// Draw the login form, or the logout button if we are already logged in.
function renderAuth() {
  const box = document.getElementById('auth-box');

  // Logged in view.
  if (token) {
    authMode = '';
    box.className = 'auth-box';
    box.innerHTML = '<span class="signed-in">Signed in</span>' +
      '<button id="logout" class="secondary">Log out</button>';

    document.getElementById('logout').onclick = function () {
      // Forget the token and reset the page.
      token = '';
      localStorage.removeItem('sf_token');
      watchlistIds = [];
      renderAuth();
      renderMovies();
      renderWatchlist([]);
      setStatus('Logged out');
    };
    return;
  }

  // Logged out view. Start with just the two buttons.
  if (!authMode) {
    box.className = 'auth-box';
    box.innerHTML = '<button id="show-login">Log in</button>' +
      '<button id="show-reg" class="secondary">Register</button>';

    document.getElementById('show-login').onclick = function () {
      authMode = 'login';
      renderAuth();
    };

    document.getElementById('show-reg').onclick = function () {
      authMode = 'register';
      renderAuth();
    };
    return;
  }

  // User picked login or register, so show the input fields.
  box.className = 'auth-box auth-form-open';

  if (authMode === 'login') {
    box.innerHTML = '<input id="email" type="email" placeholder="email" />' +
      '<input id="pass" type="password" placeholder="password" />' +
      '<button id="login">Log in</button>' +
      '<button id="cancel" class="secondary">Cancel</button>';
  } else {
    box.innerHTML = '<input id="email" type="email" placeholder="email" />' +
      '<input id="pass" type="password" placeholder="password" />' +
      '<button id="reg">Register</button>' +
      '<button id="cancel" class="secondary">Cancel</button>';
  }

  document.getElementById('cancel').onclick = function () {
    authMode = '';
    renderAuth();
  };

  if (authMode === 'login') {
    document.getElementById('login').onclick = async function () {
      try {
        const data = await api('/api/login', {
          method: 'POST',
          body: JSON.stringify(getCredentials())
        });
        // Save the token so the user stays logged in.
        token = data.token;
        authMode = '';
        localStorage.setItem('sf_token', token);
        renderAuth();
        renderMovies();
        await loadWatchlist();
        setStatus('Welcome back', 'success');
      } catch (err) {
        setStatus(err.message, 'error');
      }
    };
  } else {
    document.getElementById('reg').onclick = async function () {
      try {
        await api('/api/register', {
          method: 'POST',
          body: JSON.stringify(getCredentials())
        });
        setStatus('Registered. You can log in now.', 'success');
        authMode = 'login';
        renderAuth();
      } catch (err) {
        setStatus(err.message, 'error');
      }
    };
  }
}

// Build one movie card. "action" is either 'add' or 'remove'.
function card(movie, action) {
  if (!action) {
    action = 'add';
  }

  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = '<img src="' + movie.poster + '" alt="' + movie.title + ' poster">' +
    '<div class="card-body">' +
    '<div class="meta">' + movie.genre + ', ' + movie.year + ', ' + movie.rating + '</div>' +
    '<h3>' + movie.title + '</h3>' +
    '<p>' + movie.description + '</p>' +
    '</div>';

  // Only show the button when the user is logged in.
  if (token) {
    const btn = document.createElement('button');

    // Is this movie already saved?
    const inList = watchlistIds.includes(movie.id);

    // Pick the label for the button.
    if (action === 'remove') {
      btn.textContent = 'Remove';
      btn.className = 'secondary full';
    } else if (inList) {
      btn.textContent = 'In My List';
      btn.className = 'secondary full';
      btn.disabled = true;
    } else {
      btn.textContent = '+ My List';
      btn.className = 'full';
    }

    btn.onclick = async function () {
      try {
        if (action === 'remove') {
          await api('/api/watchlist/' + movie.id, { method: 'DELETE' });
          setStatus('Removed ' + movie.title + ' from your list', 'success');
        } else {
          await api('/api/watchlist/' + movie.id, { method: 'POST' });
          setStatus('Added ' + movie.title + ' to your list', 'success');
        }
        // Refresh both rows so the buttons update.
        await loadWatchlist();
        renderMovies();
      } catch (err) {
        setStatus(err.message, 'error');
      }
    };

    el.appendChild(btn);
  }

  return el;
}

// Draw the trending row, using the search box and genre filter.
function renderMovies() {
  const row = document.getElementById('movies');
  const count = document.getElementById('movie-count');

  // Keep only the movies that match the filters.
  const filtered = movies.filter(function (movie) {
    const matchesGenre = activeGenre === 'all' || movie.genre === activeGenre;
    const text = (movie.title + ' ' + movie.genre + ' ' + movie.description).toLowerCase();
    const matchesSearch = text.includes(searchTerm);
    return matchesGenre && matchesSearch;
  });

  row.innerHTML = '';

  // Show how many movies we found (handle the singular case).
  if (filtered.length === 1) {
    count.textContent = '1 title';
  } else {
    count.textContent = filtered.length + ' titles';
  }

  if (filtered.length === 0) {
    row.innerHTML = '<p class="empty">No movies match your filters.</p>';
    return;
  }

  for (let i = 0; i < filtered.length; i++) {
    row.appendChild(card(filtered[i]));
  }
}

// Draw the "My List" row.
function renderWatchlist(items) {
  const row = document.getElementById('watchlist');
  const count = document.getElementById('watchlist-count');

  row.innerHTML = '';
  count.textContent = items.length + ' saved';

  if (!token) {
    row.innerHTML = '<p class="empty">Log in to build your watchlist.</p>';
    return;
  }

  if (items.length === 0) {
    row.innerHTML = '<p class="empty">Your list is empty. Add a movie from Trending.</p>';
    return;
  }

  for (let i = 0; i < items.length; i++) {
    row.appendChild(card(items[i], 'remove'));
  }
}

// Fill the genre dropdown with the genres we got from the server.
function populateGenres() {
  const filter = document.getElementById('genre-filter');

  // Collect the unique genres.
  const genres = [];
  for (let i = 0; i < movies.length; i++) {
    if (!genres.includes(movies[i].genre)) {
      genres.push(movies[i].genre);
    }
  }
  genres.sort();

  for (let i = 0; i < genres.length; i++) {
    const option = document.createElement('option');
    option.value = genres[i];
    option.textContent = genres[i];
    filter.appendChild(option);
  }
}

// Get the movies from the server and draw them.
async function loadMovies() {
  movies = await api('/api/movies');
  populateGenres();
  renderMovies();
}

// Get the user's watchlist from the server.
async function loadWatchlist() {
  if (!token) {
    renderWatchlist([]);
    return;
  }

  try {
    const items = await api('/api/watchlist');
    // Remember the ids so the cards know what is already saved.
    watchlistIds = items.map(function (movie) {
      return movie.id;
    });
    renderWatchlist(items);
  } catch (err) {
    // The token is probably expired, so log the user out.
    token = '';
    localStorage.removeItem('sf_token');
    watchlistIds = [];
    renderAuth();
    renderMovies();
    renderWatchlist([]);
    setStatus(err.message, 'error');
  }
}

// Update the search term when the user types.
document.getElementById('search').addEventListener('input', function (event) {
  searchTerm = event.target.value.trim().toLowerCase();
  renderMovies();
});

// Update the genre when the dropdown changes.
document.getElementById('genre-filter').addEventListener('change', function (event) {
  activeGenre = event.target.value;
  renderMovies();
});

// Set everything up when the page loads.
async function init() {
  try {
    renderAuth();
    await loadMovies();
    await loadWatchlist();
  } catch (err) {
    setStatus('Could not load StreamFlix: ' + err.message, 'error');
  }
}

init();
